/**
 * useAppData.js — Reemplaza el useEffect de Firestore de App.js
 *
 * ANTES (App.js líneas 4361-4421):
 *   useEffect(() => {
 *     let unsubOrders, unsubHistory, unsubMenu, ...
 *     const setupListeners = () => {
 *       unsubOrders = onSnapshot(collection(...activos), ...)
 *       unsubMenu   = onSnapshot(localFS.menuRef(), ...)
 *       ...
 *     }
 *   }, [currentUser]);
 *
 * DESPUÉS: simplemente llama a este hook en App.js:
 *   const {
 *     orders, setOrders, history, setHistory, menu, setMenu,
 *     mesasArr, setMesasArr, solicitudesData, setSolicitudesData,
 *     staffData, setStaffData, cajaData, setCajaData, loaded,
 *     socketOn
 *   } = useAppData(currentUser, MENU_BASE);
 *
 * Coloca este archivo en: src/hooks/useAppData.js
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import * as API from "../api";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "https://localhost:3001";

// Singleton de socket — una sola conexión para toda la app
let _socket = null;
const getSocket = () => {
  if (!_socket) {
    _socket = io(BACKEND_URL, {
      transports: ["websocket", "polling"],
      autoConnect: false,
    });
  }
  return _socket;
};

export function useAppData(currentUser, MENU_BASE) {
  const [orders,     setOrders]     = useState([]);
  const [history,    setHistory]    = useState([]);
  const [menu,       setMenu]       = useState(MENU_BASE);
  const [mesasArr,   setMesasArr]   = useState([]);
  const [solicitudesData, setSolicitudesData] = useState([]);
  const [staffData,  setStaffData]  = useState([]);
  const [cajaData,   setCajaData]   = useState(null);
  const [loaded,     setLoaded]     = useState(false);

  const listenersRef = useRef([]);

  // ─── socketOn: registra un listener y lo guarda para limpiar ─────────────
  const socketOn = useCallback((evento, cb) => {
    const socket = getSocket();
    socket.on(evento, cb);
    listenersRef.current.push({ evento, cb });
    return () => socket.off(evento, cb);
  }, []);

  // ─── Efecto principal: carga inicial + socket ─────────────────────────────
  useEffect(() => {
    if (!currentUser) return;

    setLoaded(false);
    const localId = currentUser.localId; // mismo que id_local en el backend
    const socket  = getSocket();

    // ── 1. Conectar socket ──────────────────────────────────────────────────
    if (!socket.connected) {
      const token = localStorage.getItem("token");
      socket.auth = { token };
      socket.connect();
    }

    socket.on("connect", () => {
      socket.emit("join_local", localId);
    });
    if (socket.connected) socket.emit("join_local", localId);

    // ── 2. Carga inicial de datos (REST) ────────────────────────────────────
    const cargarTodo = async () => {
      try {
        const [
          ordersData,
          historyData,
          menuData,
          configData,
          mesasData,
          solsData,
          staffRes,
          cajaRes,
        ] = await Promise.all([
          API.pedidos.listarActivos().catch(() => []),
          API.pedidos.historial({ pagina: 1, porPagina: 500 }).catch(() => []),
          API.menu.obtener().catch(() => []),
          API.config.obtener().catch(() => ({})),
          API.mesas.listar().catch(() => []),
          API.solicitudes.listarPendientes().catch(() => []),
          API.staff.listar().catch(() => []),
          API.caja.obtenerActiva().catch(() => null),
        ]);

        setOrders(ordersData);
        setHistory(historyData);

        // Menu: base fija + items custom del backend
        const customItems = menuData.filter(i => i.es_custom);
        setMenu([...MENU_BASE, ...customItems]);

        // Mesas: array de números igual que antes  →  [1, 2, 3, 4, 5...]
        setMesasArr(mesasData.map(m => m.numero));

        setSolicitudesData(solsData);
        setStaffData(staffRes);
        setCajaData(cajaRes);

        setLoaded(true);
      } catch (err) {
        console.error("[useAppData] Error al cargar datos iniciales:", err);
        setLoaded(true); // cargamos igual para no bloquear la UI
      }
    };

    cargarTodo();

    // ── 3. Listeners de socket (tiempo real) ────────────────────────────────
    // Equivalente exacto de cada onSnapshot que había en Firestore:

    // onSnapshot(activos) → pedido:nuevo
    const onPedidoNuevo = (pedido) => {
      setOrders(prev => {
        if (prev.find(o => o.id_pedido === pedido.id_pedido)) return prev;
        return [...prev, pedido];
      });
    };

    // onSnapshot(activos) → pedido:actualizado (cocina, checks, merge)
    const onPedidoActualizado = (pedido) => {
      setOrders(prev =>
        prev.map(o => o.id_pedido === pedido.id_pedido ? { ...o, ...pedido } : o)
      );
    };

    // addHistory + saveOrders → pedido:pagado (sale de activos, entra en historial)
    const onPedidoPagado = (pedido) => {
      setOrders(prev => prev.filter(o => o.id_pedido !== pedido.id_pedido));
      setHistory(prev => [pedido, ...prev]);
    };

    // anularPedido → pedido:anulado
    const onPedidoAnulado = ({ id_pedido }) => {
      setOrders(prev => prev.filter(o => o.id_pedido !== id_pedido));
      setHistory(prev =>
        prev.map(o => o.id_pedido === id_pedido ? { ...o, estado_pago: "ANULADO" } : o)
      );
    };

    // onSnapshot(solicitudesRef) → solicitud:nueva
    const onSolicitudNueva = (sol) => {
      setSolicitudesData(prev => {
        if (prev.find(s => s.id_solicitud === sol.id_solicitud)) return prev;
        return [...prev, sol];
      });
    };

    // resolverSolicitud → solicitud:resuelta
    const onSolicitudResuelta = ({ id_solicitud }) => {
      setSolicitudesData(prev =>
        prev.filter(s => s.id_solicitud !== id_solicitud)
      );
    };

    // onSnapshot(cajaRef) → caja:abierta / caja:cerrada
    const onCajaAbierta  = (data) => setCajaData({ ...data, isOpen: true  });
    const onCajaCerrada  = (data) => setCajaData({ ...data, isOpen: false });

    // onSnapshot(configRef) → config:actualizada  (mesas principalmente)
    const onConfigActualizada = ({ clave, valor }) => {
      if (clave === "num_mesas") {
        setMesasArr(Array.from({ length: valor }, (_, i) => i + 1));
      }
    };

    // Registrar todos
    const evs = [
      ["pedido:nuevo",        onPedidoNuevo],
      ["pedido:actualizado",  onPedidoActualizado],
      ["pedido:pagado",       onPedidoPagado],
      ["pedido:anulado",      onPedidoAnulado],
      ["solicitud:nueva",     onSolicitudNueva],
      ["solicitud:resuelta",  onSolicitudResuelta],
      ["caja:abierta",        onCajaAbierta],
      ["caja:cerrada",        onCajaCerrada],
      ["config:actualizada",  onConfigActualizada],
    ];
    evs.forEach(([ev, fn]) => socket.on(ev, fn));

    // ── Cleanup ─────────────────────────────────────────────────────────────
    return () => {
      evs.forEach(([ev, fn]) => socket.off(ev, fn));
      socket.off("connect");
    };
  }, [currentUser]);

  return {
    orders,     setOrders,
    history,    setHistory,
    menu,       setMenu,
    mesasArr,   setMesasArr,
    solicitudesData, setSolicitudesData,
    staffData,  setStaffData,
    cajaData,   setCajaData,
    loaded,
    socketOn,
  };
}
