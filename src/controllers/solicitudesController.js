// ============================================================
// controllers/solicitudesController.js
// ============================================================
const solicitudesService = require('../services/solicitudesService');

const crear = async (req, res) => {
  try {
    const { tipo, payload, id_pedido } = req.body;
    const { id_local, id_usuario } = req.usuario;

    if (!tipo || !payload) return res.status(400).json({ error: 'tipo y payload son requeridos' });

    const solicitud = await solicitudesService.crear({
      id_local,
      id_pedido: id_pedido || null,
      id_usuario_origen: id_usuario,
      tipo,
      payload,
    });

    res.status(201).json(solicitud);
  } catch (err) {
    console.error('[SolicitudesCtrl] crear:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const listarPendientes = async (req, res) => {
  try {
    const solicitudes = await solicitudesService.listarPendientes(req.localId);
    res.json(solicitudes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const resolver = async (req, res) => {
  try {
    const { id_solicitud } = req.params;
    const { decision, motivo_rechazo } = req.body;

    if (!decision) return res.status(400).json({ error: 'decision es requerida (APROBADO|RECHAZADO)' });

    const resultado = await solicitudesService.resolver({
      id_solicitud: parseInt(id_solicitud),
      id_local: req.localId,
      id_usuario_resolutor: req.usuario.id_usuario,
      decision,
      motivo_rechazo,
    });

    res.json(resultado);
  } catch (err) {
    const status = err.message.includes('no encontrada') ? 404
                 : err.message.includes('ya fue resuelta') ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
};

module.exports = { crear, listarPendientes, resolver };
