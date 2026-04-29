const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

console.log("⚙️ Generando llaves RSA de 2048 bits (Esto puede tomar unos segundos)...");
const keys = forge.pki.rsa.generateKeyPair(2048);

console.log("📜 Creando certificado con extensiones X.509 v3 para SUNAT...");
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

const attrs = [
  { name: 'commonName', value: 'Mr Papachos' },
  { name: 'countryName', value: 'PE' },
  { name: 'organizationName', value: 'Mr Papachos Pruebas SAC' }
];
cert.setSubject(attrs);
cert.setIssuer(attrs);

// 🔥 EL SECRETO PARA SUNAT: Las extensiones v3 obligatorias 🔥
cert.setExtensions([
  { name: 'basicConstraints', cA: false },
  { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true }
]);

// Firmar con la propia llave (Self-signed)
cert.sign(keys.privateKey, forge.md.sha256.create());

const pemCert = forge.pki.certificateToPem(cert);
const pemKey = forge.pki.privateKeyToPem(keys.privateKey);

// Guardar directamente en tu carpeta certs
const rutaCerts = path.join(__dirname, 'certs');
if (!fs.existsSync(rutaCerts)){
    fs.mkdirSync(rutaCerts);
}

fs.writeFileSync(path.join(rutaCerts, 'certificate.pem'), pemCert);
fs.writeFileSync(path.join(rutaCerts, 'private_key.pem'), pemKey);

console.log("✅ ¡Archivos private_key.pem y certificate.pem sobreescritos con éxito!");