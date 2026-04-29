const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const { DOMParser } = require('@xmldom/xmldom');

const getSunatEndpoint = () => {
  if (process.env.SUNAT_ENDPOINT) return process.env.SUNAT_ENDPOINT;
  const modo = String(process.env.SUNAT_MODO || 'BETA').toUpperCase();
  if (modo === 'PRODUCCION' || modo === 'PROD') {
    return 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService';
  }
  return 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService';
};

/**
 * Empaqueta el XML, construye el sobre SOAP y lo envia a SUNAT.
 * nombreArchivo usa el formato RUC-TIPO-SERIE-CORRELATIVO.
 */
const enviarASunat = async (ruc, usuarioSol, claveSol, nombreArchivo, xmlFirmado) => {
  try {
    const zip = new AdmZip();
    zip.addFile(`${nombreArchivo}.xml`, Buffer.from(xmlFirmado, 'utf8'));
    const zipBase64 = zip.toBuffer().toString('base64');

    const soapMessage = `
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
        <soapenv:Header>
          <wsse:Security>
            <wsse:UsernameToken>
              <wsse:Username>${ruc}${usuarioSol}</wsse:Username>
              <wsse:Password>${claveSol}</wsse:Password>
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

    const response = await fetch(getSunatEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        SOAPAction: 'urn:sendBill',
      },
      body: soapMessage,
    });

    const responseText = await response.text();
    const doc = new DOMParser().parseFromString(responseText, 'text/xml');

    const faultcode = doc.getElementsByTagName('faultcode')[0];
    if (faultcode) {
      const faultstring = doc.getElementsByTagName('faultstring')[0]?.textContent || responseText;
      return { exito: false, error: faultstring, raw: responseText };
    }

    const applicationResponse = doc.getElementsByTagName('applicationResponse')[0];
    if (applicationResponse) {
      return {
        exito: true,
        cdrBase64: applicationResponse.textContent,
        mensaje: 'Aceptado por SUNAT',
      };
    }

    return {
      exito: false,
      error: 'Respuesta de SUNAT con estructura irreconocible',
      raw: responseText,
    };
  } catch (error) {
    console.error('[SUNAT] Error de red o web service:', error);
    return { exito: false, error: error.message };
  }
};

module.exports = {
  enviarASunat,
  getSunatEndpoint,
};
