const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../config/db');
const { verificarToken, verificarLocal, requerirRol } = require('../middlewares/auth');
const {
  buildCodigoUsuario,
  ensureAuthSchema,
  hashPin,
} = require('../controllers/authController');
const { logAudit } = require('../services/auditoriaService');

const roleToApp = (role) => {
  const r = String(role || '').toUpperCase();
  if (r === 'ADMIN' || r === 'SUPERADMIN') return 'admin';
  if (r === 'CAJERO') return 'cajero';
  if (r === 'MESERO' || r === 'ATENCION_CLIENTE' || r === 'ATENCION AL CLIENTE') return 'mesero';
  if (r === 'COCINA' || r === 'COCINERO') return 'cocinero';
  return r.toLowerCase();
};

const roleToDb = (role) => {
  const r = String(role || '').trim().toUpperCase();
  if (r === 'ADMIN' || r === 'SUPERADMIN') return r;
  if (r === 'CAJERO') return 'CAJERO';
  if (r === 'MESERO' || r === 'ATENCION' || r === 'ATENCION_CLIENTE' || r === 'ATENCION AL CLIENTE') return 'ATENCION_CLIENTE';
  if (r === 'COCINERO' || r === 'COCINA') return 'COCINA';
  return r;
};

const normalizeLocalIds = (locales, fallbackLocal) => {
  const source = Array.isArray(locales) ? locales : [];
  return [...new Set([fallbackLocal, ...source.map((local) => Number(local?.id_local || local)).filter(Boolean)])];
};

const buildUniqueCodigo = async (client, user) => {
  const base = buildCodigoUsuario(user);
  let candidate = base;
  let suffix = 2;
  while (true) {
    const { rows } = await client.query(`
      SELECT id_usuario
      FROM usuarios
      WHERE lower(codigo_usuario) = lower($1)
        AND id_usuario <> $2
        AND eliminado_en IS NULL
      LIMIT 1
    `, [candidate, user.id_usuario || 0]);
    if (!rows.length) return candidate;
    candidate = `${base}${suffix++}`;
  }
};

const userSelect = `
  SELECT u.id_usuario, u.id_local, u.nombre, u.numero_documento, u.codigo_usuario, u.pin_hash,
         u.nombre_clave_hash,
         EXISTS (
           SELECT 1
           FROM dispositivos_autorizados da
           WHERE da.id_usuario = u.id_usuario
             AND da.estado = 'APROBADO'
             AND da.biometria_registrada = true
         ) AS biometria_registrada,
         COALESCE(array_agg(DISTINCT r.nombre_rol) FILTER (WHERE r.nombre_rol IS NOT NULL), '{}') AS roles,
         COALESCE(
           jsonb_agg(DISTINCT jsonb_build_object('id_local', l.id_local, 'nombre', l.nombre))
             FILTER (WHERE l.id_local IS NOT NULL),
           '[]'::jsonb
         ) AS locales
  FROM usuarios u
  LEFT JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
  LEFT JOIN roles r ON r.id_rol = ur.id_rol
  LEFT JOIN usuario_local ul ON ul.id_usuario = u.id_usuario AND ul.activo = true
  LEFT JOIN locales l ON l.activo = true AND (l.id_local = u.id_local OR l.id_local = ul.id_local)
`;

const mapUser = (u) => ({
  id: u.id_usuario,
  id_usuario: u.id_usuario,
  name: u.nombre,
  nombre: u.nombre,
  numero_documento: u.numero_documento || '',
  dni: u.numero_documento || '',
  codigo_usuario: u.codigo_usuario || buildCodigoUsuario(u),
  tiene_nombre_clave: Boolean(u.nombre_clave_hash),
  biometria_registrada: Boolean(u.biometria_registrada),
  roles: (u.roles || []).map(roleToApp),
  locales: Array.isArray(u.locales) ? u.locales : [],
  pinHash: u.pin_hash ? 'set' : null,
});

const listarUsuarios = async (idLocal) => {
  await ensureAuthSchema();
  const { rows } = await query(`
    ${userSelect}
    WHERE u.activo = true
      AND u.eliminado_en IS NULL
      AND EXISTS (
        SELECT 1 FROM usuario_local ul2
        WHERE ul2.id_usuario = u.id_usuario
          AND ul2.id_local = $1
          AND ul2.activo = true
      )
    GROUP BY u.id_usuario, u.id_local, u.nombre, u.numero_documento, u.codigo_usuario, u.pin_hash, u.nombre_clave_hash
    ORDER BY u.nombre
  `, [idLocal]);

  return rows.map(mapUser);
};

const obtenerUsuario = async (idUsuario) => {
  const { rows } = await query(`
    ${userSelect}
    WHERE u.id_usuario = $1
      AND u.activo = true
      AND u.eliminado_en IS NULL
    GROUP BY u.id_usuario, u.id_local, u.nombre, u.numero_documento, u.codigo_usuario, u.pin_hash, u.nombre_clave_hash
    LIMIT 1
  `, [idUsuario]);
  return rows.length ? mapUser(rows[0]) : null;
};

router.get('/', verificarToken, verificarLocal, async (req, res) => {
  try {
    res.json(await listarUsuarios(req.localId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/locales-disponibles', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id_local, nombre
      FROM locales
      WHERE activo = true
      ORDER BY nombre
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    await ensureAuthSchema();
    const nombre = String(req.body.nombre || req.body.name || '').trim();
    const numeroDocumento = String(req.body.numero_documento || req.body.dni || '').trim() || null;
    const roles = (req.body.roles || []).map(roleToDb).filter(Boolean);
    const localIds = normalizeLocalIds(req.body.locales || req.body.localIds, req.localId);

    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });

    const idUsuario = await withTransaction(async (client) => {
      const { rows } = await client.query(`
        INSERT INTO usuarios (id_local, nombre, numero_documento, pin_hash)
        VALUES ($1, $2, $3, $4)
        RETURNING id_usuario
      `, [req.localId, nombre, numeroDocumento, req.body.pin ? hashPin(req.body.pin) : '']);

      const id_usuario = rows[0].id_usuario;
      const codigo = await buildUniqueCodigo(client, { id_usuario, nombre, numero_documento: numeroDocumento });
      await client.query('UPDATE usuarios SET codigo_usuario = $1 WHERE id_usuario = $2', [codigo, id_usuario]);

      for (const roleName of roles.length ? roles : ['ATENCION_CLIENTE']) {
        await client.query(`
          INSERT INTO usuario_rol (id_usuario, id_rol)
          SELECT $1, id_rol FROM roles WHERE nombre_rol = $2
          ON CONFLICT DO NOTHING
        `, [id_usuario, roleName]);
      }

      for (const id_local of localIds) {
        await client.query(`
          INSERT INTO usuario_local (id_usuario, id_local, activo)
          VALUES ($1, $2, true)
          ON CONFLICT (id_usuario, id_local) DO UPDATE SET activo = true
        `, [id_usuario, id_local]);
      }

      return id_usuario;
    });

    res.status(201).json(await obtenerUsuario(idUsuario));
    await logAudit({ req, accion: 'USUARIO_CREAR', entidad: 'usuario', entidad_id: idUsuario, detalle: { nombre, roles, localIds } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id_usuario/pin', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    await query(`
      UPDATE usuarios
      SET pin_hash = $1, actualizado_en = CURRENT_TIMESTAMP
      WHERE id_usuario = $2
        AND EXISTS (
          SELECT 1 FROM usuario_local ul
          WHERE ul.id_usuario = usuarios.id_usuario
            AND ul.id_local = $3
            AND ul.activo = true
        )
    `, [req.body.nuevo_pin ? hashPin(req.body.nuevo_pin) : '', req.params.id_usuario, req.localId]);
    res.json({ ok: true });
    await logAudit({ req, accion: 'USUARIO_RESET_PIN', entidad: 'usuario', entidad_id: req.params.id_usuario });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id_usuario', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    await ensureAuthSchema();
    const idUsuario = Number(req.params.id_usuario);
    await withTransaction(async (client) => {
      const current = await client.query('SELECT * FROM usuarios WHERE id_usuario = $1 FOR UPDATE', [idUsuario]);
      if (!current.rows.length) throw new Error('Usuario no encontrado');

      const nombre = req.body.nombre || req.body.name || current.rows[0].nombre;
      const numeroDocumento = req.body.numero_documento !== undefined || req.body.dni !== undefined
        ? String(req.body.numero_documento || req.body.dni || '').trim() || null
        : current.rows[0].numero_documento;
      const codigo = await buildUniqueCodigo(client, { id_usuario: idUsuario, nombre, numero_documento: numeroDocumento });

      await client.query(`
        UPDATE usuarios
        SET nombre = $1,
            numero_documento = $2,
            codigo_usuario = $3,
            actualizado_en = CURRENT_TIMESTAMP
        WHERE id_usuario = $4
      `, [nombre, numeroDocumento, codigo, idUsuario]);

      if (Array.isArray(req.body.roles)) {
        await client.query('DELETE FROM usuario_rol WHERE id_usuario = $1', [idUsuario]);
        for (const roleName of req.body.roles.map(roleToDb).filter(Boolean)) {
          await client.query(`
            INSERT INTO usuario_rol (id_usuario, id_rol)
            SELECT $1, id_rol FROM roles WHERE nombre_rol = $2
            ON CONFLICT DO NOTHING
          `, [idUsuario, roleName]);
        }
      }

      if (Array.isArray(req.body.locales) || Array.isArray(req.body.localIds)) {
        const localIds = normalizeLocalIds(req.body.locales || req.body.localIds, req.localId);
        await client.query('UPDATE usuario_local SET activo = false WHERE id_usuario = $1', [idUsuario]);
        for (const idLocal of localIds) {
          await client.query(`
            INSERT INTO usuario_local (id_usuario, id_local, activo)
            VALUES ($1, $2, true)
            ON CONFLICT (id_usuario, id_local) DO UPDATE SET activo = true
          `, [idUsuario, idLocal]);
        }
      }
    });
    res.json(await obtenerUsuario(idUsuario));
    await logAudit({ req, accion: 'USUARIO_ACTUALIZAR', entidad: 'usuario', entidad_id: idUsuario, detalle: req.body });
  } catch (err) {
    const status = /no encontrado/i.test(err.message) ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.patch('/:id_usuario/acceso', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    await ensureAuthSchema();
    const idUsuario = Number(req.params.id_usuario);
    const result = await withTransaction(async (client) => {
      const current = await client.query(`
        SELECT id_usuario, nombre, numero_documento, codigo_usuario
        FROM usuarios
        WHERE id_usuario = $1
          AND activo = true
          AND eliminado_en IS NULL
        FOR UPDATE
      `, [idUsuario]);
      if (!current.rows.length) throw new Error('Usuario no encontrado');

      const user = current.rows[0];
      let codigo = user.codigo_usuario;
      if (req.body.regenerar_codigo !== false) {
        const base = buildCodigoUsuario(user);
        let suffix = Math.floor(100 + Math.random() * 900);
        while (true) {
          const candidate = `${base}${suffix}`;
          const exists = await client.query(`
            SELECT id_usuario
            FROM usuarios
            WHERE lower(codigo_usuario) = lower($1)
              AND id_usuario <> $2
              AND eliminado_en IS NULL
            LIMIT 1
          `, [candidate, idUsuario]);
          if (!exists.rows.length) {
            codigo = candidate;
            break;
          }
          suffix += 1;
        }
      }

      await client.query(`
        UPDATE usuarios
        SET codigo_usuario = $1,
            nombre_clave_hash = CASE WHEN $2 THEN NULL ELSE nombre_clave_hash END,
            nombre_clave_registrado_en = CASE WHEN $2 THEN NULL ELSE nombre_clave_registrado_en END,
            actualizado_en = CURRENT_TIMESTAMP
        WHERE id_usuario = $3
      `, [codigo, Boolean(req.body.reset_nombre_clave), idUsuario]);

      if (req.body.reset_biometria) {
        await client.query(`
          UPDATE dispositivos_autorizados
          SET biometria_registrada = false,
              biometria_registrada_en = NULL,
              actualizado_en = CURRENT_TIMESTAMP
          WHERE id_usuario = $1
        `, [idUsuario]);
      }

      return codigo;
    });

    await logAudit({
      req,
      accion: 'USUARIO_ACCESO_ACTUALIZAR',
      entidad: 'usuario',
      entidad_id: idUsuario,
      detalle: {
        codigo_usuario: result,
        reset_nombre_clave: Boolean(req.body.reset_nombre_clave),
        reset_biometria: Boolean(req.body.reset_biometria),
      },
    });
    res.json(await obtenerUsuario(idUsuario));
  } catch (err) {
    const status = /no encontrado/i.test(err.message) ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/:id_usuario', verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'), async (req, res) => {
  try {
    await query(`
      UPDATE usuarios
      SET activo = false, eliminado_en = CURRENT_TIMESTAMP
      WHERE id_usuario = $1
        AND EXISTS (
          SELECT 1 FROM usuario_local ul
          WHERE ul.id_usuario = usuarios.id_usuario
            AND ul.id_local = $2
            AND ul.activo = true
        )
    `, [req.params.id_usuario, req.localId]);
    res.json({ ok: true });
    await logAudit({ req, accion: 'USUARIO_ELIMINAR', entidad: 'usuario', entidad_id: req.params.id_usuario });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
