// ============================================================
// routes/solicitudesRoutes.js
// ============================================================
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/solicitudesController');
const { verificarToken, requerirRol, verificarLocal } = require('../middlewares/auth');

// Cualquier usuario autenticado puede crear una solicitud
router.post('/',
  verificarToken, verificarLocal,
  ctrl.crear
);

// Solo admin puede ver y resolver
router.get('/pendientes',
  verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'),
  ctrl.listarPendientes
);

router.patch('/:id_solicitud/resolver',
  verificarToken, verificarLocal, requerirRol('ADMIN', 'SUPERADMIN'),
  ctrl.resolver
);

module.exports = router;
