const express = require('express');
const router = express.Router();
const {
  identificarUsuario,
  iniciarSesion,
  listarUsuariosLogin,
  registrarBiometria,
  registrarNombreClave,
  reporteAsistencia,
  sesionActual,
} = require('../controllers/authController');
const { verificarToken, requerirRol, verificarLocal } = require('../middlewares/auth');

router.post('/identificar', identificarUsuario);
router.get('/usuarios-login', listarUsuariosLogin);
router.post('/login', iniciarSesion);
router.get('/me', verificarToken, verificarLocal, sesionActual);
router.post('/nombre-clave', verificarToken, verificarLocal, registrarNombreClave);
router.post('/biometria', verificarToken, verificarLocal, registrarBiometria);
router.get('/asistencia',
  verificarToken,
  verificarLocal,
  requerirRol('ADMIN', 'SUPERADMIN'),
  reporteAsistencia
);

module.exports = router;
