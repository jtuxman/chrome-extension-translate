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

// Abrir el panel lateral al hacer clic en el icono de la extensión.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.warn("No se pudo configurar el panel:", err));
  }
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

  return { ok: true, traduccion };
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
