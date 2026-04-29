/**
 * api.js — Cliente HTTP para el backend MigracionRest
 * Reemplaza todas las operaciones de Firestore en App.js
 *
 * Coloca este archivo en: src/api.js
 */

const BASE = process.env.REACT_APP_BACKEND_URL || "https://localhost:3001";

// ─── Helper base ──────────────────────────────────────────────────────────────
async function request(path, options = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    // Token expirado → limpiar sesión
    localStorage.removeItem("token");
    window.location.reload();
    return;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const get  = (path)         => request(path);
const post = (path, body)   => request(path, { method: "POST",  body });
const put  = (path, body)   => request(path, { method: "PUT",   body });
const patch= (path, body)   => request(path, { method: "PATCH", body });
const del  = (path)         => request(path, { method: "DELETE" });

// ════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════
export const auth = {
  /**
   * Login — reemplaza: sha256(pin) + Firebase getDoc(staffRef) + match pinHash
   * @param {string} numero_documento
   * @param {string} pin  (texto plano, el backend hace SHA-256)
   */
  login: (numero_documento, pin) =>
    post("/api/auth/login", { numero_documento, pin }),
};

// ════════════════════════════════════════════════════════════════
// PEDIDOS (activos + historial)
// Reemplaza: collection activos, historyCol, saveOrders, addHistory
// ════════════════════════════════════════════════════════════════
export const pedidos = {
  /** Carga inicial de pedidos activos (PENDIENTE) */
  listarActivos: () => get("/api/pedidos/activos"),

  /**
   * Crear pedido — reemplaza: saveOrders([...cur, newOrder])
   * El backend emite socket pedido:nuevo a todos los clientes del local
   */
  crear: (body) => post("/api/pedidos", body),

  /**
   * Cobrar pedido existente — reemplaza: addHistory(finished) + saveOrders(newOrders)
   * body: { metodo_pago, monto, descuento_pct?, descuento_motivo? }
   */
  cobrar: (id_pedido, body) => post(`/api/pedidos/${id_pedido}/cobrar`, body),

  /**
   * Anular pedido — reemplaza: update status=anulado + addHistory
   * body: { motivo, items? }
   */
  anular: (id_pedido, body) => post(`/api/pedidos/${id_pedido}/anular`, body),

  /**
   * Actualizar estado cocina — reemplaza: setDoc(activos, updatedOrder)
   * body: { estado_cocina }  → 'PENDIENTE' | 'LISTO'
   */
  actualizarCocina: (id_pedido, estado_cocina) =>
    patch(`/api/pedidos/${id_pedido}/cocina`, { estado_cocina }),

  /**
   * Marcar ítem verificado — reemplaza: toggleItemCheck setDoc
   * body: { idx_item, checks }
   */
  actualizarChecks: (id_pedido, body) =>
    patch(`/api/pedidos/${id_pedido}/checks`, body),

  /**
   * Agregar ítems a pedido existente (merge) — reemplaza: saveOrders con mergedItems
   * body: { items: [...] }
   */
  agregarItems: (id_pedido, body) =>
    post(`/api/pedidos/${id_pedido}/items`, body),

  /** Historial (pagados/anulados) */
  historial: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get(`/api/pedidos/historial${qs ? "?" + qs : ""}`);
  },

  /** Finalizar llevar (entregado) — reemplaza: finishPaidOrder */
  finalizar: (id_pedido) => post(`/api/pedidos/${id_pedido}/finalizar`),
};

// ════════════════════════════════════════════════════════════════
// MENÚ (customMenu)
// ════════════════════════════════════════════════════════════════
export const menu = {
  /** Carga el menú custom del local */
  obtener: () => get("/api/menu"),

  /**
   * Guardar ítem custom — reemplaza: saveMenu(v.filter(CUSTOM_...))
   * body: { nombre, cat, precio, desc }
   */
  agregarItem: (body) => post("/api/menu", body),

  /** Eliminar ítem custom */
  eliminarItem: (id_producto) => del(`/api/menu/${id_producto}`),
};

// ════════════════════════════════════════════════════════════════
// CONFIG (mesas, sonido, preferencias)
// Reemplaza: saveConfig, onSnapshot(configRef)
// ════════════════════════════════════════════════════════════════
export const config = {
  /** Carga toda la config del local */
  obtener: () => get("/api/config"),

  /**
   * Actualizar una clave — reemplaza: saveConfig({ mesas: newMesas })
   * body: { clave, valor }
   */
  actualizar: (clave, valor) => patch("/api/config", { clave, valor }),

  /** Actualizar varias claves — body: { num_mesas: 10, sonido_nuevos: true } */
  actualizarBulk: (cambios) => put("/api/config/bulk", cambios),
};

// ════════════════════════════════════════════════════════════════
// MESAS
// ════════════════════════════════════════════════════════════════
export const mesas = {
  listar: () => get("/api/mesas"),
  agregar: () => post("/api/mesas"),           // crea la siguiente mesa numerada
  eliminar: (id_mesa) => del(`/api/mesas/${id_mesa}`),
};

// ════════════════════════════════════════════════════════════════
// SOLICITUDES
// Reemplaza: saveSolicitudes, onSnapshot(solicitudesRef)
// ════════════════════════════════════════════════════════════════
export const solicitudes = {
  /** Carga solicitudes pendientes */
  listarPendientes: () => get("/api/solicitudes/pendientes"),

  /**
   * Crear solicitud — reemplaza: setSolicitudes([...s, newSol]) + saveSolicitudes
   * body: { tipo, id_pedido?, payload }
   */
  crear: (body) => post("/api/solicitudes", body),

  /**
   * Resolver (admin) — reemplaza: resolverSolicitud + aplicar efecto
   * body: { decision: 'APROBADO'|'RECHAZADO', motivo_rechazo? }
   */
  resolver: (id_solicitud, body) =>
    patch(`/api/solicitudes/${id_solicitud}/resolver`, body),
};

// ════════════════════════════════════════════════════════════════
// CAJA (sesiones)
// Reemplaza: saveCaja, abrirCaja, cerrarCaja, onSnapshot(cajaRef)
// ════════════════════════════════════════════════════════════════
export const caja = {
  /** Carga la sesión activa */
  obtenerActiva: () => get("/api/caja/activa"),

  /**
   * Abrir caja — reemplaza: abrirCaja(fondoInicial)
   * body: { fondo_inicial }
   */
  abrir: (fondo_inicial) => post("/api/caja/abrir", { fondo_inicial }),

  /**
   * Cerrar caja — reemplaza: cerrarCaja()
   */
  cerrar: () => post("/api/caja/cerrar"),
};

// ════════════════════════════════════════════════════════════════
// STAFF / USUARIOS
// Reemplaza: getStaff, saveStaff, onSnapshot(staffRef)
// ════════════════════════════════════════════════════════════════
export const staff = {
  /** Lista usuarios del local */
  listar: () => get("/api/usuarios"),

  /**
   * Crear usuario — reemplaza: saveStaff([...users, newUser])
   * body: { nombre, numero_documento, pin, roles[] }
   */
  crear: (body) => post("/api/usuarios", body),

  /**
   * Actualizar usuario — reemplaza: saveStaff(users.map(patch))
   * body: { nombre?, roles?, pin? }
   */
  actualizar: (id_usuario, body) => patch(`/api/usuarios/${id_usuario}`, body),

  /** Reset PIN — reemplaza: saveStaff(...pinHash:null) */
  resetPin: (id_usuario, nuevo_pin) =>
    patch(`/api/usuarios/${id_usuario}/pin`, { nuevo_pin }),

  /** Eliminar — reemplaza: saveStaff(users.filter) */
  eliminar: (id_usuario) => del(`/api/usuarios/${id_usuario}`),
};
