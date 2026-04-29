const express = require('express');
const cors = require('cors');
const http = require('http');
require('dotenv').config(); // Para leer tu .env

// Importamos la configuración de tu base de datos
const db = require('./config/db');
const { init: initSocket } = require('./config/socket');

const app = express();
const PORT = process.env.PORT || 3001;

// --- MIDDLEWARES ---
app.use(cors()); // Permite que tu React (que corre en otro puerto) se conecte sin errores
app.use(express.json()); // Permite que tu backend entienda los datos en formato JSON

// --- RUTAS DE PRUEBA ---


// ==========================================
// --- RUTAS REALES DE LA APLICACIÓN ---
// Importamos tus archivos de rutas
const authRoutes = require('./routes/authRoutes');
const configRoutes = require('./routes/configRoutes');
const solicitudesRoutes = require('./routes/solicitudesRoutes');
const facturacionRoutes = require('./routes/facturacionRoutes');
const menuRoutes = require('./routes/menuRoutes');
const mesasRoutes = require('./routes/mesasRoutes');
const cajaRoutes = require('./routes/cajaRoutes');
const usuariosRoutes = require('./routes/usuariosRoutes');
const pedidosRoutes = require('./routes/pedidosRoutes');
const requerimientosRoutes = require('./routes/requerimientosRoutes');
const reportesRoutes = require('./routes/reportesRoutes');
// (Importa aquí también las de facturación y solicitudes cuando las necesites)

// Le decimos a Express qué URL va a usar cada archivo
app.use('/api/auth', authRoutes);
app.use('/api/config', configRoutes);
app.use('/api/solicitudes', solicitudesRoutes);
app.use('/api/facturacion', facturacionRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/mesas', mesasRoutes);
app.use('/api/caja', cajaRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/requerimientos', requerimientosRoutes);
app.use('/api/reportes', reportesRoutes);
// ==========================================

// Ruta base
app.get('/', (req, res) => {
  res.send('🚀 ¡El backend de Mr. Papachos está vivo y coleando!');
});

// Ruta para probar la conexión directa a Supabase
app.get('/test-db', async (req, res) => {
  try {
    // Hacemos un ping rápido a la base de datos pidiendo la hora del servidor
    const result = await db.query('SELECT NOW()');
    res.json({ 
      exito: true, 
      mensaje: '¡Conexión a PostgreSQL en Supabase perfecta!',
      hora_servidor: result.rows[0].now 
    });
  } catch (error) {
    console.error('Error probando la BD:', error);
    res.status(500).json({ exito: false, error: error.message });
  }
});

// --- ENCENDER EL SERVIDOR ---
const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
  console.log(`🌐 Prueba general: http://localhost:${PORT}`);
  console.log(`🗄️  Prueba de BD:  http://localhost:${PORT}/test-db`);
  console.log(`=================================`);
});
