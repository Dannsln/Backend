const { DOMParser } = require('@xmldom/xmldom');

const enviarASunat = async (zipBuffer, nombreArchivo, usuario, password) => {
    try {
        // 1. Convertir el ZIP a Base64
        const zipBase64 = zipBuffer.toString('base64');

        // 2. Construir el Sobre SOAP a mano con WS-Security (Bypass del WSDL)
        // El RUC debe ir concatenado con el usuario SOL (Ej: 20100066603MODDATOS)
       const ruc = process.env.RUC_EMPRESA || '20100066603';
        // Si el usuario ya trae el RUC, no lo concatenamos de nuevo
        const credencial = usuario.includes(ruc) ? usuario : `${ruc}${usuario}`;

        const soapMessage = `<?xml version="1.0" encoding="UTF-8"?>
        <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
            <soapenv:Header>
                <wsse:Security>
                    <wsse:UsernameToken>
                        <wsse:Username>${credencial}</wsse:Username>
                        <wsse:Password>${password}</wsse:Password>
                    </wsse:UsernameToken>
                </wsse:Security>
            </soapenv:Header>
            <soapenv:Body>
                <ser:sendBill>
                    <fileName>${nombreArchivo}.zip</fileName>
                    <contentFile>${zipBase64}</contentFile>
                </ser:sendBill>
            </soapenv:Body>
        </soapenv:Envelope>`;

        // 3. Endpoint Beta Oficial
        const URL_SUNAT = 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService';

        // 4. Disparar el POST directo
        const response = await fetch(URL_SUNAT, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'SOAPAction': 'urn:sendBill'
            },
            body: soapMessage
        });

        const responseText = await response.text();

        // 5. Analizar la respuesta de SUNAT
       // 5. Analizar la respuesta de SUNAT
        const doc = new DOMParser().parseFromString(responseText, 'text/xml');
        
        // Verificar si SUNAT nos rechazó (Fault)
        const faultcode = doc.getElementsByTagName('faultcode')[0];
        if (faultcode) {
            const faultstring = doc.getElementsByTagName('faultstring')[0].textContent;
            return { exito: false, error: faultstring };
        }

        // Si fue exitoso, devuelve el CDR (Constancia de Recepción) en Base64
        const applicationResponse = doc.getElementsByTagName('applicationResponse')[0];
        if (applicationResponse) {
            return { 
                exito: true, 
                mensaje: '¡Aceptado por SUNAT!',
                cdrBase64: applicationResponse.textContent 
            };
        }

        return { exito: false, error: 'Respuesta desconocida del servidor de SUNAT.' };

    } catch (error) {
        console.error("Error en la comunicación con SUNAT:", error);
        throw error;
    }
};

module.exports = { enviarASunat };