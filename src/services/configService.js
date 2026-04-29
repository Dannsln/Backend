const { query } = require('../config/db');
const { emitToLocal, Eventos } = require('../config/socket');

// Caché en memoria para no hacer query en cada request
// Se invalida cuando se actualiza un valor
const _cache = new Map(); // key: `${id_local}` → { clave: valorParseado }

const _invalidarCache = (id_local) => _cache.delete(String(id_local));

// Valores por defecto si la clave no existe en DB
const DEFAULTS = {
  num_mesas:        10,
  sonido_nuevos:    true,
  sonido_cocina:    true,
  igv_porcentaje:   18,
  moneda_defecto:   'PEN',
  icbper_valor:     0.20,
  nombre_local:     'Mi Local',
};

// ─── Parser de valores tipados ────────────────────────────────────────────────
const parsear = (valor, tipo) => {
  switch (tipo) {
    case 'number':  return parseFloat(valor);
    case 'boolean': return valor === 'true' || valor === '1';
    case 'json':    try { return JSON.parse(valor); } catch { return valor; }
    default:        return valor;
  }
};

// ─── Obtener toda la config de un local ──────────────────────────────────────
const obtenerTodo = async (id_local) => {
  const key = String(id_local);

  if (_cache.has(key)) return _cache.get(key);

  const { rows } = await query(`
    SELECT clave, valor, tipo_valor FROM config_local WHERE id_local = $1
  `, [id_local]);

  const config = { ...DEFAULTS };
  for (const row of rows) {
    config[row.clave] = parsear(row.valor, row.tipo_valor);
  }

  _cache.set(key, config);
  return config;
};

// ─── Obtener un valor específico ──────────────────────────────────────────────
const obtener = async (id_local, clave) => {
  const config = await obtenerTodo(id_local);
  return config[clave] ?? DEFAULTS[clave] ?? null;
};

// ─── Actualizar un valor ──────────────────────────────────────────────────────
const actualizar = async (id_local, clave, valor, tipo_valor = 'text') => {
  // Inferir tipo si no se pasa
  if (typeof valor === 'boolean') tipo_valor = 'boolean';
  else if (typeof valor === 'number') tipo_valor = 'number';
  else if (typeof valor === 'object') tipo_valor = 'json';

  const valorStr = typeof valor === 'object'
    ? JSON.stringify(valor)
    : String(valor);

  await query(`
    INSERT INTO config_local (id_local, clave, valor, tipo_valor)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id_local, clave)
    DO UPDATE SET valor = $3, tipo_valor = $4
  `, [id_local, clave, valorStr, tipo_valor]);

  _invalidarCache(id_local);

  // Notificar a todos los clientes del local para que actualicen su config
  emitToLocal(id_local, Eventos.CONFIG_ACTUALIZADA, {
    clave,
    valor: parsear(valorStr, tipo_valor),
  });

  return { clave, valor: parsear(valorStr, tipo_valor) };
};

// ─── Actualizar múltiples valores ────────────────────────────────────────────
const actualizarBulk = async (id_local, cambios) => {
  const resultados = [];
  for (const [clave, valor] of Object.entries(cambios)) {
    resultados.push(await actualizar(id_local, clave, valor));
  }
  return resultados;
};

// ─── Inicializar config para un local nuevo ───────────────────────────────────
const inicializarLocal = async (id_local, nombre_local = 'Mi Local') => {
  const defaults = {
    nombre_local,
    num_mesas:      10,
    sonido_nuevos:  'true',
    sonido_cocina:  'true',
    igv_porcentaje: '18',
    moneda_defecto: 'PEN',
    icbper_valor:   '0.20',
  };

  const tipos = {
    nombre_local:   'text',
    num_mesas:      'number',
    sonido_nuevos:  'boolean',
    sonido_cocina:  'boolean',
    igv_porcentaje: 'number',
    moneda_defecto: 'text',
    icbper_valor:   'number',
  };

  for (const [clave, valor] of Object.entries(defaults)) {
    await query(`
      INSERT INTO config_local (id_local, clave, valor, tipo_valor)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id_local, clave) DO NOTHING
    `, [id_local, clave, valor, tipos[clave]]);
  }

  _invalidarCache(id_local);
};

module.exports = { obtenerTodo, obtener, actualizar, actualizarBulk, inicializarLocal };
