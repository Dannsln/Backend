/**
 * productosMap.js — Mapa de IDs locales del menú a id_producto de PostgreSQL
 *
 * ANTES de usar submitOrder con el nuevo backend, ejecuta en pgAdmin:
 *
 *   SELECT id_producto, nombre FROM productos ORDER BY id_producto;
 *
 * Y llena este mapa con los resultados.
 * Coloca en: src/productosMap.js
 *
 * Mientras tanto, useSubmitOrder() usa el nombre como fallback.
 */

// Formato: { [id_firestore]: id_producto_postgres }
export const PRODUCTOS_MAP = {
  // Hamburguesas
  "H01":  1,  // Hamburguesa Silvestre
  "H02":  2,  // Hamburguesa Piolín
  "H03":  3,  // Hamburguesa Speedy Gonzales
  "H04":  4,  // Hamburguesa Cajacha
  "H05":  5,  // Hamburguesa Coyote
  "H06":  6,  // Hamburguesa Super Cajacha
  "H07":  7,  // Hamburguesa Bugs Bunny
  "H08":  8,  // Hamburguesa Cajamarquesa
  "H09":  9,  // Hamburguesa Porky
  "H10": 10,  // Hamburguesa Tazmania
  "H11": 11,  // Hamburguesa Papachos
  // Salchipapas
  "S01": 12,
  "S02": 13,
  "S03": 14,
  "S04": 15,
  "S05": 16,
  "S06": 17,
  "S07": 18,
  "S08": 19,
  "S09": 20,
  "S10": 21,
  "S11": 22,
  "S12": 23,
  "S13": 24,
  // Alitas
  "A01": 25,
  "A02": 26,
  "A03": 27,
  "A04": 28,
  "A05": 29,
  // Alichaufa
  "AC01": 30,
  "AC02": 31,
  "AC03": 32,
  "AC04": 33,
  // Pollo Broaster
  "PB01": 34,
  "PB02": 35,
  "PB03": 36,
  "PB04": 37,
  // Mostrito Broaster
  "MB01": 38,
  "MB02": 39,
  "MB03": 40,
  "MB04": 41,
  // Platos Extras
  "PE01": 42,
  "PE02": 43,
  "PE03": 44,
  "PE04": 45,
  "PE05": 46,
  "PE06": 47,
  "PE07": 48,
  "PE08": 49,
  "PE09": 50,
  "PE10": 51,
  "PE11": 52,
  "PE12": 53,
  "PE13": 54,
  // Menú Kids
  "MK01": 55,
  "MK02": 56,
  "MK03": 57,
  "MK04": 58,
  // Combos
  "C01": 59,
  "C02": 60,
  "C03": 61,
  "C04": 62,
  // Rondas
  "R01": 63,
  "R02": 64,
  // Bebidas
  "B01": 65,
  "B02": 66,
  "B03": 67,
  "B04": 68,
  "B05": 69,
  "B06": 70,
  "B07": 71,
  "B08": 72,
  "B09": 73,
  "B10": 74,
  "B11": 75,
  "B12": 76,
  // ... el resto de bebidas y tapers
};

/**
 * Convierte un ítem del draft de App.js al formato que espera el backend.
 * @param {object} item  — ítem del draft  { id, name, price, qty, individualNotes, salsas, ... }
 * @returns objeto para POST /api/pedidos items[]
 */
export const mapItemToBackend = (item) => {
  const id_producto = PRODUCTOS_MAP[item.id] || PRODUCTOS_MAP[item.cartId?.split("-")[0]];
  if (!id_producto) {
    console.warn(`[productosMap] No se encontró id_producto para: ${item.id} (${item.name})`);
  }
  return {
    id_producto,
    nombre_fallback:  item.name,    // backend lo usa si id_producto es undefined
    cantidad:         item.qty,
    precio_unitario:  item.price,
    notas_plato:      [
      ...(item.individualNotes?.filter(Boolean) || []),
      ...(item.salsas ? Object.entries(item.salsas).map(([k,v]) => `${k}: ${v}`) : []),
    ].join(", ") || null,
    es_para_llevar: !!item.isLlevar,
    opciones: [],  // cuando tengas opciones en DB las mapeas aquí
  };
};
