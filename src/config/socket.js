const { Server } = require('socket.io');

let _io = null;

/**
 * Inicializa Socket.io sobre el servidor HTTPS.
 * Llamar una sola vez desde server.js.
 * @param {import('https').Server} httpServer
 * @returns {import('socket.io').Server}
 */
const init = (httpServer) => {
  _io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  _io.on('connection', (socket) => {
    console.log(`[Socket] Cliente conectado: ${socket.id}`);

    // El cliente se une a la sala de su local al conectarse
    socket.on('join_local', (localId) => {
      const room = `local_${localId}`;
      socket.join(room);
      console.log(`[Socket] ${socket.id} → room ${room}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Cliente desconectado: ${socket.id} (${reason})`);
    });
  });

  return _io;
};

/**
 * Devuelve la instancia de Socket.io ya inicializada.
 * Lanza error si se llama antes de init().
 * @returns {import('socket.io').Server}
 */
const getIO = () => {
  if (!_io) throw new Error('Socket.io no inicializado. Llama a init(httpServer) primero.');
  return _io;
};

// ─── Helpers para emitir eventos a una sala de local ─────────────────────────

/**
 * Emite un evento a todos los clientes de un local.
 * @param {number|string} localId
 * @param {string} evento  Nombre del evento (ej: 'pedido:nuevo')
 * @param {any}    data    Payload del evento
 */
const emitToLocal = (localId, evento, data) => {
  getIO().to(`local_${localId}`).emit(evento, data);
};

// Eventos predefinidos (evitar typos en servicios):
const Eventos = {
  PEDIDO_NUEVO:          'pedido:nuevo',
  PEDIDO_ACTUALIZADO:    'pedido:actualizado',
  PEDIDO_PAGADO:         'pedido:pagado',
  PEDIDO_ANULADO:        'pedido:anulado',
  SOLICITUD_NUEVA:       'solicitud:nueva',
  SOLICITUD_RESUELTA:    'solicitud:resuelta',
  CAJA_ABIERTA:          'caja:abierta',
  CAJA_CERRADA:          'caja:cerrada',
  CONFIG_ACTUALIZADA:    'config:actualizada',
  COCINA_ITEM_LISTO:     'cocina:item_listo',
};

module.exports = { init, getIO, emitToLocal, Eventos };
