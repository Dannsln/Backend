const { query } = require('../config/db');

let schemaReady = false;

const ensureAuditSchema = async () => {
  if (schemaReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS auditoria_eventos (
      id_evento SERIAL PRIMARY KEY,
      id_local INTEGER REFERENCES locales(id_local),
      id_usuario INTEGER REFERENCES usuarios(id_usuario),
      accion VARCHAR(80) NOT NULL,
      entidad VARCHAR(80),
      entidad_id VARCHAR(80),
      detalle JSONB DEFAULT '{}'::jsonb,
      creado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_local_fecha
      ON auditoria_eventos (id_local, creado_en DESC)
  `);
  schemaReady = true;
};

const logAudit = async ({ req, id_local, id_usuario, accion, entidad, entidad_id, detalle = {} }) => {
  try {
    await ensureAuditSchema();
    await query(`
      INSERT INTO auditoria_eventos (id_local, id_usuario, accion, entidad, entidad_id, detalle)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [
      id_local ?? req?.localId ?? req?.usuario?.id_local ?? null,
      id_usuario ?? req?.usuario?.id_usuario ?? null,
      accion,
      entidad || null,
      entidad_id === undefined || entidad_id === null ? null : String(entidad_id),
      JSON.stringify(detalle || {}),
    ]);
  } catch (err) {
    console.warn('[Auditoria] No se pudo registrar evento:', err.message);
  }
};

const listarAuditoria = async ({ idLocal, desde, hasta, limite = 300 }) => {
  await ensureAuditSchema();
  const params = [idLocal];
  let where = 'a.id_local = $1';
  if (desde) {
    params.push(desde);
    where += ` AND a.creado_en::date >= $${params.length}`;
  }
  if (hasta) {
    params.push(hasta);
    where += ` AND a.creado_en::date <= $${params.length}`;
  }
  params.push(Number(limite) || 300);

  const { rows } = await query(`
    SELECT a.*, u.nombre AS usuario
    FROM auditoria_eventos a
    LEFT JOIN usuarios u ON u.id_usuario = a.id_usuario
    WHERE ${where}
    ORDER BY a.creado_en DESC
    LIMIT $${params.length}
  `, params);
  return rows;
};

module.exports = {
  ensureAuditSchema,
  listarAuditoria,
  logAudit,
};
