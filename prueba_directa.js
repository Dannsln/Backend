const fs = require('fs');
const { generarZIP } = require('./src/services/sunat/zipper');
const { enviarASunat } = require('./src/services/sunat/sunatSender');
const { generarXML } = require('./src/services/sunat/xmlGenerator');
const { firmarXML } = require('./src/services/sunat/signer');

console.log("🚀 Iniciando prueba directa del Motor SUNAT (Sin Base de Datos)...");

// 1. Simulamos los datos que vendrían de PostgreSQL
const comprobante = {
    serie: 'B001',
    correlativo: 1,
    tipo_comprobante: '03', // Boleta
    fecha_emision: new Date(),
    moneda: 'PEN',
    monto_total: 25.00,
    monto_gravado: 21.19, // 25 / 1.18
    monto_igv: 3.81
};

const cliente = {
    tipo_documento: '0',
    numero_documento: '00000000',
    razon_social: 'CLIENTES VARIOS'
};

const detalles = [
    {
        nombre: 'Hamburguesa Papacho Clásica',
        cantidad: 1,
        precio_unitario_historico: 25.00,
        unidad_medida: 'NIU',
        tipo_afectacion_igv: '10',
        codigo_sunat_unspsc: '50191500'
    }
];

const empresa = {
    ruc: process.env.RUC_EMPRESA || '20100066603',
    razon_social: 'MR. PAPACHOS PRUEBAS S.A.C.'
};

(async () => {
    try {
        const xmlPlano = generarXML(comprobante, cliente, detalles, empresa);
        const { xmlFirmado, hashCPE } = firmarXML(xmlPlano);
        const nombreArchivo = `${empresa.ruc}-${comprobante.tipo_comprobante}-${comprobante.serie}-${comprobante.correlativo}`;

        console.log("📦 Generando ZIP...");
        const zipBuffer = await generarZIP(xmlFirmado, nombreArchivo);

        console.log("🌐 Enviando a SUNAT...");
        const usuario = empresa.ruc+"MODDATOS"
        const password = "moddatos";

        const respuesta = await enviarASunat(
            zipBuffer,
            nombreArchivo,
            usuario,
            password
        );

        console.log("📥 RESPUESTA SUNAT:");
        console.log(respuesta);

        // --- FORZAR EL GUARDADO PARA AUDITORÍA ---
        console.log("\n💾 Forzando guardado de archivos en disco para autopsia...");
        
        // Guardamos el XML y el ZIP pase lo que pase
        fs.writeFileSync(`${nombreArchivo}.xml`, xmlFirmado);
        console.log(`   📄 XML guardado: ${nombreArchivo}.xml`);

        fs.writeFileSync(`${nombreArchivo}.zip`, zipBuffer);
        console.log(`   🗜️ ZIP guardado: ${nombreArchivo}.zip`);

        // Solo guardamos CDR si existe
        if (respuesta.cdrBase64) {
            const cdrBuffer = Buffer.from(respuesta.cdrBase64, 'base64');
            fs.writeFileSync(`R-${nombreArchivo}.zip`, cdrBuffer);
            console.log(`   ✅ CDR de SUNAT guardado: R-${nombreArchivo}.zip`);
        }

    } catch (error) {
        console.error("🔴 Error:", error);
    }
})();