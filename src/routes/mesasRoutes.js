const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { verificarToken, verificarLocal, requerirRol } = require('../middlewares/auth');

router.get('/', verificarToken, verificarLocal, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id_mesa, id_local, numero, capacidad, zona, activa
      FROM mesas
      WHERE id_local = $1 AND activa = true
      ORDER BY numero
    `, [req.localId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    const next = await query(
      'SELECT COALESCE(MAX(numero), 0) + 1 AS numero FROM mesas WHERE id_local = $1',
      [req.localId]
    );
    const { rows } = await query(`
      INSERT INTO mesas (id_local, numero)
      VALUES ($1, $2)
      RETURNING *
    `, [req.localId, next.rows[0].numero]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id_mesa', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    await query(`
      UPDATE mesas SET activa = false
      WHERE id_mesa = $1 AND id_local = $2
    `, [req.params.id_mesa, req.localId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
