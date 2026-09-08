// packages/vision/index.js
// Modular OCR and Vision analysis package for PlainScript.

async function readText(imagePathOrBuffer, options = {}) {
  try {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker(options.lang || 'eng');
    const ret = await worker.recognize(imagePathOrBuffer);
    await worker.terminate();
    return ret.data.text.trim();
  } catch (err) {
    throw new Error(`Vision OCR failed: ${err.message}`);
  }
}

module.exports = {
  readText,
  recognize: readText
};
