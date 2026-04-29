const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { verificarToken, verificarLocal, requerirRol } = require('../middlewares/auth');

const mapProducto = (row) => ({
  id: row.id_producto,
  id_producto: row.id_producto,
  cat: row.categoria,
  categoria: row.categoria,
  name: row.nombre,
  nombre: row.nombre,
  price: Number(row.precio_base || 0),
  precio_base: Number(row.precio_base || 0),
  desc: row.descripcion || '',
  descripcion: row.descripcion || '',
});

const obtenerCategoria = async (nombre) => {
  const catName = String(nombre || 'Sin categoria').trim() || 'Sin categoria';
  const found = await query(
    'SELECT id_categoria FROM categorias WHERE lower(nombre) = lower($1) LIMIT 1',
    [catName]
  );
  if (found.rows.length) return found.rows[0].id_categoria;

  const created = await query(
    'INSERT INTO categorias (nombre) VALUES ($1) RETURNING id_categoria',
    [catName]
  );
  return created.rows[0].id_categoria;
};

router.get('/', verificarToken, verificarLocal, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT p.id_producto, p.nombre, p.precio_base, p.descripcion, c.nombre AS categoria
      FROM productos p
      JOIN categorias c ON c.id_categoria = p.id_categoria
      WHERE p.activo = true
        AND p.eliminado_en IS NULL
      ORDER BY c.nombre, p.nombre
    `);
    res.json(rows.map(mapProducto));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    const nombre = String(req.body.nombre || req.body.name || '').trim();
    const precio = Number(req.body.precio ?? req.body.price ?? 0);
    if (!nombre || !precio) return res.status(400).json({ error: 'nombre y precio son requeridos' });

    const idCategoria = await obtenerCategoria(req.body.cat || req.body.categoria);
    const { rows } = await query(`
      INSERT INTO productos (id_categoria, nombre, precio_base, descripcion)
      VALUES ($1, $2, $3, $4)
      RETURNING id_producto, nombre, precio_base, descripcion,
        (SELECT nombre FROM categorias WHERE id_categoria = $1) AS categoria
    `, [idCategoria, nombre, precio, req.body.desc || req.body.descripcion || null]);

    res.status(201).json(mapProducto(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id_producto', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    await query(`
      UPDATE productos
      SET activo = false, eliminado_en = CURRENT_TIMESTAMP
      WHERE id_producto = $1
    `, [req.params.id_producto]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
