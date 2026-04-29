const crypto = require('crypto');
const db = require('../config/db');
const jwt = require('jsonwebtoken');
const { emitToLocal, Eventos } = require('../config/socket');
const { createPdfBuffer, createXlsxBuffer } = require('../services/exportService');

const JWT_SECRET = process.env.JWT_SECRET || 'CAMBIA_ESTO_EN_PRODUCCION';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30h';
const NOMBRE_CLAVE_SECRET = process.env.NOMBRE_CLAVE_SECRET || process.env.ALIAS_SECRET || JWT_SECRET;
const ACCESS_REQUEST_TYPE = 'ACCESO_DISPOSITIVO';
const JORNADA_REQUEST_TYPE = 'ACCESO_JORNADA';
const JORNADA_CUTOFF_HOUR = Number(process.env.JORNADA_CUTOFF_HOUR || 6);
const JORNADA_REQUIERE_APROBACION = process.env.JORNADA_REQUIERE_APROBACION !== 'false';

let schemaReady = false;

const hashPin = (pin) =>
  crypto.createHash('sha256').update(String(pin || '')).digest('hex');

const normalizeRole = (role) => {
  const r = String(role || '').trim().toUpperCase();
  if (r === 'COCINERO') return 'COCINA';
  if (r === 'ATENCION' || r === 'ATENCION AL CLIENTE') return 'ATENCION_CLIENTE';
  return r;
};

const normalizeRoles = (roles = []) =>
  [...new Set((Array.isArray(roles) ? roles : [roles]).filter(Boolean).map(normalizeRole))];

const isAdminRole = (roles = []) =>
  normalizeRoles(roles).some((r) => r === 'ADMIN' || r === 'SUPERADMIN');

const sanitizeCodePart = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]/g, '');

const buildCodigoUsuario = ({ nombre, numero_documento, id_usuario }) => {
  const firstName = sanitizeCodePart(String(nombre || 'Usuario').trim().split(/\s+/)[0]) || 'Usuario';
  const suffix = sanitizeCodePart(numero_documento) || String(id_usuario || '').padStart(4, '0');
  return `${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}${suffix}`;
};

const normalizeNombreClave = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, '');

const validarNombreClave = (value) => {
  const nombreClave = normalizeNombreClave(value);
  if (!/^[a-z0-9._-]{3,32}$/.test(nombreClave) || !/[a-z]/.test(nombreClave)) {
    return {
      ok: false,
      nombreClave,
      error: 'El nombre en clave debe tener entre 3 y 32 caracteres, incluir una letra y usar solo letras, numeros, punto, guion o guion bajo.',
    };
  }
  return { ok: true, nombreClave };
};

const hashNombreClave = (value) => {
  const nombreClave = normalizeNombreClave(value);
  return crypto.createHash('sha256').update(`${NOMBRE_CLAVE_SECRET}:${nombreClave}`).digest('hex');
};

const ensureAuthSchema = async () => {
  if (schemaReady) return;
  await db.query(`
    ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS numero_documento VARCHAR(15),
      ADD COLUMN IF NOT EXISTS codigo_usuario VARCHAR(80),
      ADD COLUMN IF NOT EXISTS nombre_clave_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS nombre_clave_registrado_en TIMESTAMP WITHOUT TIME ZONE
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_codigo_usuario
      ON usuarios (lower(codigo_usuario))
      WHERE codigo_usuario IS NOT NULL AND eliminado_en IS NULL
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_nombre_clave_hash
      ON usuarios (nombre_clave_hash)
      WHERE nombre_clave_hash IS NOT NULL AND eliminado_en IS NULL
  `);
  await db.query(`
    ALTER TABLE dispositivos_autorizados
      ADD COLUMN IF NOT EXISTS biometria_registrada BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS biometria_registrada_en TIMESTAMP WITHOUT TIME ZONE
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS usuario_local (
      id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
      id_local INTEGER NOT NULL REFERENCES locales(id_local) ON DELETE CASCADE,
      activo BOOLEAN DEFAULT true,
      creado_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_usuario, id_local)
    )
  `);
  await db.query(`
    INSERT INTO usuario_local (id_usuario, id_local)
    SELECT id_usuario, id_local
    FROM usuarios
    ON CONFLICT (id_usuario, id_local) DO NOTHING
  `);
  await db.query(`
    INSERT INTO roles (nombre_rol)
    VALUES ('ATENCION_CLIENTE')
    ON CONFLICT (nombre_rol) DO NOTHING
  `);
  await db.query(`
    ALTER TABLE solicitudes DROP CONSTRAINT IF EXISTS solicitudes_tipo_check
  `);
  await db.query(`
    ALTER TABLE solicitudes
      ADD CONSTRAINT solicitudes_tipo_check
      CHECK (tipo IN (
        'CAMBIO_PRECIO',
        'ANULACION_ITEM',
        'ANULACION_PEDIDO',
        'MODIFICACION',
        'DESCUENTO_GLOBAL',
        'ACCESO_DISPOSITIVO',
        'ACCESO_JORNADA'
      ))
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS asistencia (
      id_asistencia SERIAL PRIMARY KEY,
      id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario),
      id_local INTEGER NOT NULL REFERENCES locales(id_local),
      id_dispositivo INTEGER REFERENCES dispositivos_autorizados(id_dispositivo),
      jornada_fecha DATE NOT NULL,
      metodo VARCHAR(30) NOT NULL DEFAULT 'PIN',
      entrada_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      ultimo_acceso_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    ALTER TABLE asistencia
      ADD COLUMN IF NOT EXISTS jornada_fecha DATE,
      ADD COLUMN IF NOT EXISTS ultimo_acceso_en TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
  `);
  await db.query(`
    UPDATE asistencia
    SET jornada_fecha = (entrada_en - INTERVAL '6 hours')::date
    WHERE jornada_fecha IS NULL
  `);
  await db.query(`
    DELETE FROM asistencia a
    USING asistencia b
    WHERE a.id_asistencia > b.id_asistencia
      AND a.id_usuario = b.id_usuario
      AND a.id_local = b.id_local
      AND a.jornada_fecha = b.jornada_fecha
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_asistencia_usuario_local_jornada
      ON asistencia (id_usuario, id_local, jornada_fecha)
  `);
  await db.query(`
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
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_jornada_accesos_local_estado
      ON jornada_accesos (id_local, estado, jornada_fecha DESC)
  `);
  schemaReady = true;
};

const generarToken = (usuario) => {
  const payload = {
    id_usuario: usuario.id_usuario,
    id_local: usuario.id_local,
    nombre: usuario.nombre,
    numero_documento: usuario.numero_documento || null,
    codigo_usuario: usuario.codigo_usuario || null,
    id_dispositivo: usuario.id_dispositivo || null,
    roles: normalizeRoles(usuario.roles),
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

const mapUsuario = (row) => {
  const roles = normalizeRoles(row.roles || []);
  const locales = Array.isArray(row.locales) && row.locales.length
    ? row.locales
    : [{ id_local: row.id_local, nombre: row.local_nombre || 'Local', roles }];

  return {
    id_usuario: row.id_usuario,
    id_local: row.id_local,
    nombre: row.nombre,
    numero_documento: row.numero_documento || '',
    codigo_usuario: row.codigo_usuario || buildCodigoUsuario(row),
    tiene_nombre_clave: Boolean(row.nombre_clave_hash),
    requiere_nombre_clave: !row.nombre_clave_hash,
    pin_hash: row.pin_hash,
    roles,
    local_nombre: row.local_nombre,
    locales: locales.map((local) => ({
      id_local: local.id_local,
      nombre: local.nombre,
      roles,
    })),
  };
};

const usuarioQuery = (where) => `
  SELECT u.id_usuario, u.id_local, u.nombre, u.numero_documento, u.codigo_usuario,
         u.nombre_clave_hash, u.pin_hash,
         lp.nombre AS local_nombre,
         COALESCE(array_agg(DISTINCT r.nombre_rol) FILTER (WHERE r.nombre_rol IS NOT NULL), '{}') AS roles,
         COALESCE(
           jsonb_agg(DISTINCT jsonb_build_object('id_local', l.id_local, 'nombre', l.nombre))
             FILTER (WHERE l.id_local IS NOT NULL),
           '[]'::jsonb
         ) AS locales
  FROM usuarios u
  JOIN locales lp ON lp.id_local = u.id_local
  LEFT JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
  LEFT JOIN roles r ON r.id_rol = ur.id_rol
  LEFT JOIN usuario_local ul ON ul.id_usuario = u.id_usuario AND ul.activo = true
  LEFT JOIN locales l ON l.activo = true AND (l.id_local = u.id_local OR l.id_local = ul.id_local)
  WHERE u.activo = true
    AND u.eliminado_en IS NULL
    AND lp.activo = true
    ${where}
  GROUP BY u.id_usuario, u.id_local, u.nombre, u.numero_documento, u.codigo_usuario,
           u.nombre_clave_hash, u.pin_hash, lp.nombre
`;

const listarUsuariosLogin = async (req, res) => {
  try {
    await ensureAuthSchema();
    const { rows } = await db.query(`
      ${usuarioQuery('')}
      ORDER BY u.nombre ASC, u.id_usuario ASC
      LIMIT 500
    `);
    res.json(rows.map(mapUsuario).map((usuario) => ({
      id_usuario: usuario.id_usuario,
      nombre: usuario.nombre,
      numero_documento: usuario.numero_documento,
      codigo_usuario: usuario.codigo_usuario,
      roles: usuario.roles,
      locales: usuario.locales,
      tiene_pin: Boolean(usuario.pin_hash),
    })));
  } catch (error) {
    console.error('[Auth] Error listando usuarios de login:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const buscarUsuarioPorCodigo = async (codigo) => {
  await ensureAuthSchema();
  const texto = String(codigo || '').trim();
  if (!texto) return [];

  const params = [];
  let where = '';

  if (/^\d+$/.test(texto)) {
    params.push(Number(texto), texto);
    where = 'AND (u.id_usuario = $1 OR u.numero_documento = $2)';
  } else {
    params.push(texto.toLowerCase(), hashNombreClave(texto));
    where = `
      AND (
        lower(u.codigo_usuario) = $1
        OR u.nombre_clave_hash = $2
      )
    `;
  }

  const { rows } = await db.query(`
    ${usuarioQuery(where)}
    ORDER BY u.nombre ASC, u.id_usuario ASC
    LIMIT 20
  `, params);
  return rows.map(mapUsuario);
};

const buscarUsuarioParaLogin = async (id_usuario, id_local) => {
  await ensureAuthSchema();
  const { rows } = await db.query(`
    ${usuarioQuery(`
      AND u.id_usuario = $1
      AND EXISTS (
        SELECT 1
        FROM usuario_local ul2
        WHERE ul2.id_usuario = u.id_usuario
          AND ul2.id_local = $2
          AND ul2.activo = true
      )
    `)}
    LIMIT 1
  `, [id_usuario, id_local]);

  if (!rows.length) return null;
  const usuario = mapUsuario(rows[0]);
  const selectedLocal = usuario.locales.find((local) => Number(local.id_local) === Number(id_local));
  return {
    ...usuario,
    id_local: Number(id_local),
    local_nombre: selectedLocal?.nombre || usuario.local_nombre,
    locales: selectedLocal ? [selectedLocal] : usuario.locales,
  };
};

const buildAuthUsuarioPayload = (usuario, dispositivo = null) => ({
  id_usuario: usuario.id_usuario,
  id_local: usuario.id_local,
  nombre: usuario.nombre,
  numero_documento: usuario.numero_documento,
  codigo_usuario: usuario.codigo_usuario,
  roles: usuario.roles,
  local_nombre: usuario.local_nombre,
  locales: usuario.locales,
  tiene_nombre_clave: Boolean(usuario.tiene_nombre_clave),
  requiere_nombre_clave: Boolean(usuario.requiere_nombre_clave),
  biometria_registrada: Boolean(dispositivo?.biometria_registrada),
  requiere_biometria: !Boolean(dispositivo?.biometria_registrada),
});

const crearSolicitudAcceso = async ({ id_local, id_usuario, id_dispositivo, nombre_equipo, token_dispositivo }) => {
  const payload = {
    id_dispositivo,
    nombre_equipo,
    token_dispositivo,
  };

  const existing = await db.query(`
    SELECT id_solicitud
    FROM solicitudes
    WHERE id_local = $1
      AND id_usuario_origen = $2
      AND tipo = $3
      AND estado = 'PENDIENTE'
      AND payload->>'id_dispositivo' = $4
    LIMIT 1
  `, [id_local, id_usuario, ACCESS_REQUEST_TYPE, String(id_dispositivo)]);

  if (existing.rows.length) return existing.rows[0];

  const { rows } = await db.query(`
    INSERT INTO solicitudes (id_local, id_usuario_origen, tipo, payload)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [id_local, id_usuario, ACCESS_REQUEST_TYPE, JSON.stringify(payload)]);

  try {
    emitToLocal(id_local, Eventos.SOLICITUD_NUEVA, rows[0]);
  } catch (err) {
    console.warn('[Auth] No se pudo emitir solicitud de acceso:', err.message);
  }

  return rows[0];
};

const jornadaActual = () => {
  const now = new Date();
  now.setHours(now.getHours() - JORNADA_CUTOFF_HOUR);
  return now.toISOString().slice(0, 10);
};

const crearSolicitudJornada = async ({ acceso, id_local, id_usuario, metodo, dispositivo, nombre_equipo }) => {
  const payload = {
    id_jornada_acceso: acceso.id_jornada_acceso,
    jornada_fecha: acceso.jornada_fecha,
    metodo,
    id_dispositivo: dispositivo?.id_dispositivo || null,
    nombre_equipo: nombre_equipo || dispositivo?.nombre_equipo || null,
  };

  const existing = await db.query(`
    SELECT id_solicitud
    FROM solicitudes
    WHERE id_local = $1
      AND id_usuario_origen = $2
      AND tipo = $3
      AND estado = 'PENDIENTE'
      AND payload->>'id_jornada_acceso' = $4
    LIMIT 1
  `, [id_local, id_usuario, JORNADA_REQUEST_TYPE, String(acceso.id_jornada_acceso)]);

  if (existing.rows.length) return existing.rows[0];

  const { rows } = await db.query(`
    INSERT INTO solicitudes (id_local, id_usuario_origen, tipo, payload)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [id_local, id_usuario, JORNADA_REQUEST_TYPE, JSON.stringify(payload)]);

  await db.query(`
    UPDATE jornada_accesos
    SET id_solicitud = $1,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_jornada_acceso = $2
  `, [rows[0].id_solicitud, acceso.id_jornada_acceso]);

  try {
    emitToLocal(id_local, Eventos.SOLICITUD_NUEVA, rows[0]);
  } catch (err) {
    console.warn('[Auth] No se pudo emitir solicitud de jornada:', err.message);
  }

  return rows[0];
};

const verificarAccesoJornada = async ({ usuario, dispositivo, metodo, nombre_equipo, esAdmin }) => {
  if (!JORNADA_REQUIERE_APROBACION || esAdmin) return { ok: true };

  const jornada = jornadaActual();
  const existing = await db.query(`
    SELECT *
    FROM jornada_accesos
    WHERE id_usuario = $1
      AND id_local = $2
      AND jornada_fecha = $3
    LIMIT 1
  `, [usuario.id_usuario, usuario.id_local, jornada]);

  let acceso = existing.rows[0] || null;

  if (acceso?.estado === 'APROBADO') return { ok: true };
  if (acceso?.estado === 'RECHAZADO') {
    return {
      ok: false,
      status: 403,
      body: {
        estado: 'JORNADA_RECHAZADA',
        mensaje: 'El administrador rechazo tu acceso para esta jornada.',
      },
    };
  }

  if (!acceso) {
    const { rows } = await db.query(`
      INSERT INTO jornada_accesos (
        id_usuario, id_local, id_dispositivo, jornada_fecha, estado, metodo, nombre_equipo
      )
      VALUES ($1, $2, $3, $4, 'PENDIENTE', $5, $6)
      RETURNING *
    `, [
      usuario.id_usuario,
      usuario.id_local,
      dispositivo?.id_dispositivo || null,
      jornada,
      metodo,
      nombre_equipo || dispositivo?.nombre_equipo || null,
    ]);
    acceso = rows[0];
  } else {
    const { rows } = await db.query(`
      UPDATE jornada_accesos
      SET id_dispositivo = COALESCE($1, id_dispositivo),
          metodo = $2,
          nombre_equipo = COALESCE($3, nombre_equipo),
          actualizado_en = CURRENT_TIMESTAMP
      WHERE id_jornada_acceso = $4
      RETURNING *
    `, [dispositivo?.id_dispositivo || null, metodo, nombre_equipo || dispositivo?.nombre_equipo || null, acceso.id_jornada_acceso]);
    acceso = rows[0];
  }

  await crearSolicitudJornada({
    acceso,
    id_local: usuario.id_local,
    id_usuario: usuario.id_usuario,
    metodo,
    dispositivo,
    nombre_equipo,
  });

  return {
    ok: false,
    status: 403,
    body: {
      estado: 'JORNADA_PENDIENTE',
      mensaje: 'Tu acceso para esta jornada esta pendiente de aprobacion del administrador.',
      jornada_fecha: jornada,
    },
  };
};

const registrarAsistencia = async ({ id_usuario, id_local, metodo, id_dispositivo }) => {
  try {
    await ensureAuthSchema();
    await db.query(`
      INSERT INTO asistencia (id_usuario, id_local, id_dispositivo, metodo, jornada_fecha)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id_usuario, id_local, jornada_fecha)
      DO UPDATE SET
        ultimo_acceso_en = CURRENT_TIMESTAMP,
        id_dispositivo = COALESCE(EXCLUDED.id_dispositivo, asistencia.id_dispositivo),
        metodo = EXCLUDED.metodo
    `, [id_usuario, id_local, id_dispositivo || null, metodo, jornadaActual()]);
  } catch (err) {
    console.warn('[Auth] No se pudo registrar asistencia:', err.message);
  }
};

const identificarUsuario = async (req, res) => {
  try {
    const { codigo } = req.body;
    const usuarios = await buscarUsuarioPorCodigo(codigo);

    if (usuarios.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado o inactivo.' });
    }

    if (usuarios.length > 1) {
      return res.status(409).json({
        error: 'Hay mas de un usuario con ese dato. Selecciona el usuario exacto del listado.',
        usuarios: usuarios.map((usuario) => ({
          id_usuario: usuario.id_usuario,
          nombre: usuario.nombre,
          numero_documento: usuario.numero_documento,
          codigo_usuario: usuario.codigo_usuario,
          roles: usuario.roles,
          locales: usuario.locales,
        })),
      });
    }

    const usuario = usuarios[0];
    res.json({
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        numero_documento: usuario.numero_documento,
        codigo_usuario: usuario.codigo_usuario,
        roles: usuario.roles,
        locales: usuario.locales,
        tiene_nombre_clave: usuario.tiene_nombre_clave,
        requiere_nombre_clave: usuario.requiere_nombre_clave,
      },
    });
  } catch (error) {
    console.error('[Auth] Error identificando usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const iniciarSesion = async (req, res) => {
  const {
    id_usuario,
    id_local,
    pin,
    nombre_equipo,
    token_dispositivo_guardado,
    biometrico,
  } = req.body;

  try {
    if (!id_usuario || !id_local) {
      return res.status(400).json({ error: 'id_usuario e id_local son requeridos.' });
    }

    const usuario = await buscarUsuarioParaLogin(id_usuario, id_local);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no habilitado para este local.' });
    }

    const roles = normalizeRoles(usuario.roles);
    const esAdmin = isAdminRole(roles);
    const usaBiometria = biometrico === true;
    let tokenDispositivo = token_dispositivo_guardado || null;

    if (usaBiometria && !tokenDispositivo) {
      return res.status(403).json({
        estado: 'BIOMETRIA_NO_REGISTRADA',
        mensaje: 'Primero inicia sesion con PIN y registra tu huella digital en este equipo.',
      });
    }

    if (!usaBiometria) {
      if (!usuario.pin_hash) {
        return res.status(403).json({
          estado: 'REQUIERE_PIN',
          mensaje: 'El usuario no tiene contraseña/PIN configurado. Solicita al administrador que lo registre.',
        });
      }

      if (!pin || hashPin(pin) !== usuario.pin_hash) {
        return res.status(401).json({ error: 'Contraseña/PIN incorrecto.' });
      }
    }

    let dispositivo = null;

    if (tokenDispositivo) {
      const deviceQuery = await db.query(`
        SELECT *
        FROM dispositivos_autorizados
        WHERE token_dispositivo = $1
          AND id_usuario = $2
        LIMIT 1
      `, [tokenDispositivo, id_usuario]);
      dispositivo = deviceQuery.rows[0] || null;

      if (!dispositivo) {
        return res.status(401).json({ error: 'Credencial de dispositivo no valida.' });
      }

      if (dispositivo.estado === 'REVOCADO') {
        return res.status(403).json({
          estado: 'DISPOSITIVO_REVOCADO',
          mensaje: 'El acceso desde este equipo fue revocado por el administrador.',
        });
      }

      if (dispositivo.estado === 'PENDIENTE' && !esAdmin) {
        return res.status(403).json({
          estado: 'DISPOSITIVO_PENDIENTE',
          mensaje: 'Equipo en revision. Pide al administrador que apruebe este acceso.',
          token_dispositivo: tokenDispositivo,
        });
      }

      if (dispositivo.estado === 'PENDIENTE' && esAdmin) {
        const { rows } = await db.query(`
          UPDATE dispositivos_autorizados
          SET estado = 'APROBADO', actualizado_en = CURRENT_TIMESTAMP
          WHERE id_dispositivo = $1
          RETURNING *
        `, [dispositivo.id_dispositivo]);
        dispositivo = rows[0];
      }
    }

    if (usaBiometria && !dispositivo?.biometria_registrada) {
      return res.status(403).json({
        estado: 'BIOMETRIA_NO_REGISTRADA',
        mensaje: 'La huella digital aun no esta registrada para este equipo.',
      });
    }

    if (!dispositivo) {
      tokenDispositivo = crypto.randomUUID();
      const estado = esAdmin ? 'APROBADO' : 'PENDIENTE';
      const { rows } = await db.query(`
        INSERT INTO dispositivos_autorizados (id_usuario, nombre_equipo, token_dispositivo, estado)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        id_usuario,
        nombre_equipo || 'Dispositivo desconocido',
        tokenDispositivo,
        estado,
      ]);
      dispositivo = rows[0];

      if (!esAdmin) {
        await crearSolicitudAcceso({
          id_local,
          id_usuario,
          id_dispositivo: dispositivo.id_dispositivo,
          nombre_equipo: dispositivo.nombre_equipo,
          token_dispositivo: tokenDispositivo,
        });

        return res.status(403).json({
          estado: 'DISPOSITIVO_PENDIENTE',
          mensaje: 'Nuevo dispositivo detectado. Se envio una solicitud al administrador.',
          token_dispositivo: tokenDispositivo,
        });
      }
    }

    const metodoLogin = usaBiometria ? 'BIOMETRICO' : 'PIN';
    const jornada = await verificarAccesoJornada({
      usuario: { ...usuario, roles },
      dispositivo,
      metodo: metodoLogin,
      nombre_equipo,
      esAdmin,
    });
    if (!jornada.ok) {
      return res.status(jornada.status || 403).json(jornada.body);
    }

    const token = generarToken({ ...usuario, id_dispositivo: dispositivo.id_dispositivo });
    await registrarAsistencia({
      id_usuario,
      id_local,
      metodo: metodoLogin,
      id_dispositivo: dispositivo.id_dispositivo,
    });

    res.json({
      estado: 'EXITO',
      mensaje: 'Bienvenido a Mr. Papachos',
      token,
      token_dispositivo: tokenDispositivo,
      jornada_fecha: jornadaActual(),
      usuario: buildAuthUsuarioPayload({ ...usuario, roles }, dispositivo),
    });
  } catch (error) {
    console.error('[Auth] Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const sesionActual = async (req, res) => {
  try {
    const usuario = await buscarUsuarioParaLogin(req.usuario.id_usuario, req.usuario.id_local);
    if (!usuario) return res.status(404).json({ error: 'Usuario no disponible.' });
    let dispositivo = null;
    if (req.usuario.id_dispositivo) {
      const deviceQuery = await db.query(`
        SELECT *
        FROM dispositivos_autorizados
        WHERE id_dispositivo = $1
          AND id_usuario = $2
        LIMIT 1
      `, [req.usuario.id_dispositivo, req.usuario.id_usuario]);
      dispositivo = deviceQuery.rows[0] || null;
    }
    res.json({
      usuario: buildAuthUsuarioPayload(usuario, dispositivo),
      jornada_fecha: jornadaActual(),
    });
  } catch (error) {
    console.error('[Auth] Error consultando sesion:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const registrarNombreClave = async (req, res) => {
  try {
    await ensureAuthSchema();
    const body = req.body || {};
    const validation = validarNombreClave(body.nombre_clave || body.nombreClave || body.alias);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const nombreClaveHash = hashNombreClave(validation.nombreClave);
    const ocupados = await db.query(`
      SELECT id_usuario
      FROM usuarios
      WHERE nombre_clave_hash = $1
        AND id_usuario <> $2
        AND eliminado_en IS NULL
      LIMIT 1
    `, [nombreClaveHash, req.usuario.id_usuario]);

    if (ocupados.rows.length) {
      return res.status(409).json({ error: 'Ese nombre en clave ya esta ocupado.' });
    }

    await db.query(`
      UPDATE usuarios
      SET nombre_clave_hash = $1,
          nombre_clave_registrado_en = CURRENT_TIMESTAMP,
          actualizado_en = CURRENT_TIMESTAMP
      WHERE id_usuario = $2
        AND activo = true
        AND eliminado_en IS NULL
    `, [nombreClaveHash, req.usuario.id_usuario]);

    res.json({
      ok: true,
      tiene_nombre_clave: true,
      requiere_nombre_clave: false,
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ese nombre en clave ya esta ocupado.' });
    }
    console.error('[Auth] Error registrando nombre en clave:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const registrarBiometria = async (req, res) => {
  try {
    await ensureAuthSchema();
    const body = req.body || {};
    const tokenDispositivo = body.token_dispositivo || body.tokenDispositivo || null;
    const params = req.usuario.id_dispositivo
      ? [req.usuario.id_dispositivo, req.usuario.id_usuario]
      : [tokenDispositivo, req.usuario.id_usuario];
    const where = req.usuario.id_dispositivo
      ? 'id_dispositivo = $1 AND id_usuario = $2'
      : 'token_dispositivo = $1 AND id_usuario = $2';

    if (!req.usuario.id_dispositivo && !tokenDispositivo) {
      return res.status(400).json({ error: 'No se encontro el dispositivo actual.' });
    }

    const { rows } = await db.query(`
      SELECT *
      FROM dispositivos_autorizados
      WHERE ${where}
      LIMIT 1
    `, params);

    const dispositivo = rows[0] || null;
    if (!dispositivo) return res.status(404).json({ error: 'Dispositivo no encontrado.' });
    if (dispositivo.estado !== 'APROBADO') {
      return res.status(403).json({
        estado: 'DISPOSITIVO_NO_APROBADO',
        mensaje: 'El dispositivo debe estar aprobado antes de registrar huella digital.',
      });
    }

    await db.query(`
      UPDATE dispositivos_autorizados
      SET biometria_registrada = true,
          biometria_registrada_en = CURRENT_TIMESTAMP,
          actualizado_en = CURRENT_TIMESTAMP
      WHERE id_dispositivo = $1
    `, [dispositivo.id_dispositivo]);

    res.json({
      ok: true,
      biometria_registrada: true,
      requiere_biometria: false,
    });
  } catch (error) {
    console.error('[Auth] Error registrando biometria:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const asistenciaColumns = [
  { label: 'Jornada', value: (row) => row.jornada_fecha },
  { label: 'Ingreso', value: (row) => row.entrada_en },
  { label: 'Ultimo acceso', value: (row) => row.ultimo_acceso_en },
  { label: 'Usuario', value: (row) => row.usuario },
  { label: 'DNI', value: (row) => row.numero_documento || '' },
  { label: 'Codigo usuario', value: (row) => row.codigo_usuario || '' },
  { label: 'Local', value: (row) => row.local },
  { label: 'Metodo', value: (row) => row.metodo },
  { label: 'Equipo', value: (row) => row.nombre_equipo || '' },
];

const reporteAsistencia = async (req, res) => {
  try {
    await ensureAuthSchema();
    const { desde, hasta, formato } = req.query;
    const params = [req.localId];
    let where = 'a.id_local = $1';

    if (desde) {
      params.push(desde);
      where += ` AND a.jornada_fecha >= $${params.length}`;
    }
    if (hasta) {
      params.push(hasta);
      where += ` AND a.jornada_fecha <= $${params.length}`;
    }

    const { rows } = await db.query(`
      SELECT a.id_asistencia, a.jornada_fecha, a.entrada_en, a.ultimo_acceso_en, a.metodo,
             u.id_usuario, u.nombre AS usuario, u.numero_documento, u.codigo_usuario,
             l.nombre AS local,
             d.nombre_equipo
      FROM asistencia a
      JOIN usuarios u ON u.id_usuario = a.id_usuario
      JOIN locales l ON l.id_local = a.id_local
      LEFT JOIN dispositivos_autorizados d ON d.id_dispositivo = a.id_dispositivo
      WHERE ${where}
      ORDER BY a.jornada_fecha DESC, a.entrada_en DESC
      LIMIT 1000
    `, params);

    if (formato === 'pdf') {
      const buffer = createPdfBuffer({ title: 'Reporte de asistencias', columns: asistenciaColumns, rows });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="asistencias.pdf"');
      return res.send(buffer);
    }

    if (formato === 'xlsx' || formato === 'excel') {
      const buffer = await createXlsxBuffer({ sheetName: 'Asistencias', columns: asistenciaColumns, rows });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="asistencias.xlsx"');
      return res.send(buffer);
    }

    res.json(rows);
  } catch (error) {
    console.error('[Auth] Error en reporte de asistencia:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

module.exports = {
  buildCodigoUsuario,
  ensureAuthSchema,
  hashPin,
  identificarUsuario,
  iniciarSesion,
  listarUsuariosLogin,
  normalizeRoles,
  registrarBiometria,
  registrarNombreClave,
  reporteAsistencia,
  sesionActual,
};
