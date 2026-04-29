const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'CAMBIA_ESTO_EN_PRODUCCION';

// ─── Generar token ────────────────────────────────────────────────────────────
/**
 * Genera un JWT con los datos del usuario.
 * Incluye local_id y roles para no hacer consultas adicionales en cada request.
 */
const generarToken = (usuario) => {
  const payload = {
    id_usuario: usuario.id_usuario,
    id_local:   usuario.id_local,
    nombre:     usuario.nombre,
    roles:      usuario.roles || [],           // ['ADMIN', 'CAJERO', ...]
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
};

// ─── Middleware principal ─────────────────────────────────────────────────────
/**
 * Verifica el JWT y adjunta req.usuario con id_usuario, id_local y roles.
 */
const verificarToken = (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario = decoded;   // { id_usuario, id_local, nombre, roles }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesión expirada' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// ─── Middleware de roles ──────────────────────────────────────────────────────
/**
 * Verifica que el usuario tenga al menos uno de los roles indicados.
 * Usar después de verificarToken.
 * @param {...string} rolesPermitidos
 */
const normalizarRol = (rol) => {
  const upper = String(rol || '').trim().toUpperCase();
  if (upper === 'COCINERO') return 'COCINA';
  return upper;
};

const requerirRol = (...rolesPermitidos) => (req, res, next) => {
  const permitidos = rolesPermitidos.map(normalizarRol);
  const rolesUsuario = (req.usuario.roles || []).map(normalizarRol);
  const tieneRol = rolesUsuario.some(r => permitidos.includes(r));
  if (!tieneRol) {
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  }
  next();
};

// ─── Middleware de local ──────────────────────────────────────────────────────
/**
 * Verifica que el recurso solicitado pertenezca al mismo local del token.
 * Compara req.params.localId (si existe) con req.usuario.id_local.
 * También pone req.localId = id_local del token para uso en controladores.
 */
const verificarLocal = (req, res, next) => {
  req.localId = req.usuario.id_local;

  // Si la ruta incluye un :localId explícito, validar que coincida
  if (req.params.localId !== undefined) {
    const paramLocal = parseInt(req.params.localId);
    if (paramLocal !== req.localId && !req.usuario.roles.includes('SUPERADMIN')) {
      return res.status(403).json({ error: 'Acceso denegado: local incorrecto' });
    }
  }
  next();
};

// ─── Login handler (para usar en routes/authRoutes.js) ───────────────────────
/**
 * POST /api/auth/login
 * Body: { numero_documento, pin }
 * Valida PIN con SHA-256 y retorna JWT.
 */
const loginHandler = async (req, res) => {
  try {
    const { numero_documento, pin } = req.body;
    if (!numero_documento || !pin) {
      return res.status(400).json({ error: 'numero_documento y pin son requeridos' });
    }

    // Buscar usuario con roles
    const { rows } = await query(`
      SELECT u.id_usuario, u.id_local, u.nombre, u.pin_hash,
             COALESCE(array_agg(r.nombre_rol) FILTER (WHERE r.nombre_rol IS NOT NULL), '{}') AS roles
      FROM usuarios u
      LEFT JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
      LEFT JOIN roles r        ON r.id_rol = ur.id_rol
      WHERE u.numero_documento = $1 AND u.activo = true
      GROUP BY u.id_usuario
    `, [numero_documento]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const usuario = rows[0];

    // Verificar PIN (el frontend manda SHA-256 del PIN)
    const pinHash = require('crypto')
      .createHash('sha256').update(pin).digest('hex');

    if (pinHash !== usuario.pin_hash) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = generarToken(usuario);
    res.json({
      token,
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre:     usuario.nombre,
        id_local:   usuario.id_local,
        roles:      usuario.roles,
      }
    });
  } catch (err) {
    console.error('[Auth] Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = { verificarToken, requerirRol, verificarLocal, generarToken, loginHandler };
