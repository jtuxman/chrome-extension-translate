importScripts("drive.js");

// Service worker: coordina la traducción (según el motor configurado) y
// persiste el vocabulario.

const STORAGE_KEY = "vocabulario";

const CONFIG_POR_DEFECTO = {
  motor: "mymemory",
  sourceLang: "en",
  targetLang: "es",
  libre: { url: "https://libretranslate.com/translate", apiKey: "" },
  deepl: { apiKey: "", plan: "free" },
  google: { apiKey: "" },
};

// Canal con el documento offscreen que ejecuta el OCR.
let puertoOcr = null;
const pendientesOcr = new Map();

chrome.runtime.onConnect.addListener((puerto) => {
  if (!puerto || puerto.name !== "ocr") return;
  puertoOcr = puerto;

  puerto.onMessage.addListener((mensaje) => {
    if (!mensaje || !pendientesOcr.has(mensaje.id)) return;
    const pendiente = pendientesOcr.get(mensaje.id);
    pendientesOcr.delete(mensaje.id);
    pendiente.resolve(mensaje);
  });

  puerto.onDisconnect.addListener(() => {
    if (puertoOcr === puerto) puertoOcr = null;
    for (const [id, pendiente] of pendientesOcr) {
      if (pendiente.puerto !== puerto) continue;
      pendientesOcr.delete(id);
      pendiente.reject(new Error("Se interrumpió la lectura del recuadro"));
    }
  });
});

// Abrir el panel lateral al hacer clic en el icono de la extensión.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.warn("No se pudo configurar el panel:", err));
  }
  sincronizarDrive().catch((error) => console.warn("Drive:", error));
});

// Escucha los mensajes del content script y de la página de opciones.
chrome.runtime.onMessage.addListener((mensaje, sender, sendResponse) => {
  if (mensaje && mensaje.tipo === "traducir") {
    manejarTraduccion(mensaje, sender)
      .then((resultado) => sendResponse(resultado))
      .catch((error) => {
        console.error("Error al traducir:", error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true; // respuesta asíncrona
  }

  if (mensaje && mensaje.tipo === "probar") {
    manejarPrueba(mensaje)
      .then((resultado) => sendResponse(resultado))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true; // respuesta asíncrona
  }

  if (mensaje && mensaje.tipo === "drive-estado") {
    estadoDrive()
      .then((resultado) => sendResponse(resultado))
      .catch((error) => responderErrorDrive(error, sendResponse));
    return true;
  }

  if (mensaje && mensaje.tipo === "drive-conectar") {
    conectarDrive()
      .then((resultado) => sendResponse(resultado))
      .catch((error) => responderErrorDrive(error, sendResponse));
    return true;
  }

  if (mensaje && mensaje.tipo === "drive-desconectar") {
    desconectarDrive()
      .then((resultado) => sendResponse(resultado))
      .catch((error) => responderErrorDrive(error, sendResponse));
    return true;
  }

  if (mensaje && mensaje.tipo === "drive-sincronizar") {
    sincronizarDrive()
      .then((resultado) => sendResponse(resultado))
      .catch((error) => responderErrorDrive(error, sendResponse));
    return true;
  }

  if (mensaje && mensaje.tipo === "reconocer") {
    manejarReconocimiento(mensaje, sender)
      .then((resultado) => sendResponse(resultado))
      .catch((error) => {
        console.error("Error al reconocer:", error);
        sendResponse({ ok: false, error: String(error.message || error) });
      });
    return true; // respuesta asíncrona
  }

  return false;
});

// --- Flujo principal de traducción -----------------------------------------

async function manejarTraduccion(mensaje, sender) {
  const texto = (mensaje.texto || "").trim();
  const contexto = (mensaje.contexto || "").trim();
  const url = (sender && sender.tab && sender.tab.url) || mensaje.url || "";

  if (!texto) {
    return { ok: false, error: "Texto vacío" };
  }

  const config = await obtenerConfig();
  const traduccion = await traducir(texto, config);
  await guardarEnVocabulario({ texto, traduccion, contexto, url });

  // Qué copiar al portapapeles: si el texto original ya está en español, solo
  // el texto; si está en inglés (u otro idioma), la traducción y el original.
  const idioma = await detectarIdioma(texto);
  const esEspanol = !!idioma && idioma.toLowerCase().startsWith("es");
  const textoCopiar = esEspanol ? texto : traduccion + "\n" + texto;

  return { ok: true, traduccion, idioma, esEspanol, textoCopiar };
}

// Detecta el idioma del texto para decidir qué se copia al portapapeles.
// Usa señales fuertes del español y, si no, la API chrome.i18n.detectLanguage.
async function detectarIdioma(texto) {
  const limpio = String(texto || "").trim();
  if (!limpio) return null;

  // Signos y letras exclusivos del español: señal muy fiable.
  if (/[¿¡ñ]/i.test(limpio)) return "es";

  if (chrome.i18n && typeof chrome.i18n.detectLanguage === "function") {
    try {
      const resultado = await chrome.i18n.detectLanguage(limpio);
      const lenguas = (resultado && resultado.languages) || [];
      if (lenguas.length && lenguas[0] && lenguas[0].language) {
        return lenguas[0].language;
      }
    } catch (error) {
      // Si la detección falla, se trata como "no español" (caso inglés).
    }
  }
  return null;
}

// Prueba desde la página de opciones: traduce un texto fijo y NO guarda nada.
// Usa la config que viene en el mensaje (todavía sin guardar) o la almacenada.
async function manejarPrueba(mensaje) {
  const config = mensaje.config
    ? fusionarConfig(CONFIG_POR_DEFECTO, mensaje.config)
    : await obtenerConfig();
  const traduccion = await traducir("hello", config);
  return { ok: true, traduccion };
}

// --- Configuración ----------------------------------------------------------

async function obtenerConfig() {
  const { config } = await chrome.storage.sync.get("config");
  return fusionarConfig(CONFIG_POR_DEFECTO, config || {});
}

function fusionarConfig(base, extra) {
  return {
    ...base,
    ...extra,
    libre: { ...base.libre, ...(extra.libre || {}) },
    deepl: { ...base.deepl, ...(extra.deepl || {}) },
    google: { ...base.google, ...(extra.google || {}) },
  };
}

// --- Despachador de motores -------------------------------------------------

async function traducir(texto, config) {
  switch (config.motor) {
    case "libretranslate":
      return traducirLibre(texto, config);
    case "chrome":
      return traducirChrome(texto, config);
    case "deepl":
      return traducirDeepL(texto, config);
    case "google":
      return traducirGoogle(texto, config);
    case "mymemory":
    default:
      return traducirMyMemory(texto, config);
  }
}

async function traducirMyMemory(texto, config) {
  const endpoint = new URL("https://api.mymemory.translated.net/get");
  endpoint.searchParams.set("q", texto);
  endpoint.searchParams.set(
    "langpair",
    config.sourceLang + "|" + config.targetLang
  );

  const respuesta = await fetch(endpoint.toString());
  if (!respuesta.ok) throw new Error("MyMemory HTTP " + respuesta.status);

  const datos = await respuesta.json();
  const traduccion = datos?.responseData?.translatedText;
  if (!traduccion) throw new Error("MyMemory: respuesta sin traducción");
  return traduccion;
}

async function traducirLibre(texto, config) {
  const url = config.libre.url || CONFIG_POR_DEFECTO.libre.url;
  const cuerpo = {
    q: texto,
    source: config.sourceLang,
    target: config.targetLang,
    format: "text",
  };
  if (config.libre.apiKey) cuerpo.api_key = config.libre.apiKey;

  const respuesta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!respuesta.ok) throw new Error("LibreTranslate HTTP " + respuesta.status);

  const datos = await respuesta.json();
  if (!datos.translatedText) {
    throw new Error("LibreTranslate: " + (datos.error || "sin traducción"));
  }
  return datos.translatedText;
}

async function traducirChrome(texto, config) {
  // API Translator integrada (experimental). Disponible en Chrome reciente.
  const TranslatorAPI =
    (typeof self !== "undefined" && self.Translator) ||
    (typeof Translator !== "undefined" ? Translator : null);

  if (!TranslatorAPI || typeof TranslatorAPI.create !== "function") {
    throw new Error(
      "La API Translator de Chrome no está disponible en este navegador."
    );
  }

  const opciones = {
    sourceLanguage: config.sourceLang,
    targetLanguage: config.targetLang,
  };

  if (typeof TranslatorAPI.availability === "function") {
    const estado = await TranslatorAPI.availability(opciones);
    if (estado === "unavailable") {
      throw new Error(
        "Chrome no puede traducir " +
          config.sourceLang +
          "→" +
          config.targetLang +
          " en este dispositivo."
      );
    }
  }

  const traductor = await TranslatorAPI.create(opciones);
  const traduccion = await traductor.translate(texto);
  if (!traduccion) throw new Error("Chrome: respuesta sin traducción");
  return traduccion;
}

async function traducirDeepL(texto, config) {
  if (!config.deepl.apiKey) throw new Error("Falta la API key de DeepL");

  const base =
    config.deepl.plan === "pro"
      ? "https://api.deepl.com/v2/translate"
      : "https://api-free.deepl.com/v2/translate";

  const params = new URLSearchParams();
  params.set("text", texto);
  params.set("source_lang", config.sourceLang.toUpperCase());
  params.set("target_lang", config.targetLang.toUpperCase());

  const respuesta = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: "DeepL-Auth-Key " + config.deepl.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!respuesta.ok) throw new Error("DeepL HTTP " + respuesta.status);

  const datos = await respuesta.json();
  const traduccion = datos?.translations?.[0]?.text;
  if (!traduccion) throw new Error("DeepL: respuesta sin traducción");
  return traduccion;
}

async function traducirGoogle(texto, config) {
  if (!config.google.apiKey) throw new Error("Falta la API key de Google");

  const endpoint = new URL("https://translation.googleapis.com/language/translate/v2");
  endpoint.searchParams.set("key", config.google.apiKey);

  const respuesta = await fetch(endpoint.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: texto,
      source: config.sourceLang,
      target: config.targetLang,
      format: "text",
    }),
  });
  if (!respuesta.ok) throw new Error("Google HTTP " + respuesta.status);

  const datos = await respuesta.json();
  const traduccion = datos?.data?.translations?.[0]?.translatedText;
  if (!traduccion) throw new Error("Google: respuesta sin traducción");
  return traduccion;
}

// --- Persistencia del vocabulario -------------------------------------------

async function guardarEnVocabulario({ texto, traduccion, contexto, url }) {
  const clave = texto.toLowerCase();
  const almacen = await chrome.storage.local.get(STORAGE_KEY);
  const vocabulario = almacen[STORAGE_KEY] || {};

  const existente = vocabulario[clave];
  if (existente) {
    existente.vecesVista = (existente.vecesVista || 1) + 1;
    existente.ultimaVez = new Date().toISOString();
    if (contexto) existente.contexto = contexto;
    if (url) existente.url = url;
  } else {
    vocabulario[clave] = {
      palabra: texto,
      traduccion,
      contexto,
      url,
      fecha: new Date().toISOString(),
      ultimaVez: new Date().toISOString(),
      vecesVista: 1,
    };
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: vocabulario });
}

// --- Texto dentro de un recorte de pantalla --------------------------------

async function manejarReconocimiento(mensaje, sender) {
  const rect = mensaje.rect;
  const viewport = mensaje.viewport;
  if (!rect || rect.width < 2 || rect.height < 2) {
    return { ok: false, error: "Recuadro demasiado pequeño" };
  }
  if (!viewport || !viewport.width || !viewport.height) {
    return { ok: false, error: "No se pudo medir la pantalla" };
  }
  if (!sender || !sender.tab) {
    return { ok: false, error: "No hay pestaña activa" };
  }

  let captura;
  try {
    captura = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
      format: "png",
    });
  } catch (error) {
    throw new Error("No se pudo capturar la pantalla: " + (error.message || error));
  }

  const recorte = await recortarCaptura(captura, rect, viewport);
  const texto = await reconocerEnOffscreen(recorte, rect.height);
  const limpio = limpiarTextoOcr(texto);
  if (!limpio) return { ok: false, error: "No se encontró texto en el recuadro" };
  return { ok: true, texto: limpio };
}

function limpiarTextoOcr(texto) {
  const limpio = String(texto || "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpio || !/[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(limpio)) return "";
  return limpio.slice(0, 500);
}

async function recortarCaptura(dataUrl, rect, viewport) {
  const respuesta = await fetch(dataUrl);
  if (!respuesta.ok) throw new Error("No se pudo leer la captura");
  const bitmap = await createImageBitmap(await respuesta.blob());
  try {
    if (!bitmap.width || !bitmap.height) {
      throw new Error("La captura llegó vacía");
    }
    const escalaX = bitmap.width / viewport.width;
    const escalaY = bitmap.height / viewport.height;
    const sx = acotar(Math.round(rect.x * escalaX), 0, bitmap.width - 1);
    const sy = acotar(Math.round(rect.y * escalaY), 0, bitmap.height - 1);
    const sw = acotar(Math.round(rect.width * escalaX), 1, bitmap.width - sx);
    const sh = acotar(Math.round(rect.height * escalaY), 1, bitmap.height - sy);

    let dw = sw;
    let dh = sh;
    const ladoLargo = Math.max(sw, sh);
    if (ladoLargo < 900) {
      const factor = Math.min(3, 900 / ladoLargo);
      dw = Math.max(1, Math.round(sw * factor));
      dh = Math.max(1, Math.round(sh * factor));
    }
    if (dw > 1600) {
      const factor = 1600 / dw;
      dw = 1600;
      dh = Math.max(1, Math.round(dh * factor));
    }

    const canvas = new OffscreenCanvas(dw, dh);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    if (!blob) throw new Error("No se pudo recortar la captura");
    return await blobADataUrl(blob);
  } finally {
    bitmap.close();
  }
}

function acotar(valor, min, max) {
  return Math.min(max, Math.max(min, valor));
}

async function blobADataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const partes = [];
  const bloque = 8192;
  for (let i = 0; i < bytes.length; i += bloque) {
    const trozo = bytes.subarray(i, i + bloque);
    let binario = "";
    for (let j = 0; j < trozo.length; j++) binario += String.fromCharCode(trozo[j]);
    partes.push(binario);
  }
  return "data:image/png;base64," + btoa(partes.join(""));
}

let asegurandoOffscreen = null;

async function asegurarOffscreen() {
  if (!chrome.offscreen) {
    throw new Error("Esta versión de Chrome no puede leer texto en imágenes.");
  }
  if (await chrome.offscreen.hasDocument()) return;
  if (!asegurandoOffscreen) {
    asegurandoOffscreen = chrome.offscreen
      .createDocument({
        url: "ocr.html",
        reasons: ["WORKERS"],
        justification:
          "Reconocer el texto dentro de una captura de pantalla para traducirlo.",
      })
      .finally(() => {
        asegurandoOffscreen = null;
      });
  }
  try {
    await asegurandoOffscreen;
  } catch (error) {
    if (!(await chrome.offscreen.hasDocument())) throw error;
  }
}

async function reconocerEnOffscreen(dataUrl, alto) {
  await asegurarOffscreen();
  const inicio = Date.now();
  while (!puertoOcr && Date.now() - inicio < 5000) {
    await esperar(50);
  }
  if (!puertoOcr) throw new Error("El lector de imágenes no respondió");

  const id = Math.random().toString(36).slice(2);
  const puerto = puertoOcr;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pendientesOcr.has(id)) return;
      pendientesOcr.delete(id);
      reject(new Error("Tiempo agotado al leer el recuadro"));
    }, 40000);

    pendientesOcr.set(id, {
      puerto,
      resolve: (mensaje) => {
        clearTimeout(timer);
        if (mensaje && mensaje.ok) resolve(mensaje.texto || "");
        else reject(new Error((mensaje && mensaje.error) || "No se pudo leer el texto"));
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });

    try {
      puerto.postMessage({ tipo: "ocr-imagen", id, dataUrl, alto });
    } catch (error) {
      clearTimeout(timer);
      pendientesOcr.delete(id);
      reject(error);
    }
  });
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
