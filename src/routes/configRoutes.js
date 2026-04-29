// ============================================================
// routes/configRoutes.js
// ============================================================
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/configController');
const { verificarToken, requerirRol, verificarLocal } = require('../middlewares/auth');

// GET /api/config — cualquier autenticado puede leer
router.get('/',
  verificarToken, verificarLocal,
  ctrl.obtenerTodo
);

// PATCH /api/config — solo admin
router.patch('/',
  verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'),
  ctrl.actualizar
);

// PUT /api/config/bulk — solo admin (actualizar varias claves)
router.put('/bulk',
  verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'),
  ctrl.actualizarBulk
);

module.exports = router;

// ============================================================
// routes/authRoutes.js
// ============================================================
const authRouter = express.Router();
const { loginHandler } = require('../middlewares/auth');

authRouter.post('/login', loginHandler);

module.exports.authRouter = authRouter;
