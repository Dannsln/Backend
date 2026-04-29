const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { verificarToken, verificarLocal, requerirRol } = require('../middlewares/auth');
const { createPdfBuffer, createXlsxBuffer } = require('../services/exportService');
const { listarAuditoria } = require('../services/auditoriaService');
const { ensureFacturacionSchema } = require('../controllers/facturacionController');

const dateWhere = (alias, params, { desde, hasta }) => {
  let where = `${alias}.id_local = $1`;
  if (desde) {
    params.push(desde);
    where += ` AND ${alias}.creado_en::date >= $${params.length}`;
  }
  if (hasta) {
    params.push(hasta);
    where += ` AND ${alias}.creado_en::date <= $${params.length}`;
  }
  return where;
};

const getVentas = async (idLocal, filters = {}) => {
  const params = [idLocal];
  const where = dateWhere('p', params, filters);

  const [resumen, metodos, productos] = await Promise.all([
    query(`
      WITH pedido_totales AS (
        SELECT p.id_pedido,
               COALESCE(SUM(dp.cantidad * dp.precio_unitario_historico),0) AS total
        FROM pedidos p
        LEFT JOIN detalles_pedido dp ON dp.id_pedido = p.id_pedido
        WHERE ${where}
          AND p.estado_pago = 'PAGADO'
        GROUP BY p.id_pedido
      )
      SELECT COUNT(*)::int AS pedidos,
             COALESCE(SUM(total),0)::numeric(12,2) AS total,
             COALESCE(AVG(total),0)::numeric(12,2) AS ticket_promedio
      FROM pedido_totales
    `, params),
    query(`
      SELECT COALESCE(pg.metodo_pago, 'SIN_METODO') AS metodo_pago,
             COUNT(*)::int AS operaciones,
             COALESCE(SUM(pg.monto),0)::numeric(12,2) AS total
      FROM pagos pg
      JOIN pedidos p ON p.id_pedido = pg.id_pedido
      WHERE ${where}
        AND p.estado_pago = 'PAGADO'
      GROUP BY pg.metodo_pago
      ORDER BY total DESC
    `, params),
    query(`
      SELECT pr.nombre,
             COALESCE(SUM(dp.cantidad),0)::int AS cantidad,
             COALESCE(SUM(dp.cantidad * dp.precio_unitario_historico),0)::numeric(12,2) AS total
      FROM detalles_pedido dp
      JOIN pedidos p ON p.id_pedido = dp.id_pedido
      JOIN productos pr ON pr.id_producto = dp.id_producto
      WHERE ${where}
        AND p.estado_pago = 'PAGADO'
      GROUP BY pr.nombre
      ORDER BY cantidad DESC, total DESC
      LIMIT 30
    `, params),
  ]);

  return {
    resumen: resumen.rows[0] || { pedidos: 0, total: 0, ticket_promedio: 0 },
    metodos: metodos.rows,
    productos: productos.rows,
  };
};

const getComprobantes = async (idLocal, filters = {}) => {
  await ensureFacturacionSchema();
  const params = [idLocal];
  const where = dateWhere('c', params, filters);
  const { rows } = await query(`
    SELECT c.id_comprobante, c.id_pedido, c.tipo_comprobante, c.serie, c.correlativo,
           c.monto_total, c.estado_sunat, c.hash_cpe, c.error_sunat, c.creado_en, c.enviado_en,
           cl.numero_documento, cl.razon_social
    FROM comprobantes c
    LEFT JOIN clientes cl ON cl.id_cliente = c.id_cliente
    WHERE ${where}
    ORDER BY c.creado_en DESC
    LIMIT 500
  `, params);
  return rows;
};

router.use(verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN', 'CAJERO'));

router.get('/ventas', async (req, res) => {
  try {
    const filters = { desde: req.query.desde, hasta: req.query.hasta };
    const [ventas, comprobantes] = await Promise.all([
      getVentas(req.localId, filters),
      getComprobantes(req.localId, filters),
    ]);
    res.json({
      ...ventas,
      comprobantes,
      comprobantes_resumen: {
        total: comprobantes.length,
        aceptados: comprobantes.filter(c => c.estado_sunat === 'ACEPTADO').length,
        pendientes: comprobantes.filter(c => c.estado_sunat === 'PENDIENTE').length,
        rechazados: comprobantes.filter(c => c.estado_sunat === 'RECHAZADO').length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/auditoria', requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    res.json(await listarAuditoria({
      idLocal: req.localId,
      desde: req.query.desde,
      hasta: req.query.hasta,
      limite: req.query.limite,
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/exportar', async (req, res) => {
  try {
    const formato = req.query.formato === 'pdf' ? 'pdf' : 'xlsx';
    const filters = { desde: req.query.desde, hasta: req.query.hasta };
    const ventas = await getVentas(req.localId, filters);
    const rows = [
      { seccion: 'Resumen', nombre: 'Pedidos cobrados', cantidad: ventas.resumen.pedidos, total: ventas.resumen.total },
      { seccion: 'Resumen', nombre: 'Ticket promedio', cantidad: '', total: ventas.resumen.ticket_promedio },
      ...ventas.metodos.map(m => ({ seccion: 'Metodo de pago', nombre: m.metodo_pago, cantidad: m.operaciones, total: m.total })),
      ...ventas.productos.map(p => ({ seccion: 'Producto', nombre: p.nombre, cantidad: p.cantidad, total: p.total })),
    ];
    const columns = [
      { label: 'Seccion', key: 'seccion' },
      { label: 'Nombre', key: 'nombre' },
      { label: 'Cantidad', key: 'cantidad' },
      { label: 'Total', key: 'total' },
    ];

    if (formato === 'pdf') {
      const buffer = createPdfBuffer({ title: 'Reporte de ventas', columns, rows });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="reporte-ventas.pdf"');
      return res.send(buffer);
    }

    const buffer = await createXlsxBuffer({ sheetName: 'Ventas', columns, rows });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte-ventas.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
