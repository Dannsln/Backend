const express = require('express');
const router = express.Router();
const service = require('../services/requerimientosService');
const { verificarToken, verificarLocal, requerirRol } = require('../middlewares/auth');

const puedeGestionar = requerirRol('ADMIN', 'SUPERADMIN', 'COCINA', 'COCINERO');

router.use(verificarToken, verificarLocal);

router.get('/plantilla', puedeGestionar, (req, res) => {
  res.json({ categorias: service.REQUERIMIENTOS_TEMPLATE });
});

router.get('/', puedeGestionar, async (req, res) => {
  try {
    res.json(await service.listar(req.localId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', puedeGestionar, async (req, res) => {
  try {
    const requerimiento = await service.crear({
      id_local: req.localId,
      usuario: req.usuario,
      body: req.body,
    });
    res.status(201).json(requerimiento);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id_requerimiento', puedeGestionar, async (req, res) => {
  try {
    const requerimiento = await service.obtener(req.localId, Number(req.params.id_requerimiento));
    if (!requerimiento) return res.status(404).json({ error: 'Requerimiento no encontrado.' });
    res.json(requerimiento);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id_requerimiento', puedeGestionar, async (req, res) => {
  try {
    res.json(await service.actualizar({
      id_local: req.localId,
      id_requerimiento: Number(req.params.id_requerimiento),
      usuario: req.usuario,
      body: req.body,
    }));
  } catch (err) {
    const status = /no encontrado|finalizado/i.test(err.message) ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/:id_requerimiento/finalizar', puedeGestionar, async (req, res) => {
  try {
    res.json(await service.finalizar({
      id_local: req.localId,
      id_requerimiento: Number(req.params.id_requerimiento),
      usuario: req.usuario,
    }));
  } catch (err) {
    const status = /no encontrado/i.test(err.message) ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.get('/:id_requerimiento/exportar', puedeGestionar, async (req, res) => {
  try {
    const formato = String(req.query.formato || 'xlsx').toLowerCase() === 'pdf' ? 'pdf' : 'xlsx';
    const archivo = await service.exportar({
      id_local: req.localId,
      id_requerimiento: Number(req.params.id_requerimiento),
      formato,
    });
    res.setHeader('Content-Type', archivo.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="FO-MP-02-${req.params.id_requerimiento}.${archivo.extension}"`);
    res.send(archivo.buffer);
  } catch (err) {
    const status = /no encontrado/i.test(err.message) ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
