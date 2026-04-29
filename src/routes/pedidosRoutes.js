const express = require('express');
const router = express.Router();
const pedidosService = require('../services/pedidosService (1)');
const { query } = require('../config/db');
const { verificarToken, verificarLocal, requerirRol } = require('../middlewares/auth');
const { emitToLocal, Eventos } = require('../config/socket');
const { logAudit } = require('../services/auditoriaService');

const mapItem = (item = {}) => ({
  id: item.id_producto,
  id_producto: item.id_producto,
  id_detalle: item.id_detalle,
  name: item.nombre_producto || item.nombre,
  nombre: item.nombre_producto || item.nombre,
  qty: Number(item.cantidad || 0),
  cantidad: Number(item.cantidad || 0),
  price: Number(item.precio_unitario_historico ?? item.precio ?? 0),
  precio: Number(item.precio_unitario_historico ?? item.precio ?? 0),
  notes: item.notas_plato || item.notas || '',
  isLlevar: item.es_para_llevar || item.llevar || false,
});

const mapPedido = (pedido = {}) => {
  const items = (pedido.items || []).map(mapItem);
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const isMesa = pedido.tipo_pedido === 'MESA';
  const table = isMesa ? String(pedido.identificador_cliente || '').replace(/^Mesa\s*/i, '') : '';
  return {
    ...pedido,
    id: pedido.id_pedido,
    table,
    orderType: isMesa ? 'mesa' : 'llevar',
    createdAt: pedido.creado_en,
    paidAt: pedido.pagado_en,
    kitchenStatus: String(pedido.estado_cocina || 'PENDIENTE').toLowerCase(),
    isPaid: pedido.estado_pago === 'PAGADO',
    anulado: pedido.estado_pago === 'ANULADO',
    total,
    items,
    _mesero: pedido.nombre_mesero,
  };
};

const getSesionActiva = async (idLocal) => {
  const { rows } = await query(`
    SELECT id_sesion FROM sesiones_caja
    WHERE id_local = $1 AND fecha_cierre IS NULL
    ORDER BY fecha_apertura DESC
    LIMIT 1
  `, [idLocal]);
  return rows[0]?.id_sesion || null;
};

router.get('/activos', verificarToken, verificarLocal, async (req, res) => {
  try {
    const pedidos = await pedidosService.listarActivos(req.localId);
    res.json(pedidos.map(mapPedido));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/historial', verificarToken, verificarLocal, async (req, res) => {
  try {
    const pedidos = await pedidosService.historial(req.localId, req.query);
    res.json(pedidos.map(mapPedido));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', verificarToken, verificarLocal, async (req, res) => {
  try {
    const pedido = await pedidosService.crear({
      id_local: req.localId,
      id_sesion_caja: await getSesionActiva(req.localId),
      id_usuario_mesero: req.usuario.id_usuario,
      tipo_pedido: req.body.tipo_pedido,
      identificador_cliente: req.body.identificador_cliente,
      id_mesa: req.body.id_mesa || null,
      notas_generales: req.body.notas_generales || null,
      items: req.body.items || [],
    });
    await logAudit({
      req,
      accion: 'PEDIDO_CREAR',
      entidad: 'pedido',
      entidad_id: pedido.id_pedido,
      detalle: { tipo_pedido: req.body.tipo_pedido, items: (req.body.items || []).length },
    });
    res.status(201).json(mapPedido(pedido));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id_pedido/cobrar', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN', 'CAJERO'), async (req, res) => {
  try {
    const result = await pedidosService.cobrar({
      id_pedido: req.params.id_pedido,
      id_local: req.localId,
      id_sesion_caja: await getSesionActiva(req.localId),
      id_usuario_cajero: req.usuario.id_usuario,
      metodo_pago: req.body.metodo_pago,
      monto: req.body.monto,
    });
    await logAudit({
      req,
      accion: 'PEDIDO_COBRAR',
      entidad: 'pedido',
      entidad_id: req.params.id_pedido,
      detalle: { metodo_pago: req.body.metodo_pago, monto: req.body.monto, payments: req.body.payments },
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id_pedido/cocina', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN', 'COCINA', 'COCINERO'), async (req, res) => {
  try {
    const result = await pedidosService.actualizarEstadoCocina(
      req.params.id_pedido,
      req.body.estado_cocina,
      req.localId
    );
    await logAudit({
      req,
      accion: 'PEDIDO_COCINA_ESTADO',
      entidad: 'pedido',
      entidad_id: req.params.id_pedido,
      detalle: { estado_cocina: req.body.estado_cocina },
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id_pedido/anular', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN', 'CAJERO'), async (req, res) => {
  try {
    const { rows } = await query(`
      UPDATE pedidos
      SET estado_pago = 'ANULADO', motivo_anulacion = $1
      WHERE id_pedido = $2 AND id_local = $3
      RETURNING *
    `, [req.body.motivo || 'Sin motivo', req.params.id_pedido, req.localId]);
    emitToLocal(req.localId, Eventos.PEDIDO_ANULADO, { id_pedido: Number(req.params.id_pedido) });
    await logAudit({
      req,
      accion: 'PEDIDO_ANULAR',
      entidad: 'pedido',
      entidad_id: req.params.id_pedido,
      detalle: { motivo: req.body.motivo || 'Sin motivo' },
    });
    res.json(rows[0] || { ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id_pedido/checks', verificarToken, verificarLocal, async (req, res) => {
  res.json({ ok: true });
});

router.post('/:id_pedido/items', verificarToken, verificarLocal, async (req, res) => {
  res.status(501).json({ error: 'Agregar items a pedido existente aun no esta implementado en el backend.' });
});

router.post('/:id_pedido/finalizar', verificarToken, verificarLocal, async (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
