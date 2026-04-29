const JSZip = require('jszip');

const generarZIP = async (xmlFirmado, nombreArchivo) => {
    const zip = new JSZip();

    zip.file(`${nombreArchivo}.xml`, xmlFirmado);

    const zipContent = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE"
    });

    return zipContent;
};

module.exports = { generarZIP };