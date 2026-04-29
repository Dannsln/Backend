const configService = require('../services/configService');

const obtenerTodo = async (req, res) => {
  try {
    const config = await configService.obtenerTodo(req.localId);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const actualizar = async (req, res) => {
  try {
    const { clave, valor } = req.body;
    if (!clave || valor === undefined) {
      return res.status(400).json({ error: 'clave y valor son requeridos' });
    }
    const resultado = await configService.actualizar(req.localId, clave, valor);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const actualizarBulk = async (req, res) => {
  try {
    const cambios = req.body; // { num_mesas: 12, sonido_nuevos: false }
    if (!cambios || typeof cambios !== 'object') {
      return res.status(400).json({ error: 'Body debe ser un objeto { clave: valor }' });
    }
    const resultados = await configService.actualizarBulk(req.localId, cambios);
    res.json(resultados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { obtenerTodo, actualizar, actualizarBulk };
