-- Base para facturacion electronica SUNAT UBL 2.1.
-- Ejecutar una vez en la base antes de emitir comprobantes en produccion.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS unidad_medida VARCHAR(8) DEFAULT 'NIU',
  ADD COLUMN IF NOT EXISTS tipo_afectacion_igv VARCHAR(4) DEFAULT '10',
  ADD COLUMN IF NOT EXISTS codigo_sunat_unspsc VARCHAR(16) DEFAULT '90101501';

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
);

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
);

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
);

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
);
