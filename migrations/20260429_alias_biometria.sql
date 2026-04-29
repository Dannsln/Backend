-- Nombre en clave privado y registro de biometria por dispositivo.
-- Ejecutar una vez en PostgreSQL antes de desplegar esta version.

BEGIN;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS nombre_clave_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS nombre_clave_registrado_en TIMESTAMP WITHOUT TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_nombre_clave_hash
  ON usuarios (nombre_clave_hash)
  WHERE nombre_clave_hash IS NOT NULL AND eliminado_en IS NULL;

ALTER TABLE dispositivos_autorizados
  ADD COLUMN IF NOT EXISTS biometria_registrada BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS biometria_registrada_en TIMESTAMP WITHOUT TIME ZONE;

UPDATE dispositivos_autorizados
SET biometria_registrada = false
WHERE biometria_registrada IS NULL;

COMMIT;
