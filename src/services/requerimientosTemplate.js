const REQUERIMIENTOS_TEMPLATE = [
  { numero: 1, nombre: 'CARNES', items: ['Carne de res para lomo', 'Carne molida', 'Gallina', 'Pechugas de pollo', 'Pollo entero', 'Nuggets', 'Alas'] },
  { numero: 2, nombre: 'EMBUTIDOS', items: ['Hot dog', 'Chorizo', 'Chorizo artesanal', 'Jamón', 'Tocino'] },
  { numero: 3, nombre: 'LÁCTEOS', items: ['Queso', 'Queso laminado', 'Leche', 'Mantequilla'] },
  { numero: 4, nombre: 'CONDIMENTOS / ESPECIES', items: ['Sal', 'Pimienta', 'Comino', 'Ajinomoto', 'Oregano', 'Ajo en polvo', 'Cubitos de gallina', 'Sustancia de gallina', 'Sustancia de pescado', 'Sazonador de arroz', 'Ajonjolí en grano', 'Paprika en polvo', 'River oscuro', 'Aceite de ajonjolí', 'Canela china', 'Salsa de ostión', 'Canela', 'Clavo de olor', 'Ajo entero'] },
  { numero: 5, nombre: 'VERDURAS', items: ['Tomate', 'Pepinillo', 'Cebolla', 'Lechuga', 'Escabeche', 'Ají', 'Pimiento', 'Limón', 'Zapallo', 'Apio', 'Poro', 'Cebolla china', 'Ají limo', 'Rocoto', 'Rocoto rojo'] },
  { numero: 6, nombre: 'TUBERCULOS', items: ['Papa', 'Kion'] },
  { numero: 7, nombre: 'FRUTAS', items: ['Maracuyá', 'Mango', 'Platanos de freir', 'Fresa', 'Aguaymanto', 'Piña', 'Arándano'] },
  { numero: 8, nombre: 'CEREALES', items: ['Cebada', 'Linaza', 'Maiz morado', 'Maiz canchita'] },
  { numero: 9, nombre: 'ABARROTES', items: ['Arroz', 'Azúcar', 'Aceite', 'Sillao', 'Fideos Spagueti', 'Harina', 'Vinagre blanco', 'Miel de caña', 'Azúcar blanca'] },
  { numero: 10, nombre: 'CREMAS', items: ['Mayonesa Base', 'Ketchup', 'Mostaza', 'Mostaza en sachet'] },
  { numero: 11, nombre: 'ENLATADOS', items: ['Leche evaporada', 'Piña', 'Champigniones'] },
  { numero: 12, nombre: 'EMPAQUES', items: ['Taper deli cuadrado 1Litro', 'Taper redondo de 500 ml', 'Tapers redondo de 6 onz', 'Taper redondo de 1 Litro', 'Salseros de 1 onz', 'Salseros de 2onz', 'Botella de plástico de 250 ml', 'Botella de plástico de 500 ml', 'Botella de plástico de 1 Litro', 'Vasos térmicos con tapa', 'Ligas', 'Servilletas', 'Tenedores descartables', 'Vasos descartables', 'Bolsas de papel #1', 'Bolsa de papel #6', 'Bolsa de papel #20', 'Bolsas cremeras 2 1/2 x 8', 'Bolsas de 500 gramos para colgar', 'Bolsas de 1 Kilo para colgar', 'Bolsas de 2 Kilos para colgar', 'Bolsas de plástico para hamburguesa', 'Bolsas chequeras pequeñas', 'Bolsas chequeras grandes', 'Grapas', 'Plumón indeleble', 'Cinta Maskintape', 'Cinta de embalaje', 'Lapiceros', 'Engrapador', 'Papel térmico para impresora'] },
  { numero: 13, nombre: 'GASEOSAS/AGUA MINERAL', items: ['Inka Cola personal de vidrio', 'Coca Cola personal de vidrio', 'Fanta personal de vidrio', 'Inka Cola personal de plástico', 'Coca Cola personal de plástico', 'Fanta personal de plástico', 'Inka Cola GORDITA', 'Inka Cola de vidrio 1 Litro', 'Coca Cola de vidrio 1 Litro', 'Inka Cola retornable de 2Litros', 'Coca Cola retornable de 2 Litros', 'Agua mineral personal'] },
  { numero: 14, nombre: 'CAFÉ/INFUSIONES', items: ['Café', 'Manzanilla', 'Anis'] },
  { numero: 15, nombre: 'LIMPIEZA', items: ['Escoba', 'Recogedor', 'Trapeador', 'Detergente', 'Lejía', 'Lavabajilla', 'Desengrasante', 'Limpiatodo', 'Limpiavidrios', 'Esponja para ollas', 'Esponja para platos', 'Esponja de fierro', 'Secadores', 'Secadores de cocina', 'Bolsas para basura', 'Jabón Liquido', 'Papel Higiénico', 'Papel Toalla', 'Alcohol', 'Cotonas', 'Guantes de nitrilo negros', 'Mandiles'] },
  { numero: 16, nombre: 'OTROS', items: ['Pan de hamburguesa', 'Hielo', 'Timbre', 'Fosforos', 'Encendedor', 'Gas'] },
  { numero: 17, nombre: 'UTENSILIOS', items: ['Colador', 'Sartén', 'Olla'] },
];

const flattenedTemplate = () => {
  let counter = 1;
  return REQUERIMIENTOS_TEMPLATE.flatMap((categoria) =>
    categoria.items.map((producto) => ({
      categoria: categoria.nombre,
      item: counter++,
      producto,
      pedido: false,
      cantidad_pedida: null,
      cantidad_recibida: null,
      conforme: null,
      marca: '',
      observaciones: '',
    }))
  );
};

module.exports = {
  REQUERIMIENTOS_TEMPLATE,
  flattenedTemplate,
};
