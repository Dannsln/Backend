const db = require('../config/db');
const { generarXML, padCorrelativo } = require('../services/sunat/xmlGenerator');
const { firmarXML } = require('../services/sunat/signer');
const { enviarASunat } = require('../services/sunat/sunatApi');
const { logAudit } = require('../services/auditoriaService');

let schemaReady = false;

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const cleanDigits = (value) => String(value || '').replace(/\D/g, '');
const queryOf = (client) => (sql, params) => client.query(sql, params);

const getEmpresa = () => ({
  ruc: process.env.SUNAT_RUC || process.env.RUC_EMPRESA || '20100066603',
  razon_social: process.env.SUNAT_RAZON_SOCIAL || process.env.RAZON_SOCIAL_EMPRESA || 'MR. PAPACHOS S.A.C.',
  nombre_comercial: process.env.SUNAT_NOMBRE_COMERCIAL || 'MR. PAPACHOS',
  direccion: process.env.SUNAT_DIRECCION || '',
  ubigeo: process.env.SUNAT_UBIGEO || '',
  codigo_domicilio_fiscal: process.env.SUNAT_CODIGO_DOMICILIO || '0000',
});

const ensureFacturacionSchema = async (client = db) => {
  if (schemaReady) return;
  const run = queryOf(client);

  await run(`
    ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS unidad_medida VARCHAR(8) DEFAULT 'NIU',
      ADD COLUMN IF NOT EXISTS tipo_afectacion_igv VARCHAR(4) DEFAULT '10',
      ADD COLUMN IF NOT EXISTS codigo_sunat_unspsc VARCHAR(16) DEFAULT '90101501'
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id_cliente SERIAL PRIMARY KEY,
      id_local INTEGER NOT NULL REFERENCES locales(id_local),
      tipo_documento VARCHAR(2) NOT NULL,
      numero_documento VARCHAR(20) NOT NULL,
      razon_social VARCHAR(200) NOT NULL,
      direccion TEXT,
      email VARCHAR(200),
      creado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id_local, tipo_documento, numero_documento)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS series_comprobantes (
      id_serie SERIAL PRIMARY KEY,
      id_local INTEGER NOT NULL REFERENCES locales(id_local),
      tipo_comprobante VARCHAR(2) NOT NULL,
      serie VARCHAR(4) NOT NULL,
      correlativo_actual INTEGER NOT NULL DEFAULT 0,
      activo BOOLEAN NOT NULL DEFAULT true,
      creado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id_local, tipo_comprobante, serie)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS comprobantes (
      id_comprobante SERIAL PRIMARY KEY,
      id_local INTEGER NOT NULL REFERENCES locales(id_local),
      id_pedido INTEGER NOT NULL REFERENCES pedidos(id_pedido),
      id_cliente INTEGER REFERENCES clientes(id_cliente),
      tipo_comprobante VARCHAR(2) NOT NULL,
      tipo_operacion VARCHAR(4) NOT NULL DEFAULT '0101',
      serie VARCHAR(4) NOT NULL,
      correlativo INTEGER NOT NULL,
      nombre_archivo VARCHAR(96) NOT NULL,
      moneda VARCHAR(3) NOT NULL DEFAULT 'PEN',
      monto_gravado NUMERIC(12,2) NOT NULL DEFAULT 0,
      monto_igv NUMERIC(12,2) NOT NULL DEFAULT 0,
      monto_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      monto_descuento NUMERIC(12,2) NOT NULL DEFAULT 0,
      estado_sunat VARCHAR(24) NOT NULL DEFAULT 'PENDIENTE',
      hash_cpe TEXT,
      xml_firmado TEXT,
      cdr_base64 TEXT,
      cdr_respuesta TEXT,
      error_sunat TEXT,
      creado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      enviado_en TIMESTAMP WITHOUT TIME ZONE,
      actualizado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id_local, tipo_comprobante, serie, correlativo)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS cola_sunat (
      id_tarea SERIAL PRIMARY KEY,
      id_comprobante INTEGER NOT NULL REFERENCES comprobantes(id_comprobante) ON DELETE CASCADE,
      estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      intentos INTEGER NOT NULL DEFAULT 0,
      max_intentos INTEGER NOT NULL DEFAULT 5,
      ultimo_error TEXT,
      proximo_intento TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      procesado_en TIMESTAMP WITHOUT TIME ZONE,
      creado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id_comprobante)
    )
  `);

  schemaReady = true;
};

const validateComprobante = ({ tipo_comprobante, cliente }) => {
  if (!['01', '03'].includes(tipo_comprobante)) {
    throw new Error('tipo_comprobante debe ser 01 (factura) o 03 (boleta).');
  }

  if (tipo_comprobante === '01') {
    const ruc = cleanDigits(cliente?.numero_documento);
    if (cliente?.tipo_documento !== '6' || ruc.length !== 11) {
      throw new Error('La factura requiere RUC de 11 digitos.');
    }
    if (!String(cliente?.razon_social || '').trim()) {
      throw new Error('La factura requiere razon social.');
    }
  }
};

const normalizeCliente = (tipoComprobante, raw = {}) => {
  const numero = cleanDigits(raw.numero_documento || raw.documento || raw.ruc || raw.dni);
  if (tipoComprobante === '01') {
    return {
      tipo_documento: '6',
      numero_documento: numero,
      razon_social: String(raw.razon_social || raw.nombre || '').trim(),
      direccion: String(raw.direccion || '').trim(),
      email: String(raw.email || '').trim(),
    };
  }

  if (numero) {
    return {
      tipo_documento: raw.tipo_documento || '1',
      numero_documento: numero,
      razon_social: String(raw.razon_social || raw.nombre || 'CLIENTE').trim(),
      direccion: String(raw.direccion || '').trim(),
      email: String(raw.email || '').trim(),
    };
  }

  return {
    tipo_documento: '0',
    numero_documento: '00000000',
    razon_social: String(raw.razon_social || raw.nombre || 'CLIENTES VARIOS').trim() || 'CLIENTES VARIOS',
    direccion: '',
    email: '',
  };
};

const upsertCliente = async (client, idLocal, cliente) => {
  const { rows } = await client.query(`
    INSERT INTO clientes (id_local, tipo_documento, numero_documento, razon_social, direccion, email)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (id_local, tipo_documento, numero_documento)
    DO UPDATE SET
      razon_social = EXCLUDED.razon_social,
      direccion = EXCLUDED.direccion,
      email = EXCLUDED.email,
      actualizado_en = CURRENT_TIMESTAMP
    RETURNING *
  `, [
    idLocal,
    cliente.tipo_documento,
    cliente.numero_documento,
    cliente.razon_social,
    cliente.direccion || null,
    cliente.email || null,
  ]);
  return rows[0];
};

const obtenerPedido = async (client, idLocal, idPedido) => {
  const { rows } = await client.query(`
    SELECT p.*,
           COALESCE(SUM(dp.cantidad * dp.precio_unitario_historico), 0) AS total
    FROM pedidos p
    LEFT JOIN detalles_pedido dp ON dp.id_pedido = p.id_pedido
    WHERE p.id_pedido = $1
      AND p.id_local = $2
    GROUP BY p.id_pedido
    LIMIT 1
  `, [idPedido, idLocal]);

  if (!rows.length) throw new Error('Pedido no encontrado.');
  return rows[0];
};

const obtenerDetalles = async (client, idPedido) => {
  const { rows } = await client.query(`
    SELECT dp.id_detalle,
           dp.id_producto,
           dp.cantidad,
           dp.precio_unitario_historico,
           dp.notas_plato,
           p.nombre,
           COALESCE(p.unidad_medida, 'NIU') AS unidad_medida,
           COALESCE(p.tipo_afectacion_igv, '10') AS tipo_afectacion_igv,
           COALESCE(p.codigo_sunat_unspsc, '90101501') AS codigo_sunat_unspsc
    FROM detalles_pedido dp
    JOIN productos p ON p.id_producto = dp.id_producto
    WHERE dp.id_pedido = $1
    ORDER BY dp.id_detalle
  `, [idPedido]);

  if (!rows.length) throw new Error('El pedido no tiene items para facturar.');
  return rows;
};

const tomarCorrelativo = async (client, idLocal, tipoComprobante) => {
  const serie = tipoComprobante === '01'
    ? (process.env.SUNAT_SERIE_FACTURA || 'F001')
    : (process.env.SUNAT_SERIE_BOLETA || 'B001');

  await client.query(`
    INSERT INTO series_comprobantes (id_local, tipo_comprobante, serie)
    VALUES ($1,$2,$3)
    ON CONFLICT (id_local, tipo_comprobante, serie) DO NOTHING
  `, [idLocal, tipoComprobante, serie]);

  const { rows } = await client.query(`
    UPDATE series_comprobantes
    SET correlativo_actual = correlativo_actual + 1,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_local = $1
      AND tipo_comprobante = $2
      AND serie = $3
      AND activo = true
    RETURNING serie, correlativo_actual AS correlativo
  `, [idLocal, tipoComprobante, serie]);

  if (!rows.length) throw new Error(`Serie ${serie} no disponible.`);
  return rows[0];
};

const calcularTotales = (detalles) => {
  const total = round2(detalles.reduce((sum, item) =>
    sum + Number(item.cantidad || 0) * Number(item.precio_unitario_historico || 0), 0));
  const gravado = round2(total / 1.18);
  const igv = round2(total - gravado);
  return { total, gravado, igv };
};

const guardarComprobante = async (client, data) => {
  const { rows } = await client.query(`
    INSERT INTO comprobantes (
      id_local, id_pedido, id_cliente, tipo_comprobante, tipo_operacion, serie, correlativo,
      nombre_archivo, moneda, monto_gravado, monto_igv, monto_total, monto_descuento,
      estado_sunat, hash_cpe, xml_firmado
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *
  `, [
    data.id_local,
    data.id_pedido,
    data.id_cliente,
    data.tipo_comprobante,
    data.tipo_operacion,
    data.serie,
    data.correlativo,
    data.nombre_archivo,
    data.moneda,
    data.monto_gravado,
    data.monto_igv,
    data.monto_total,
    data.monto_descuento || 0,
    data.estado_sunat,
    data.hash_cpe,
    data.xml_firmado,
  ]);
  return rows[0];
};

const encolarSunat = async (client, idComprobante) => {
  await client.query(`
    INSERT INTO cola_sunat (id_comprobante)
    VALUES ($1)
    ON CONFLICT (id_comprobante) DO NOTHING
  `, [idComprobante]);
};

const emitirComprobante = async (req, res) => {
  const idPedido = Number(req.body.id_pedido || req.body.idPedido);
  const tipoComprobante = String(req.body.tipo_comprobante || req.body.tipoComprobante || '03');
  const clienteInput = normalizeCliente(tipoComprobante, req.body.cliente || {});

  try {
    if (!idPedido) return res.status(400).json({ error: 'id_pedido es requerido.' });
    validateComprobante({ tipo_comprobante: tipoComprobante, cliente: clienteInput });
    await ensureFacturacionSchema();

    let comprobanteGuardado;

    const { client, done } = await db.getClient();
    try {
      await client.query('BEGIN');

      const pedido = await obtenerPedido(client, req.localId, idPedido);
      const detalles = await obtenerDetalles(client, idPedido);
      const cliente = await upsertCliente(client, req.localId, clienteInput);
      const { serie, correlativo } = await tomarCorrelativo(client, req.localId, tipoComprobante);
      const { total, gravado, igv } = calcularTotales(detalles);
      const empresa = getEmpresa();
      const tipoOperacion = req.body.tipo_operacion || '0101';
      const nombreArchivo = `${empresa.ruc}-${tipoComprobante}-${serie}-${padCorrelativo(correlativo)}`;
      const comprobante = {
        serie,
        correlativo,
        tipo_comprobante: tipoComprobante,
        tipo_operacion: tipoOperacion,
        fecha_emision: new Date(),
        moneda: 'PEN',
        monto_total: total,
        monto_gravado: gravado,
        monto_igv: igv,
        monto_descuento: Number(req.body.monto_descuento || 0),
      };

      const xmlPlano = generarXML(comprobante, cliente, detalles, empresa);
      const { xmlFirmado, hashCPE } = firmarXML(xmlPlano);

      comprobanteGuardado = await guardarComprobante(client, {
        id_local: req.localId,
        id_pedido: pedido.id_pedido,
        id_cliente: cliente.id_cliente,
        tipo_comprobante: tipoComprobante,
        tipo_operacion: tipoOperacion,
        serie,
        correlativo,
        nombre_archivo: nombreArchivo,
        moneda: 'PEN',
        monto_gravado: gravado,
        monto_igv: igv,
        monto_total: total,
        monto_descuento: comprobante.monto_descuento,
        estado_sunat: 'PENDIENTE',
        hash_cpe: hashCPE,
        xml_firmado: xmlFirmado,
      });

      await encolarSunat(client, comprobanteGuardado.id_comprobante);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      done();
    }

    if (process.env.SUNAT_AUTO_SEND === 'true') {
      setTimeout(() => {
        enviarComprobanteSunat(comprobanteGuardado.id_comprobante).catch((err) => {
          console.error('[SUNAT] Error en envio asincrono:', err.message);
        });
      }, 100);
    }

    await logAudit({
      req,
      accion: 'FACTURACION_EMITIR',
      entidad: 'comprobante',
      entidad_id: comprobanteGuardado.id_comprobante,
      detalle: {
        id_pedido: idPedido,
        tipo_comprobante: comprobanteGuardado.tipo_comprobante,
        serie: comprobanteGuardado.serie,
        correlativo: comprobanteGuardado.correlativo,
        total: comprobanteGuardado.monto_total,
      },
    });

    res.status(201).json({
      exito: true,
      mensaje: 'Comprobante preparado para SUNAT',
      comprobante: {
        id_comprobante: comprobanteGuardado.id_comprobante,
        tipo_comprobante: comprobanteGuardado.tipo_comprobante,
        serie: `${comprobanteGuardado.serie}-${padCorrelativo(comprobanteGuardado.correlativo)}`,
        estado_sunat: comprobanteGuardado.estado_sunat,
        hash: comprobanteGuardado.hash_cpe,
        total: Number(comprobanteGuardado.monto_total),
      },
      ticket: {
        serie: `${comprobanteGuardado.serie}-${padCorrelativo(comprobanteGuardado.correlativo)}`,
        hash: comprobanteGuardado.hash_cpe,
        total: Number(comprobanteGuardado.monto_total),
      },
    });
  } catch (error) {
    console.error('[Facturacion] Error emitiendo comprobante:', error);
    const status = /requiere|debe|RUC|razon|tipo_|no encontrado|no tiene/i.test(error.message) ? 400 : 500;
    res.status(status).json({ error: error.message || 'Error procesando la facturacion.' });
  }
};

const enviarComprobanteSunat = async (idComprobante) => {
  await ensureFacturacionSchema();

  const { rows } = await db.query(`
    SELECT *
    FROM comprobantes
    WHERE id_comprobante = $1
    LIMIT 1
  `, [idComprobante]);

  const comprobante = rows[0];
  if (!comprobante) throw new Error('Comprobante no encontrado.');
  if (!comprobante.xml_firmado) throw new Error('Comprobante sin XML firmado.');

  const empresa = getEmpresa();
  if (!process.env.SUNAT_USUARIO || !process.env.SUNAT_CLAVE) {
    throw new Error('Configura SUNAT_USUARIO y SUNAT_CLAVE para enviar a SUNAT.');
  }

  const respuesta = await enviarASunat(
    empresa.ruc,
    process.env.SUNAT_USUARIO,
    process.env.SUNAT_CLAVE,
    comprobante.nombre_archivo,
    comprobante.xml_firmado
  );

  const estado = respuesta.exito ? 'ACEPTADO' : 'RECHAZADO';
  await db.query(`
    UPDATE comprobantes
    SET estado_sunat = $1,
        cdr_base64 = $2,
        cdr_respuesta = $3,
        error_sunat = $4,
        enviado_en = CURRENT_TIMESTAMP,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_comprobante = $5
  `, [
    estado,
    respuesta.cdrBase64 || null,
    respuesta.mensaje || null,
    respuesta.error || null,
    idComprobante,
  ]);

  await db.query(`
    UPDATE cola_sunat
    SET estado = $1,
        procesado_en = CURRENT_TIMESTAMP,
        ultimo_error = $2
    WHERE id_comprobante = $3
  `, [respuesta.exito ? 'COMPLETADO' : 'FALLIDO', respuesta.error || null, idComprobante]);

  return { ...respuesta, estado_sunat: estado };
};

const enviarComprobante = async (req, res) => {
  try {
    const result = await enviarComprobanteSunat(Number(req.params.id_comprobante));
    await logAudit({
      req,
      accion: 'FACTURACION_ENVIAR_SUNAT',
      entidad: 'comprobante',
      entidad_id: req.params.id_comprobante,
      detalle: result,
    });
    res.json(result);
  } catch (error) {
    const status = /configura|no encontrado/i.test(error.message) ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
};

const listarComprobantes = async (req, res) => {
  try {
    await ensureFacturacionSchema();
    const params = [req.localId];
    let where = 'c.id_local = $1';
    if (req.query.estado) {
      params.push(String(req.query.estado).toUpperCase());
      where += ` AND c.estado_sunat = $${params.length}`;
    }
    if (req.query.desde) {
      params.push(req.query.desde);
      where += ` AND c.creado_en::date >= $${params.length}`;
    }
    if (req.query.hasta) {
      params.push(req.query.hasta);
      where += ` AND c.creado_en::date <= $${params.length}`;
    }
    const { rows } = await db.query(`
      SELECT c.id_comprobante, c.id_pedido, c.tipo_comprobante, c.serie, c.correlativo,
             c.nombre_archivo, c.monto_total, c.estado_sunat, c.hash_cpe,
             c.cdr_respuesta, c.error_sunat, c.creado_en, c.enviado_en,
             cl.tipo_documento, cl.numero_documento, cl.razon_social
      FROM comprobantes c
      LEFT JOIN clientes cl ON cl.id_cliente = c.id_cliente
      WHERE ${where}
      ORDER BY c.creado_en DESC
      LIMIT 500
    `, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const obtenerConfigFacturacion = async (req, res) => {
  const empresa = getEmpresa();
  res.json({
    empresa: {
      ruc: empresa.ruc,
      razon_social: empresa.razon_social,
      nombre_comercial: empresa.nombre_comercial,
      direccion: empresa.direccion,
      ubigeo: empresa.ubigeo,
      codigo_domicilio_fiscal: empresa.codigo_domicilio_fiscal,
    },
    sunat: {
      modo: process.env.SUNAT_MODO || 'BETA',
      auto_send: process.env.SUNAT_AUTO_SEND === 'true',
      usuario_configurado: Boolean(process.env.SUNAT_USUARIO),
      clave_configurada: Boolean(process.env.SUNAT_CLAVE),
      serie_factura: process.env.SUNAT_SERIE_FACTURA || 'F001',
      serie_boleta: process.env.SUNAT_SERIE_BOLETA || 'B001',
    },
  });
};

const consultarDocumento = async (req, res) => {
  const tipo = String(req.query.tipo || req.body?.tipo || '').toUpperCase();
  const numero = cleanDigits(req.query.numero || req.body?.numero);
  if (!numero) return res.status(400).json({ error: 'numero es requerido.' });

  const baseUrl = tipo === 'RUC'
    ? process.env.RUC_API_URL
    : process.env.DNI_API_URL;
  const token = tipo === 'RUC'
    ? process.env.RUC_API_TOKEN
    : process.env.DNI_API_TOKEN;

  if (!baseUrl) {
    return res.status(501).json({
      error: `Configura ${tipo === 'RUC' ? 'RUC_API_URL' : 'DNI_API_URL'} para consulta automatica.`,
    });
  }

  try {
    const fetch = require('node-fetch');
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/${numero}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const obtenerComprobante = async (req, res) => {
  try {
    await ensureFacturacionSchema();
    const { rows } = await db.query(`
      SELECT c.id_comprobante, c.id_pedido, c.tipo_comprobante, c.serie, c.correlativo,
             c.nombre_archivo, c.monto_total, c.estado_sunat, c.hash_cpe,
             c.cdr_respuesta, c.error_sunat, c.creado_en, c.enviado_en,
             cl.tipo_documento, cl.numero_documento, cl.razon_social
      FROM comprobantes c
      LEFT JOIN clientes cl ON cl.id_cliente = c.id_cliente
      WHERE c.id_comprobante = $1
        AND c.id_local = $2
      LIMIT 1
    `, [req.params.id_comprobante, req.localId]);
    if (!rows.length) return res.status(404).json({ error: 'Comprobante no encontrado.' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const listarPorPedido = async (req, res) => {
  try {
    await ensureFacturacionSchema();
    const { rows } = await db.query(`
      SELECT id_comprobante, tipo_comprobante, serie, correlativo, monto_total,
             estado_sunat, hash_cpe, creado_en, enviado_en
      FROM comprobantes
      WHERE id_pedido = $1
        AND id_local = $2
      ORDER BY creado_en DESC
    `, [req.params.id_pedido, req.localId]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  consultarDocumento,
  emitirComprobante,
  enviarComprobante,
  enviarComprobanteSunat,
  ensureFacturacionSchema,
  listarComprobantes,
  listarPorPedido,
  obtenerConfigFacturacion,
  obtenerComprobante,
};
