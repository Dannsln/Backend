const { query, withTransaction } = require('../config/db');
const { emitToLocal, Eventos } = require('../config/socket');

// ─── Crear pedido (con detalles y opciones, todo atómico) ────────────────────
/**
 * @param {object} data
 * @param {number} data.id_local
 * @param {number|null} data.id_sesion_caja
 * @param {number} data.id_usuario_mesero
 * @param {'MESA'|'LLEVAR'} data.tipo_pedido
 * @param {string} data.identificador_cliente  — "Mesa 3", "Juan (llevar)", etc.
 * @param {number|null} data.id_mesa
 * @param {string|null} data.notas_generales
 * @param {Array}  data.items
 *   [{ id_producto, cantidad, precio_unitario, notas_plato, es_para_llevar, opciones: [id_opcion] }]
 */
const crear = async (data) => {
  const {
    id_local, id_sesion_caja, id_usuario_mesero,
    tipo_pedido, identificador_cliente, id_mesa,
    notas_generales, items
  } = data;

  return withTransaction(async (client) => {
    // 1. Insertar pedido
    const { rows: [pedido] } = await client.query(`
      INSERT INTO pedidos
        (id_local, id_sesion_caja, id_usuario_mesero, tipo_pedido,
         identificador_cliente, id_mesa, notas_generales)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [id_local, id_sesion_caja, id_usuario_mesero, tipo_pedido,
        identificador_cliente, id_mesa || null, notas_generales || null]);

    // 2. Insertar detalles
    for (const item of items) {
      const { rows: [detalle] } = await client.query(`
        INSERT INTO detalles_pedido
          (id_pedido, id_producto, cantidad, precio_unitario_historico, notas_plato, es_para_llevar)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id_detalle
      `, [pedido.id_pedido, item.id_producto, item.cantidad,
          item.precio_unitario, item.notas_plato || null, item.es_para_llevar || false]);

      // 3. Insertar opciones del ítem
      for (const id_opcion of (item.opciones || [])) {
        await client.query(`
          INSERT INTO detalles_opciones (id_detalle, id_opcion) VALUES ($1,$2)
        `, [detalle.id_detalle, id_opcion]);
      }
    }

    // 4. Traer el pedido completo para emitirlo
    const pedidoCompleto = await _obtenerCompleto(client, pedido.id_pedido);

    emitToLocal(id_local, Eventos.PEDIDO_NUEVO, pedidoCompleto);

    return pedidoCompleto;
  });
};

// ─── Obtener pedidos activos de un local ─────────────────────────────────────
const listarActivos = async (id_local) => {
  const { rows } = await query(`
    SELECT p.*,
           u.nombre AS nombre_mesero,
           json_agg(
             json_build_object(
               'id_detalle',                dp.id_detalle,
               'id_producto',               dp.id_producto,
               'nombre_producto',           pr.nombre,
               'cantidad',                  dp.cantidad,
               'precio_unitario_historico', dp.precio_unitario_historico,
               'notas_plato',               dp.notas_plato,
               'es_para_llevar',            dp.es_para_llevar,
               'opciones', (
                 SELECT json_agg(o.nombre_opcion)
                 FROM detalles_opciones dop
                 JOIN opciones o ON o.id_opcion = dop.id_opcion
                 WHERE dop.id_detalle = dp.id_detalle
               )
             ) ORDER BY dp.id_detalle
           ) AS items
    FROM pedidos p
    JOIN usuarios u    ON u.id_usuario = p.id_usuario_mesero
    JOIN detalles_pedido dp ON dp.id_pedido = p.id_pedido
    JOIN productos pr  ON pr.id_producto = dp.id_producto
    WHERE p.id_local = $1 AND p.estado_pago = 'PENDIENTE'
    GROUP BY p.id_pedido, u.nombre
    ORDER BY p.creado_en ASC
  `, [id_local]);
  return rows;
};

// ─── Actualizar estado de cocina ──────────────────────────────────────────────
const actualizarEstadoCocina = async (id_pedido, estado_cocina, id_local) => {
  const { rows } = await query(`
    UPDATE pedidos SET estado_cocina = $1 WHERE id_pedido = $2 RETURNING *
  `, [estado_cocina, id_pedido]);

  if (rows.length === 0) throw new Error('Pedido no encontrado');

  emitToLocal(id_local, Eventos.PEDIDO_ACTUALIZADO, {
    id_pedido,
    estado_cocina,
  });

  return rows[0];
};

// ─── Cobrar pedido (registrar pago y marcar como pagado) ─────────────────────
/**
 * @param {object} data
 * @param {number} data.id_pedido
 * @param {number} data.id_local
 * @param {number|null} data.id_sesion_caja
 * @param {number} data.id_usuario_cajero
 * @param {'EFECTIVO'|'YAPE'|'TARJETA'} data.metodo_pago
 * @param {number} data.monto
 */
const cobrar = async (data) => {
  const { id_pedido, id_local, id_sesion_caja, id_usuario_cajero, metodo_pago, monto } = data;

  return withTransaction(async (client) => {
    // Verificar pedido existe y está pendiente
    const { rows: [pedido] } = await client.query(`
      SELECT * FROM pedidos WHERE id_pedido = $1 FOR UPDATE
    `, [id_pedido]);

    if (!pedido) throw new Error('Pedido no encontrado');
    if (pedido.estado_pago !== 'PENDIENTE') {
      throw new Error(`Pedido ya está en estado: ${pedido.estado_pago}`);
    }

    // Registrar pago
    await client.query(`
      INSERT INTO pagos (id_pedido, id_sesion_caja, id_usuario_cajero, metodo_pago, monto)
      VALUES ($1,$2,$3,$4,$5)
    `, [id_pedido, id_sesion_caja || null, id_usuario_cajero, metodo_pago, monto]);

    // Marcar pedido como pagado
    await client.query(`
      UPDATE pedidos SET estado_pago = 'PAGADO' WHERE id_pedido = $1
    `, [id_pedido]);

    emitToLocal(id_local, Eventos.PEDIDO_PAGADO, { id_pedido, metodo_pago, monto });

    return { id_pedido, estado_pago: 'PAGADO', metodo_pago, monto };
  });
};

// ─── Historial (pedidos pagados/anulados) ────────────────────────────────────
const historial = async (id_local, { desde, hasta, pagina = 1, porPagina = 20 } = {}) => {
  const offset = (pagina - 1) * porPagina;
  const { rows } = await query(`
    SELECT p.id_pedido, p.tipo_pedido, p.identificador_cliente,
           p.estado_pago, p.creado_en, p.motivo_anulacion,
           u.nombre AS nombre_mesero,
           COALESCE(SUM(dp.cantidad * dp.precio_unitario_historico), 0) AS total
    FROM pedidos p
    JOIN usuarios u         ON u.id_usuario = p.id_usuario_mesero
    LEFT JOIN detalles_pedido dp ON dp.id_pedido = p.id_pedido
    WHERE p.id_local = $1
      AND p.estado_pago IN ('PAGADO','ANULADO')
      AND ($2::date IS NULL OR p.creado_en::date >= $2)
      AND ($3::date IS NULL OR p.creado_en::date <= $3)
    GROUP BY p.id_pedido, u.nombre
    ORDER BY p.creado_en DESC
    LIMIT $4 OFFSET $5
  `, [id_local, desde || null, hasta || null, porPagina, offset]);
  return rows;
};

// ─── Helper interno ───────────────────────────────────────────────────────────
const _obtenerCompleto = async (client, id_pedido) => {
  const { rows } = await client.query(`
    SELECT p.*,
           u.nombre AS nombre_mesero,
           json_agg(
             json_build_object(
               'id_detalle',   dp.id_detalle,
               'id_producto',  dp.id_producto,
               'nombre',       pr.nombre,
               'cantidad',     dp.cantidad,
               'precio',       dp.precio_unitario_historico,
               'notas',        dp.notas_plato,
               'llevar',       dp.es_para_llevar
             )
           ) AS items
    FROM pedidos p
    JOIN usuarios u         ON u.id_usuario = p.id_usuario_mesero
    JOIN detalles_pedido dp ON dp.id_pedido = p.id_pedido
    JOIN productos pr       ON pr.id_producto = dp.id_producto
    WHERE p.id_pedido = $1
    GROUP BY p.id_pedido, u.nombre
  `, [id_pedido]);
  return rows[0];
};

module.exports = { crear, listarActivos, actualizarEstadoCocina, cobrar, historial };
