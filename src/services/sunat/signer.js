const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');
const fs = require('fs');
const path = require('path');

const firmarXML = (xmlString) => {
    try {
        const rutaLlavePrivada = path.join(__dirname, '../../../certs/private_key.pem');
        const rutaCertificado = path.join(__dirname, '../../../certs/certificate.pem');

        const llavePrivada = fs.readFileSync(rutaLlavePrivada, 'utf-8');
        const certificadoPublico = fs.readFileSync(rutaCertificado, 'utf-8');

        // Limpieza de saltos de línea del certificado
        const certLimpio = certificadoPublico
            .replace(/-----BEGIN CERTIFICATE-----/g, '')
            .replace(/-----END CERTIFICATE-----/g, '')
            .replace(/[\r\n\s]/g, '');

        const sig = new SignedXml();
        sig.privateKey = llavePrivada;
        sig.signingKey = llavePrivada; 

        sig.signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
        sig.canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#"; 

        // 1. DEVOLVEMOS LA VISTA A NODE: Con esto no hay más "XPath parse error".
        // La librería le pondrá Id="_0" al Invoice, lo cual es 100% válido para SUNAT.
        sig.addReference({
            xpath: "//*[local-name(.)='Invoice']",
            transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature"],
            digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256"
        });

        // 2. EL INYECTOR DE CERTIFICADOS BLINDADO: Usamos un constructor para que 
        // xml-crypto esté estrictamente obligado a imprimir tu <KeyInfo> público.
        function KeyInfoProvider() {
            this.getKeyInfo = function(key, prefix) {
                const p = prefix ? prefix + ':' : '';
                return `<${p}X509Data><${p}X509Certificate>${certLimpio}</${p}X509Certificate></${p}X509Data>`;
            };
            this.getKey = function() { return llavePrivada; };
        }
        sig.keyInfoProvider = new KeyInfoProvider();

        // 3. INYECCIÓN FORZANDO EL PREFIJO 'ds'
        sig.computeSignature(xmlString, {
            prefix: 'ds',
            attrs: { Id: 'SignPAPACHOS' },
            location: {
                reference: "//*[local-name(.)='ExtensionContent']",
                action: "append"
            }
        });

        let xmlFirmado = sig.getSignedXml();

        // 4. PROTECCIÓN DE CABECERA XML
        if (!xmlFirmado.startsWith('<?xml')) {
            xmlFirmado = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlFirmado;
        }

        const docFirmado = new DOMParser().parseFromString(xmlFirmado, 'text/xml');
        const nodoDigest = docFirmado.getElementsByTagName('ds:DigestValue')[0] || docFirmado.getElementsByTagName('DigestValue')[0];
        const hashCPE = nodoDigest ? nodoDigest.textContent : 'HASH_NO_ENCONTRADO';

        return { xmlFirmado, hashCPE };

    } catch (error) {
        console.error("Error firma XML:", error);
        throw error; 
    }
};

module.exports = { firmarXML };