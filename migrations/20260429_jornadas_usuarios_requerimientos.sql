-- Migracion UTF-8: autenticacion por usuario, jornadas, locales alternos y requerimientos.
-- Ejecutar una vez en PostgreSQL antes de desplegar la version nueva.

BEGIN;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS numero_documento VARCHAR(15),
  ADD COLUMN IF NOT EXISTS codigo_usuario VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_codigo_usuario
  ON usuarios (lower(codigo_usuario))
  WHERE codigo_usuario IS NOT NULL AND eliminado_en IS NULL;

CREATE TABLE IF NOT EXISTS usuario_local (
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  id_local INTEGER NOT NULL REFERENCES locales(id_local) ON DELETE CASCADE,
  activo BOOLEAN DEFAULT true,
  creado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_usuario, id_local)
);

INSERT INTO usuario_local (id_usuario, id_local)
SELECT id_usuario, id_local
FROM usuarios
ON CONFLICT (id_usuario, id_local) DO NOTHING;

INSERT INTO roles (nombre_rol)
VALUES ('ATENCION_CLIENTE')
ON CONFLICT (nombre_rol) DO NOTHING;

ALTER TABLE solicitudes DROP CONSTRAINT IF EXISTS solicitudes_tipo_check;
ALTER TABLE solicitudes
  ADD CONSTRAINT solicitudes_tipo_check
  CHECK (
    tipo IN (
      'CAMBIO_PRECIO',
      'ANULACION_ITEM',
      'ANULACION_PEDIDO',
      'MODIFICACION',
      'DESCUENTO_GLOBAL',
      'ACCESO_DISPOSITIVO',
      'ACCESO_JORNADA'
    )
  );

CREATE TABLE IF NOT EXISTS asistencia (
  id_asistencia SERIAL PRIMARY KEY,
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  id_local INTEGER NOT NULL REFERENCES locales(id_local),
  id_dispositivo INTEGER REFERENCES dispositivos_autorizados(id_dispositivo),
  jornada_fecha DATE NOT NULL,
  metodo VARCHAR(30) NOT NULL DEFAULT 'PIN',
  entrada_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  ultimo_acceso_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE asistencia
  ADD COLUMN IF NOT EXISTS jornada_fecha DATE,
  ADD COLUMN IF NOT EXISTS ultimo_acceso_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP;

UPDATE asistencia
SET jornada_fecha = (entrada_en - INTERVAL '6 hours')::date
WHERE jornada_fecha IS NULL;

DELETE FROM asistencia a
USING asistencia b
WHERE a.id_asistencia > b.id_asistencia
  AND a.id_usuario = b.id_usuario
  AND a.id_local = b.id_local
  AND a.jornada_fecha = b.jornada_fecha;

ALTER TABLE asistencia
  ALTER COLUMN jornada_fecha SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_asistencia_usuario_local_jornada
  ON asistencia (id_usuario, id_local, jornada_fecha);

CREATE TABLE IF NOT EXISTS jornada_accesos (
  id_jornada_acceso SERIAL PRIMARY KEY,
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  id_local INTEGER NOT NULL REFERENCES locales(id_local),
  id_dispositivo INTEGER REFERENCES dispositivos_autorizados(id_dispositivo),
  id_solicitud INTEGER REFERENCES solicitudes(id_solicitud) ON DELETE SET NULL,
  jornada_fecha DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  metodo VARCHAR(30) NOT NULL DEFAULT 'PIN',
  nombre_equipo TEXT,
  id_usuario_autorizador INTEGER REFERENCES usuarios(id_usuario),
  solicitado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  autorizado_en TIMESTAMP WITHOUT TIME ZONE,
  actualizado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id_usuario, id_local, jornada_fecha)
);

CREATE INDEX IF NOT EXISTS idx_jornada_accesos_local_estado
  ON jornada_accesos (id_local, estado, jornada_fecha DESC);

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
);

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
);

CREATE INDEX IF NOT EXISTS idx_requerimientos_local_estado
  ON requerimientos (id_local, estado, creado_en DESC);

COMMIT;
