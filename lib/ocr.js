const { recognize } = require('tesseract.js');

async function extraerTextoOCRDesdeArchivo(rutaArchivo) {
    if (!rutaArchivo) {
        return '';
    }

    const resultado = await recognize(rutaArchivo, 'spa+eng');
    const texto = resultado?.data?.text || '';

    return texto
        .toString()
        .replace(/\r/g, '')
        .trim();
}

module.exports = {
    extraerTextoOCRDesdeArchivo
};