const { query, withTransaction } = require('../config/db');
const { createPdfBuffer, createXlsxBuffer } = require('./exportService');
const { REQUERIMIENTOS_TEMPLATE, flattenedTemplate } = require('./requerimientosTemplate');

const ensureSchema = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS requerimientos (
      id_requerimiento SERIAL PRIMARY KEY,
      id_local INTEGER NOT NULL REFERENCES locales(id_local),
      estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
      local_area VARCHAR(150),
      responsable_cp VARCHAR(150),
      responsable_cr VARCHAR(150),
      fecha_requerimiento DATE DEFAULT CURRENT_DATE,
      fecha_entrega DATE,
      creado_por INTEGER REFERENCES usuarios(id_usuario),
      actualizado_por INTEGER REFERENCES usuarios(id_usuario),
      finalizado_por INTEGER REFERENCES usuarios(id_usuario),
      creado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      finalizado_en TIMESTAMP WITHOUT TIME ZONE
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS requerimiento_items (
      id_requerimiento_item SERIAL PRIMARY KEY,
      id_requerimiento INTEGER NOT NULL REFERENCES requerimientos(id_requerimiento) ON DELETE CASCADE,
      categoria VARCHAR(100) NOT NULL,
      item INTEGER NOT NULL,
      producto VARCHAR(200) NOT NULL,
      pedido BOOLEAN DEFAULT false,
      cantidad_pedida NUMERIC(12,2),
      cantidad_recibida NUMERIC(12,2),
      conforme BOOLEAN,
      marca VARCHAR(100),
      observaciones TEXT,
      actualizado_por INTEGER REFERENCES usuarios(id_usuario),
      actualizado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const normalizeItem = (item = {}) => ({
  categoria: String(item.categoria || 'SIN CATEGORIA').trim(),
  item: Number(item.item || 0),
  producto: String(item.producto || '').trim(),
  pedido: Boolean(item.pedido),
  cantidad_pedida: item.cantidad_pedida === '' || item.cantidad_pedida == null ? null : Number(item.cantidad_pedida),
  cantidad_recibida: item.cantidad_recibida === '' || item.cantidad_recibida == null ? null : Number(item.cantidad_recibida),
  conforme: item.conforme === '' || item.conforme == null ? null : Boolean(item.conforme),
  marca: item.marca || '',
  observaciones: item.observaciones || '',
});

const rowToRequerimiento = (row) => ({
  id_requerimiento: row.id_requerimiento,
  id: row.id_requerimiento,
  id_local: row.id_local,
  estado: row.estado,
  local_area: row.local_area,
  responsable_cp: row.responsable_cp,
  responsable_cr: row.responsable_cr,
  fecha_requerimiento: row.fecha_requerimiento,
  fecha_entrega: row.fecha_entrega,
  creado_en: row.creado_en,
  actualizado_en: row.actualizado_en,
  finalizado_en: row.finalizado_en,
  creado_por_nombre: row.creado_por_nombre,
  actualizado_por_nombre: row.actualizado_por_nombre,
  finalizado_por_nombre: row.finalizado_por_nombre,
});

const listar = async (idLocal) => {
  await ensureSchema();
  const { rows } = await query(`
    SELECT r.*,
           uc.nombre AS creado_por_nombre,
           ua.nombre AS actualizado_por_nombre,
           uf.nombre AS finalizado_por_nombre
    FROM requerimientos r
    LEFT JOIN usuarios uc ON uc.id_usuario = r.creado_por
    LEFT JOIN usuarios ua ON ua.id_usuario = r.actualizado_por
    LEFT JOIN usuarios uf ON uf.id_usuario = r.finalizado_por
    WHERE r.id_local = $1
    ORDER BY r.creado_en DESC
    LIMIT 100
  `, [idLocal]);
  return rows.map(rowToRequerimiento);
};

const obtener = async (idLocal, idRequerimiento) => {
  await ensureSchema();
  const { rows } = await query(`
    SELECT r.*,
           uc.nombre AS creado_por_nombre,
           ua.nombre AS actualizado_por_nombre,
           uf.nombre AS finalizado_por_nombre
    FROM requerimientos r
    LEFT JOIN usuarios uc ON uc.id_usuario = r.creado_por
    LEFT JOIN usuarios ua ON ua.id_usuario = r.actualizado_por
    LEFT JOIN usuarios uf ON uf.id_usuario = r.finalizado_por
    WHERE r.id_local = $1 AND r.id_requerimiento = $2
    LIMIT 1
  `, [idLocal, idRequerimiento]);

  if (!rows.length) return null;
  const { rows: itemRows } = await query(`
    SELECT *
    FROM requerimiento_items
    WHERE id_requerimiento = $1
    ORDER BY item ASC, id_requerimiento_item ASC
  `, [idRequerimiento]);

  return {
    ...rowToRequerimiento(rows[0]),
    items: itemRows,
  };
};

const insertarItems = async (client, idRequerimiento, items, idUsuario) => {
  for (const rawItem of items.map(normalizeItem).filter((item) => item.producto)) {
    await client.query(`
      INSERT INTO requerimiento_items (
        id_requerimiento, categoria, item, producto, pedido, cantidad_pedida,
        cantidad_recibida, conforme, marca, observaciones, actualizado_por
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      idRequerimiento,
      rawItem.categoria,
      rawItem.item,
      rawItem.producto,
      rawItem.pedido,
      rawItem.cantidad_pedida,
      rawItem.cantidad_recibida,
      rawItem.conforme,
      rawItem.marca,
      rawItem.observaciones,
      idUsuario,
    ]);
  }
};

const crear = async ({ id_local, usuario, body }) => {
  await ensureSchema();
  const items = Array.isArray(body.items) && body.items.length ? body.items : flattenedTemplate();

  const idRequerimiento = await withTransaction(async (client) => {
    const { rows } = await client.query(`
      INSERT INTO requerimientos (
        id_local, local_area, responsable_cp, responsable_cr,
        fecha_requerimiento, fecha_entrega, creado_por, actualizado_por
      )
      VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7,$7)
      RETURNING id_requerimiento
    `, [
      id_local,
      body.local_area || body.localArea || null,
      body.responsable_cp || body.responsableCP || null,
      body.responsable_cr || body.responsableCR || null,
      body.fecha_requerimiento || body.fechaRequerimiento || null,
      body.fecha_entrega || body.fechaEntrega || null,
      usuario.id_usuario,
    ]);
    await insertarItems(client, rows[0].id_requerimiento, items, usuario.id_usuario);
    return rows[0].id_requerimiento;
  });

  return obtener(id_local, idRequerimiento);
};

const actualizar = async ({ id_local, id_requerimiento, usuario, body }) => {
  await ensureSchema();
  await withTransaction(async (client) => {
    const { rows } = await client.query(`
      UPDATE requerimientos
      SET local_area = COALESCE($1, local_area),
          responsable_cp = COALESCE($2, responsable_cp),
          responsable_cr = COALESCE($3, responsable_cr),
          fecha_requerimiento = COALESCE($4::date, fecha_requerimiento),
          fecha_entrega = COALESCE($5::date, fecha_entrega),
          actualizado_por = $6,
          actualizado_en = CURRENT_TIMESTAMP
      WHERE id_local = $7 AND id_requerimiento = $8 AND estado <> 'FINALIZADO'
      RETURNING id_requerimiento
    `, [
      body.local_area || body.localArea || null,
      body.responsable_cp || body.responsableCP || null,
      body.responsable_cr || body.responsableCR || null,
      body.fecha_requerimiento || body.fechaRequerimiento || null,
      body.fecha_entrega || body.fechaEntrega || null,
      usuario.id_usuario,
      id_local,
      id_requerimiento,
    ]);

    if (!rows.length) throw new Error('Requerimiento no encontrado o finalizado.');
    if (Array.isArray(body.items)) {
      await client.query('DELETE FROM requerimiento_items WHERE id_requerimiento = $1', [id_requerimiento]);
      await insertarItems(client, id_requerimiento, body.items, usuario.id_usuario);
    }
  });

  return obtener(id_local, id_requerimiento);
};

const finalizar = async ({ id_local, id_requerimiento, usuario }) => {
  await ensureSchema();
  const { rows } = await query(`
    UPDATE requerimientos
    SET estado = 'FINALIZADO',
        finalizado_por = $1,
        finalizado_en = CURRENT_TIMESTAMP,
        actualizado_por = $1,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_local = $2 AND id_requerimiento = $3
    RETURNING id_requerimiento
  `, [usuario.id_usuario, id_local, id_requerimiento]);
  if (!rows.length) throw new Error('Requerimiento no encontrado.');
  return obtener(id_local, id_requerimiento);
};

const exportColumns = [
  { label: 'Item', value: (row) => row.item },
  { label: 'Categoria', value: (row) => row.categoria },
  { label: 'Producto/Insumo', value: (row) => row.producto },
  { label: 'Pedido', value: (row) => (row.pedido ? 'X' : '') },
  { label: 'Cantidad pedida', value: (row) => row.cantidad_pedida ?? '' },
  { label: 'Cantidad recibida', value: (row) => row.cantidad_recibida ?? '' },
  { label: 'Conforme', value: (row) => (row.conforme == null ? '' : row.conforme ? 'SI' : 'NO') },
  { label: 'Marca', value: (row) => row.marca || '' },
  { label: 'Observaciones', value: (row) => row.observaciones || '' },
];

const exportar = async ({ id_local, id_requerimiento, formato }) => {
  const requerimiento = await obtener(id_local, id_requerimiento);
  if (!requerimiento) throw new Error('Requerimiento no encontrado.');
  const rows = requerimiento.items || [];
  const title = `FO-MP-02 Lista de Requerimientos #${id_requerimiento}`;

  if (formato === 'pdf') {
    return {
      contentType: 'application/pdf',
      extension: 'pdf',
      buffer: createPdfBuffer({ title, columns: exportColumns, rows }),
    };
  }

  return {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
    buffer: await createXlsxBuffer({ sheetName: 'FO-MP-02', columns: exportColumns, rows }),
  };
};

module.exports = {
  REQUERIMIENTOS_TEMPLATE,
  actualizar,
  crear,
  exportar,
  finalizar,
  listar,
  obtener,
};
