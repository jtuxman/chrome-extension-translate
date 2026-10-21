// Service worker: coordina la traducción y persiste el vocabulario.

const STORAGE_KEY = "vocabulario";
const LANG_PAIR = "en|es";

// Abrir el panel lateral al hacer clic en el icono de la extensión.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.warn("No se pudo configurar el panel:", err));
  }
});

// Escucha los mensajes del content script.
chrome.runtime.onMessage.addListener((mensaje, sender, sendResponse) => {
  if (mensaje && mensaje.tipo === "traducir") {
    manejarTraduccion(mensaje, sender)
      .then((resultado) => sendResponse(resultado))
      .catch((error) => {
        console.error("Error al traducir:", error);
        sendResponse({ ok: false, error: String(error) });
      });
    // Devolver true mantiene el canal abierto para la respuesta asíncrona.
    return true;
  }
  return false;
});

async function manejarTraduccion(mensaje, sender) {
  const texto = (mensaje.texto || "").trim();
  const contexto = (mensaje.contexto || "").trim();
  const url = (sender && sender.tab && sender.tab.url) || mensaje.url || "";

  if (!texto) {
    return { ok: false, error: "Texto vacío" };
  }

  const traduccion = await traducirConMyMemory(texto);
  await guardarEnVocabulario({ texto, traduccion, contexto, url });

  return { ok: true, traduccion };
}

async function traducirConMyMemory(texto) {
  const endpoint = new URL("https://api.mymemory.translated.net/get");
  endpoint.searchParams.set("q", texto);
  endpoint.searchParams.set("langpair", LANG_PAIR);

  const respuesta = await fetch(endpoint.toString());
  if (!respuesta.ok) {
    throw new Error("HTTP " + respuesta.status);
  }
  const datos = await respuesta.json();
  const traduccion =
    datos &&
    datos.responseData &&
    datos.responseData.translatedText;

  if (!traduccion) {
    throw new Error("Respuesta sin traducción");
  }
  return traduccion;
}

async function guardarEnVocabulario({ texto, traduccion, contexto, url }) {
  const clave = texto.toLowerCase();
  const almacen = await chrome.storage.local.get(STORAGE_KEY);
  const vocabulario = almacen[STORAGE_KEY] || {};

  const existente = vocabulario[clave];
  if (existente) {
    existente.vecesVista = (existente.vecesVista || 1) + 1;
    existente.ultimaVez = new Date().toISOString();
    // Mantener el contexto más reciente si hay uno.
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
