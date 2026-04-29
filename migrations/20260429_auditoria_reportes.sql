CREATE TABLE IF NOT EXISTS auditoria_eventos (
  id_evento SERIAL PRIMARY KEY,
  id_local INTEGER REFERENCES locales(id_local),
  id_usuario INTEGER REFERENCES usuarios(id_usuario),
  accion VARCHAR(80) NOT NULL,
  entidad VARCHAR(80),
  entidad_id VARCHAR(80),
  detalle JSONB DEFAULT '{}'::jsonb,
  creado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_local_fecha
  ON auditoria_eventos (id_local, creado_en DESC);
