const { query, withTransaction } = require('../config/db');

// ─── Encolar un comprobante para envío ────────────────────────────────────────
const encolar = async (id_comprobante) => {
  const { rows } = await query(`
    INSERT INTO cola_sunat (id_comprobante)
    VALUES ($1)
    ON CONFLICT DO NOTHING
    RETURNING *
  `, [id_comprobante]);
  return rows[0];
};

// ─── Procesar la cola (llamar desde un setInterval o cron) ───────────────────
/**
 * Toma hasta `batch` tareas pendientes y las procesa.
 * @param {Function} emisorFn  — función que recibe id_comprobante y envía a SUNAT
 * @param {number}   batch     — cuántas tareas procesar por ciclo (default 5)
 */
const procesarCola = async (emisorFn, batch = 5) => {
  // Tomar tareas disponibles (proximo_intento <= ahora, intentos < max)
  const { rows: tareas } = await query(`
    UPDATE cola_sunat
    SET estado = 'PROCESANDO', intentos = intentos + 1
    WHERE id_tarea IN (
      SELECT id_tarea FROM cola_sunat
      WHERE estado IN ('PENDIENTE','PROCESANDO')
        AND intentos < max_intentos
        AND proximo_intento <= NOW()
      ORDER BY proximo_intento ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `, [batch]);

  for (const tarea of tareas) {
    try {
      const resultado = await emisorFn(tarea.id_comprobante);

      // Éxito: marcar como completado y actualizar estado en comprobantes
      await withTransaction(async (client) => {
        await client.query(`
          UPDATE cola_sunat
          SET estado = 'COMPLETADO', procesado_en = NOW()
          WHERE id_tarea = $1
        `, [tarea.id_tarea]);

        await client.query(`
          UPDATE comprobantes
          SET estado_sunat = 'ACEPTADO',
              hash_cpe    = $1,
              cdr_respuesta = $2
          WHERE id_comprobante = $3
        `, [resultado.hash_cpe, JSON.stringify(resultado.cdr), tarea.id_comprobante]);
      });

      console.log(`[ColaSUNAT] Comprobante ${tarea.id_comprobante} enviado exitosamente`);

    } catch (err) {
      // Error: calcular próximo intento con backoff exponencial
      const minutosEspera = Math.pow(2, tarea.intentos) * 2; // 2, 4, 8... minutos
      const nuevoEstado = tarea.intentos >= tarea.max_intentos ? 'FALLIDO' : 'PENDIENTE';

      await query(`
        UPDATE cola_sunat
        SET estado           = $1,
            ultimo_error     = $2,
            proximo_intento  = NOW() + ($3 || ' minutes')::interval
        WHERE id_tarea = $4
      `, [nuevoEstado, err.message, minutosEspera, tarea.id_tarea]);

      if (nuevoEstado === 'FALLIDO') {
        await query(`
          UPDATE comprobantes SET estado_sunat = 'RECHAZADO' WHERE id_comprobante = $1
        `, [tarea.id_comprobante]);
        console.error(`[ColaSUNAT] Comprobante ${tarea.id_comprobante} FALLIDO tras ${tarea.intentos} intentos`);
      } else {
        console.warn(`[ColaSUNAT] Reintento ${tarea.intentos}/${tarea.max_intentos} para comprobante ${tarea.id_comprobante} en ${minutosEspera}min`);
      }
    }
  }

  return tareas.length;
};

// ─── Iniciar el worker (llamar desde server.js) ───────────────────────────────
/**
 * Arranca el procesador de cola.
 * @param {Function} emisorFn  — tu función de envío a SUNAT (debe retornar { hash_cpe, cdr })
 * @param {number}   intervaloMs — cada cuánto ms revisar la cola (default: 30 segundos)
 */
const iniciarWorker = (emisorFn, intervaloMs = 30_000) => {
  console.log(`[ColaSUNAT] Worker iniciado (intervalo: ${intervaloMs / 1000}s)`);

  const tick = async () => {
    try {
      const procesadas = await procesarCola(emisorFn);
      if (procesadas > 0) {
        console.log(`[ColaSUNAT] Procesadas ${procesadas} tareas`);
      }
    } catch (err) {
      console.error('[ColaSUNAT] Error en worker:', err.message);
    }
  };

  // Primera ejecución inmediata, luego cada intervalo
  tick();
  return setInterval(tick, intervaloMs);
};

module.exports = { encolar, procesarCola, iniciarWorker };
