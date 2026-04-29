const express = require('express');
const router = express.Router();
const {
  consultarDocumento,
  emitirComprobante,
  enviarComprobante,
  listarPorPedido,
  listarComprobantes,
  obtenerConfigFacturacion,
  obtenerComprobante,
} = require('../controllers/facturacionController');
const { verificarToken, verificarLocal, requerirRol } = require('../middlewares/auth');

router.use(verificarToken, verificarLocal);

router.post('/emitir', requerirRol('ADMIN', 'SUPERADMIN', 'CAJERO'), emitirComprobante);
router.get('/configuracion', requerirRol('ADMIN', 'SUPERADMIN'), obtenerConfigFacturacion);
router.get('/documento', requerirRol('ADMIN', 'SUPERADMIN', 'CAJERO'), consultarDocumento);
router.get('/comprobantes', requerirRol('ADMIN', 'SUPERADMIN', 'CAJERO'), listarComprobantes);
router.get('/pedido/:id_pedido', requerirRol('ADMIN', 'SUPERADMIN', 'CAJERO'), listarPorPedido);
router.get('/:id_comprobante', requerirRol('ADMIN', 'SUPERADMIN', 'CAJERO'), obtenerComprobante);
router.post('/:id_comprobante/enviar', requerirRol('ADMIN', 'SUPERADMIN', 'CAJERO'), enviarComprobante);

module.exports = router;
