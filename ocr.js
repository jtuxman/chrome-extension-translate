// Documento offscreen: carga Tesseract (inglés) y lee el texto de un recorte.

let workerPromise = null;
let cola = Promise.resolve();

function encolar(tarea) {
  const resultado = cola.then(tarea, tarea);
  cola = resultado.then(
    () => {},
    () => {}
  );
  return resultado;
}

function obtenerWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("eng", 1, {
      workerPath: chrome.runtime.getURL("vendor/tesseract/worker.min.js"),
      corePath: chrome.runtime.getURL(
        "vendor/tesseract/tesseract-core-simd-lstm.wasm.js"
      ),
      langPath: chrome.runtime.getURL("vendor/tesseract"),
      workerBlobURL: false,
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

async function leer(mensaje) {
  const worker = await obtenerWorker();
  const modos = mensaje.alto < 70 ? ["7", "11"] : ["6", "11"];
  let mejor = "";

  for (const modo of modos) {
    await worker.setParameters({
      tessedit_pageseg_mode: modo,
      preserve_interword_spaces: "1",
    });
    const resultado = await worker.recognize(mensaje.dataUrl);
    const texto = ((resultado && resultado.data && resultado.data.text) || "")
      .replace(/\s+/g, " ")
      .trim();
    if (texto.length > mejor.length) mejor = texto;
    if (mejor.length >= 2) break;
  }

  return mejor;
}

function conectar() {
  const puerto = chrome.runtime.connect({ name: "ocr" });
  puerto.onMessage.addListener((mensaje) => {
    if (!mensaje || mensaje.tipo !== "ocr-imagen") return;
    encolar(() => leer(mensaje))
      .then((texto) => {
        puerto.postMessage({ id: mensaje.id, ok: true, texto });
      })
      .catch((error) => {
        puerto.postMessage({
          id: mensaje.id,
          ok: false,
          error: String((error && error.message) || error),
        });
      });
  });
  puerto.onDisconnect.addListener(() => {
    if (chrome.runtime.id) setTimeout(conectar, 300);
  });
}

conectar();
