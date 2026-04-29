const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { verificarToken, verificarLocal, requerirRol } = require('../middlewares/auth');
const { emitToLocal, Eventos } = require('../config/socket');

const mapSesion = (row) => row ? ({
  ...row,
  isOpen: !row.fecha_cierre,
  openedAt: row.fecha_apertura,
  fondoInicial: Number(row.fondo_inicial || 0),
}) : null;

router.get('/activa', verificarToken, verificarLocal, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT *
      FROM sesiones_caja
      WHERE id_local = $1 AND fecha_cierre IS NULL
      ORDER BY fecha_apertura DESC
      LIMIT 1
    `, [req.localId]);
    res.json(mapSesion(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/abrir', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    const active = await query(
      'SELECT id_sesion FROM sesiones_caja WHERE id_local = $1 AND fecha_cierre IS NULL LIMIT 1',
      [req.localId]
    );
    if (active.rows.length) return res.status(409).json({ error: 'La caja ya esta abierta' });

    const { rows } = await query(`
      INSERT INTO sesiones_caja (id_local, id_usuario_apertura, fondo_inicial)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.localId, req.usuario.id_usuario, Number(req.body.fondo_inicial || 0)]);
    const sesion = mapSesion(rows[0]);
    emitToLocal(req.localId, Eventos.CAJA_ABIERTA, sesion);
    res.status(201).json(sesion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cerrar', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    const { rows } = await query(`
      UPDATE sesiones_caja
      SET id_usuario_cierre = $2, fecha_cierre = CURRENT_TIMESTAMP
      WHERE id_local = $1 AND fecha_cierre IS NULL
      RETURNING *
    `, [req.localId, req.usuario.id_usuario]);
    const sesion = mapSesion(rows[0]);
    emitToLocal(req.localId, Eventos.CAJA_CERRADA, sesion || { isOpen: false });
    res.json(sesion || { isOpen: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
