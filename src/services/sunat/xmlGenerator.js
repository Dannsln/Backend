const { create } = require('xmlbuilder2');

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const money = (value) => round2(value).toFixed(2);
const padCorrelativo = (value) => String(Number(value) || 0).padStart(8, '0');

const numeroALetras = (value) => {
  const n = Math.floor(Number(value) || 0);
  const cents = Math.round(((Number(value) || 0) - n) * 100);
  return `SON ${n} CON ${String(cents).padStart(2, '0')}/100 SOLES`;
};

const addText = (parent, name, value, attrs = {}) =>
  parent.ele(name, attrs).txt(value === undefined || value === null ? '' : String(value)).up();

const addTaxScheme = (parent) => {
  const scheme = parent.ele('cac:TaxScheme');
  addText(scheme, 'cbc:ID', '1000', {
    schemeName: 'Codigo de tributos',
    schemeAgencyName: 'PE:SUNAT',
    schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo05',
  });
  addText(scheme, 'cbc:Name', 'IGV');
  addText(scheme, 'cbc:TaxTypeCode', 'VAT');
  scheme.up();
};

const addParty = (parent, { tipo_documento, numero_documento, razon_social, nombre_comercial, direccion, ubigeo, codigo_domicilio_fiscal }, isSupplier = false) => {
  const party = parent.ele('cac:Party');
  const identification = party.ele('cac:PartyIdentification');
  addText(identification, 'cbc:ID', numero_documento, {
    schemeID: tipo_documento,
    schemeName: 'Documento de Identidad',
    schemeAgencyName: 'PE:SUNAT',
    schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
  });
  identification.up();

  if (nombre_comercial) {
    const partyName = party.ele('cac:PartyName');
    addText(partyName, 'cbc:Name', nombre_comercial);
    partyName.up();
  }

  const legal = party.ele('cac:PartyLegalEntity');
  addText(legal, 'cbc:RegistrationName', razon_social);

  if (isSupplier) {
    const address = legal.ele('cac:RegistrationAddress');
    if (ubigeo) addText(address, 'cbc:ID', ubigeo);
    addText(address, 'cbc:AddressTypeCode', codigo_domicilio_fiscal || '0000');
    if (direccion) {
      const line = address.ele('cac:AddressLine');
      addText(line, 'cbc:Line', direccion);
      line.up();
    }
    address.up();
  }

  legal.up();
  party.up();
};

const normalizeDetalle = (item = {}) => {
  const cantidad = Number(item.cantidad || item.qty || 0);
  const precioConIgv = Number(item.precio_unitario_historico ?? item.precio_unitario ?? item.precio ?? item.price ?? 0);
  const totalConIgv = round2(cantidad * precioConIgv);
  const valorUnitario = round2(precioConIgv / 1.18);
  const valorVenta = round2(totalConIgv / 1.18);
  const igv = round2(totalConIgv - valorVenta);

  return {
    id_producto: item.id_producto || item.id || '',
    nombre: item.nombre || item.nombre_producto || item.name || 'Producto',
    cantidad,
    unidad_medida: item.unidad_medida || item.unitCode || 'NIU',
    tipo_afectacion_igv: item.tipo_afectacion_igv || '10',
    codigo_sunat_unspsc: item.codigo_sunat_unspsc || item.codigo_sunat || '90101501',
    precioConIgv,
    valorUnitario,
    valorVenta,
    igv,
  };
};

/**
 * Genera XML UBL 2.1 para Factura (01) o Boleta (03), siguiendo la estructura
 * SUNAT de comprobantes electronicos: UBLExtensions, ProfileID 0101,
 * InvoiceTypeCode, datos del emisor/receptor, totales IGV y lineas gravadas.
 */
const generarXML = (comprobante, cliente, detalles, empresa) => {
  const items = (detalles || []).map(normalizeDetalle).filter((item) => item.cantidad > 0);
  const fecha = comprobante.fecha_emision ? new Date(comprobante.fecha_emision) : new Date();
  const serie = String(comprobante.serie || '').toUpperCase();
  const correlativo = padCorrelativo(comprobante.correlativo);
  const moneda = comprobante.moneda || 'PEN';
  const tipoComprobante = comprobante.tipo_comprobante || '03';
  const tipoOperacion = comprobante.tipo_operacion || '0101';
  const totalGravado = round2(comprobante.monto_gravado ?? items.reduce((sum, item) => sum + item.valorVenta, 0));
  const totalIgv = round2(comprobante.monto_igv ?? items.reduce((sum, item) => sum + item.igv, 0));
  const total = round2(comprobante.monto_total ?? (totalGravado + totalIgv));

  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('Invoice', {
    xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    'xmlns:ccts': 'urn:un:unece:uncefact:documentation:2',
    'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
    'xmlns:ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
    'xmlns:qdt': 'urn:oasis:names:specification:ubl:schema:xsd:QualifiedDatatypes-2',
    'xmlns:udt': 'urn:un:unece:uncefact:data:specification:UnqualifiedDataTypesSchemaModule:2',
  });

  doc.ele('ext:UBLExtensions')
    .ele('ext:UBLExtension')
    .ele('ext:ExtensionContent').up()
    .up()
    .up();

  addText(doc, 'cbc:UBLVersionID', '2.1');
  addText(doc, 'cbc:CustomizationID', '2.0', { schemeAgencyName: 'PE:SUNAT' });
  addText(doc, 'cbc:ProfileID', tipoOperacion, {
    schemeName: 'SUNAT:Identificador de Tipo de Operacion',
    schemeAgencyName: 'PE:SUNAT',
    schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo17',
  });
  addText(doc, 'cbc:ID', `${serie}-${correlativo}`);
  addText(doc, 'cbc:IssueDate', fecha.toISOString().slice(0, 10));
  addText(doc, 'cbc:IssueTime', fecha.toTimeString().slice(0, 8));
  addText(doc, 'cbc:InvoiceTypeCode', tipoComprobante, {
    listID: tipoOperacion,
    listAgencyName: 'PE:SUNAT',
    listName: 'Tipo de Documento',
    listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01',
  });
  addText(doc, 'cbc:Note', numeroALetras(total), { languageLocaleID: '1000' });
  addText(doc, 'cbc:DocumentCurrencyCode', moneda, {
    listID: 'ISO 4217 Alpha',
    listName: 'Currency',
    listAgencyName: 'United Nations Economic Commission for Europe',
  });

  const signature = doc.ele('cac:Signature');
  addText(signature, 'cbc:ID', empresa.ruc);
  const signatory = signature.ele('cac:SignatoryParty');
  const signatoryId = signatory.ele('cac:PartyIdentification');
  addText(signatoryId, 'cbc:ID', empresa.ruc);
  signatoryId.up();
  const signatoryName = signatory.ele('cac:PartyName');
  addText(signatoryName, 'cbc:Name', empresa.razon_social);
  signatoryName.up();
  signatory.up();
  const attachment = signature.ele('cac:DigitalSignatureAttachment').ele('cac:ExternalReference');
  addText(attachment, 'cbc:URI', '#SignPAPACHOS');
  attachment.up().up();
  signature.up();

  const supplier = doc.ele('cac:AccountingSupplierParty');
  addParty(supplier, {
    tipo_documento: '6',
    numero_documento: empresa.ruc,
    razon_social: empresa.razon_social,
    nombre_comercial: empresa.nombre_comercial,
    direccion: empresa.direccion,
    ubigeo: empresa.ubigeo,
    codigo_domicilio_fiscal: empresa.codigo_domicilio_fiscal,
  }, true);
  supplier.up();

  const customer = doc.ele('cac:AccountingCustomerParty');
  addParty(customer, cliente, false);
  customer.up();

  const taxTotal = doc.ele('cac:TaxTotal');
  addText(taxTotal, 'cbc:TaxAmount', money(totalIgv), { currencyID: moneda });
  const subtotal = taxTotal.ele('cac:TaxSubtotal');
  addText(subtotal, 'cbc:TaxableAmount', money(totalGravado), { currencyID: moneda });
  addText(subtotal, 'cbc:TaxAmount', money(totalIgv), { currencyID: moneda });
  const taxCategory = subtotal.ele('cac:TaxCategory');
  addTaxScheme(taxCategory);
  taxCategory.up();
  subtotal.up();
  taxTotal.up();

  const monetary = doc.ele('cac:LegalMonetaryTotal');
  addText(monetary, 'cbc:LineExtensionAmount', money(totalGravado), { currencyID: moneda });
  addText(monetary, 'cbc:TaxInclusiveAmount', money(total), { currencyID: moneda });
  addText(monetary, 'cbc:AllowanceTotalAmount', money(comprobante.monto_descuento || 0), { currencyID: moneda });
  addText(monetary, 'cbc:ChargeTotalAmount', '0.00', { currencyID: moneda });
  addText(monetary, 'cbc:PayableAmount', money(total), { currencyID: moneda });
  monetary.up();

  items.forEach((item, index) => {
    const line = doc.ele('cac:InvoiceLine');
    addText(line, 'cbc:ID', index + 1);
    addText(line, 'cbc:InvoicedQuantity', money(item.cantidad), { unitCode: item.unidad_medida });
    addText(line, 'cbc:LineExtensionAmount', money(item.valorVenta), { currencyID: moneda });

    const pricing = line.ele('cac:PricingReference').ele('cac:AlternativeConditionPrice');
    addText(pricing, 'cbc:PriceAmount', money(item.precioConIgv), { currencyID: moneda });
    addText(pricing, 'cbc:PriceTypeCode', '01', {
      listName: 'Tipo de Precio',
      listAgencyName: 'PE:SUNAT',
      listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo16',
    });
    pricing.up().up();

    const itemTax = line.ele('cac:TaxTotal');
    addText(itemTax, 'cbc:TaxAmount', money(item.igv), { currencyID: moneda });
    const itemTaxSubtotal = itemTax.ele('cac:TaxSubtotal');
    addText(itemTaxSubtotal, 'cbc:TaxableAmount', money(item.valorVenta), { currencyID: moneda });
    addText(itemTaxSubtotal, 'cbc:TaxAmount', money(item.igv), { currencyID: moneda });
    const itemTaxCategory = itemTaxSubtotal.ele('cac:TaxCategory');
    addText(itemTaxCategory, 'cbc:Percent', '18.00');
    addText(itemTaxCategory, 'cbc:TaxExemptionReasonCode', item.tipo_afectacion_igv, {
      listAgencyName: 'PE:SUNAT',
      listName: 'Afectacion del IGV',
      listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07',
    });
    addTaxScheme(itemTaxCategory);
    itemTaxCategory.up();
    itemTaxSubtotal.up();
    itemTax.up();

    const product = line.ele('cac:Item');
    addText(product, 'cbc:Description', item.nombre);
    const sellersId = product.ele('cac:SellersItemIdentification');
    addText(sellersId, 'cbc:ID', item.id_producto || index + 1);
    sellersId.up();
    if (item.codigo_sunat_unspsc) {
      const classification = product.ele('cac:CommodityClassification');
      addText(classification, 'cbc:ItemClassificationCode', item.codigo_sunat_unspsc, {
        listID: 'UNSPSC',
        listAgencyName: 'GS1 US',
        listName: 'Item Classification',
      });
      classification.up();
    }
    product.up();

    const price = line.ele('cac:Price');
    addText(price, 'cbc:PriceAmount', money(item.valorUnitario), { currencyID: moneda });
    price.up();
    line.up();
  });

  return doc.end({ prettyPrint: true });
};

module.exports = {
  generarXML,
  padCorrelativo,
};
