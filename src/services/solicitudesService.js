const { query, withTransaction } = require('../config/db');
const { emitToLocal, Eventos } = require('../config/socket');

// ─── Crear solicitud ──────────────────────────────────────────────────────────
/**
 * Crea una nueva solicitud pendiente y emite evento a admins del local.
 */
const crear = async ({ id_local, id_pedido, id_usuario_origen, tipo, payload }) => {
  const { rows } = await query(`
    INSERT INTO solicitudes (id_local, id_pedido, id_usuario_origen, tipo, payload)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [id_local, id_pedido || null, id_usuario_origen, tipo, JSON.stringify(payload)]);

  const solicitud = rows[0];

  // Notificar a todos en el local (admin verá el badge)
  emitToLocal(id_local, Eventos.SOLICITUD_NUEVA, {
    id_solicitud: solicitud.id_solicitud,
    tipo:         solicitud.tipo,
    id_pedido:    solicitud.id_pedido,
    payload:      solicitud.payload,
    creado_en:    solicitud.creado_en,
  });

  return solicitud;
};

// ─── Listar pendientes de un local ───────────────────────────────────────────
const listarPendientes = async (id_local) => {
  const { rows } = await query(`
    SELECT s.*,
           u_orig.nombre AS nombre_origen
    FROM solicitudes s
    JOIN usuarios u_orig ON u_orig.id_usuario = s.id_usuario_origen
    WHERE s.id_local = $1 AND s.estado = 'PENDIENTE'
    ORDER BY s.creado_en ASC
  `, [id_local]);
  return rows;
};

// ─── Resolver solicitud (aprobar o rechazar) ──────────────────────────────────
/**
 * Resuelve una solicitud y, si se aprueba, aplica el efecto correspondiente.
 * Usa una transacción para que efecto + resolución sean atómicos.
 */
const resolver = async ({ id_solicitud, id_local, id_usuario_resolutor, decision, motivo_rechazo }) => {
  if (!['APROBADO', 'RECHAZADO'].includes(decision)) {
    throw new Error('decision debe ser APROBADO o RECHAZADO');
  }

  return withTransaction(async (client) => {
    // Bloquear fila para evitar doble resolución
    const { rows } = await client.query(`
      SELECT * FROM solicitudes WHERE id_solicitud = $1 FOR UPDATE
    `, [id_solicitud]);

    if (rows.length === 0) throw new Error('Solicitud no encontrada');
    const sol = rows[0];
    if (Number(sol.id_local) !== Number(id_local)) throw new Error('Solicitud no encontrada para este local');
    if (sol.estado !== 'PENDIENTE') throw new Error('Solicitud ya fue resuelta');

    // Actualizar estado
    const { rows: updated } = await client.query(`
      UPDATE solicitudes
      SET estado = $1,
          id_usuario_resolutor = $2,
          motivo_rechazo = $3,
          resuelto_en = CURRENT_TIMESTAMP
      WHERE id_solicitud = $4
      RETURNING *
    `, [decision, id_usuario_resolutor, motivo_rechazo || null, id_solicitud]);

    const solicitudResuelta = updated[0];

    // Aplicar efecto si fue aprobado
    if (decision === 'APROBADO') {
      await aplicarEfecto(client, sol);
    } else if (sol.tipo === 'ACCESO_DISPOSITIVO') {
      const payload = parsePayload(sol.payload);
      if (payload.id_dispositivo) {
        await client.query(`
          UPDATE dispositivos_autorizados
          SET estado = 'REVOCADO', actualizado_en = CURRENT_TIMESTAMP
          WHERE id_dispositivo = $1
        `, [payload.id_dispositivo]);
      }
    }

    // Notificar al local
    emitToLocal(sol.id_local, Eventos.SOLICITUD_RESUELTA, {
      id_solicitud,
      decision,
      tipo:      sol.tipo,
      id_pedido: sol.id_pedido,
      payload:   sol.payload,
    });

    return solicitudResuelta;
  });
};

// ─── Aplicar el efecto según tipo ────────────────────────────────────────────
const parsePayload = (payload) => {
  if (!payload) return {};
  if (typeof payload === 'string') {
    try { return JSON.parse(payload); } catch { return {}; }
  }
  return payload;
};

const aplicarEfecto = async (client, solicitud) => {
  const { tipo, id_pedido } = solicitud;
  const payload = parsePayload(solicitud.payload);

  switch (tipo) {
    case 'ACCESO_DISPOSITIVO': {
      if (!payload.id_dispositivo) throw new Error('Solicitud de acceso sin id_dispositivo');
      await client.query(`
        UPDATE dispositivos_autorizados
        SET estado = 'APROBADO', actualizado_en = CURRENT_TIMESTAMP
        WHERE id_dispositivo = $1
      `, [payload.id_dispositivo]);
      break;
    }

    case 'CAMBIO_PRECIO': {
      // payload: { id_detalle, nuevo_precio }
      await client.query(`
        UPDATE detalles_pedido
        SET precio_unitario_historico = $1
        WHERE id_detalle = $2 AND id_pedido = $3
      `, [payload.nuevo_precio, payload.id_detalle, id_pedido]);
      break;
    }

    case 'ANULACION_ITEM': {
      // payload: { id_detalle, motivo }
      // Eliminamos el ítem del pedido (cascade borra detalles_opciones)
      await client.query(`
        DELETE FROM detalles_pedido
        WHERE id_detalle = $1 AND id_pedido = $2
      `, [payload.id_detalle, id_pedido]);
      break;
    }

    case 'ANULACION_PEDIDO': {
      // payload: { motivo }
      await client.query(`
        UPDATE pedidos
        SET estado_pago = 'ANULADO', motivo_anulacion = $1
        WHERE id_pedido = $2
      `, [payload.motivo, id_pedido]);

      // Notificar a cocina también
      const { rows: pedRows } = await client.query(
        'SELECT id_local FROM pedidos WHERE id_pedido = $1', [id_pedido]
      );
      if (pedRows.length) {
        emitToLocal(pedRows[0].id_local, Eventos.PEDIDO_ANULADO, { id_pedido });
      }
      break;
    }

    case 'DESCUENTO_GLOBAL': {
      // payload: { porcentaje } — por ahora lo guardamos en notas
      // En una implementación más avanzada modificar monto_total
      await client.query(`
        UPDATE pedidos
        SET notas_generales = COALESCE(notas_generales,'') || $1
        WHERE id_pedido = $2
      `, [` [DESC ${payload.porcentaje}%]`, id_pedido]);
      break;
    }

    case 'MODIFICACION':
      // Los cambios ya vienen en payload; no se aplica automáticamente,
      // el admin los procesa desde la interfaz
      break;

    default:
      console.warn('[Solicitudes] Tipo sin efecto automático:', tipo);
  }
};

module.exports = { crear, listarPendientes, resolver };
