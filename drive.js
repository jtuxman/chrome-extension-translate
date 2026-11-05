// Copia del vocabulario en la cuenta de Google de Chrome (chrome.storage.sync).
// No hace falta un proyecto de Google Cloud: si en la otra computadora entras
// a Chrome con la misma cuenta, las palabras aparecen solas.

const SYNC_META = "vocab_nube";
const SYNC_PREFIJO = "vocab_parte_";
const TAM_PARTE = 6000;

let silenciarCambios = 0;
let escriturasSync = 0;
let timerOlvido = null;
let subiendo = false;
let subidaPendiente = false;
let timerSubida = null;
let timerBajada = null;
let ultimoError = "";

async function estadoDrive() {
  let email = "";
  try {
    if (chrome.identity && chrome.identity.getProfileUserInfo) {
      const info = await chrome.identity.getProfileUserInfo({ accountStatus: "ANY" });
      email = (info && info.email) || "";
    }
  } catch (error) {
    email = "";
  }
  return { ok: !ultimoError, email, error: ultimoError };
}

async function sincronizarDrive() {
  const almacen = await chrome.storage.local.get(["vocabulario", "eliminadas"]);
  const remoto = (await leerDeSync()) || { vocabulario: {}, eliminadas: {} };
  const fusion = fusionarVocabulario(
    almacen.vocabulario || {},
    almacen.eliminadas || {},
    remoto
  );
  const cambioLocal =
    distinto(almacen.vocabulario || {}, fusion.vocabulario) ||
    distinto(almacen.eliminadas || {}, fusion.eliminadas);
  if (cambioLocal) {
    silenciarCambios++;
    await chrome.storage.local.set({
      vocabulario: fusion.vocabulario,
      eliminadas: fusion.eliminadas,
    });
  }
  const cambioRemoto =
    distinto(remoto.vocabulario || {}, fusion.vocabulario) ||
    distinto(remoto.eliminadas || {}, fusion.eliminadas);
  if (cambioRemoto) await subirAhora();
  ultimoError = "";
  return estadoDrive();
}

function programarSubida() {
  clearTimeout(timerSubida);
  timerSubida = setTimeout(() => {
    subirVocabulario().catch((error) => {
      ultimoError = mensajeError(error);
      console.warn("Nube:", error);
    });
  }, 800);
}

function programarBajada() {
  clearTimeout(timerBajada);
  timerBajada = setTimeout(() => {
    sincronizarDrive().catch((error) => {
      ultimoError = mensajeError(error);
      console.warn("Nube:", error);
    });
  }, 400);
}

async function subirVocabulario() {
  if (subiendo) {
    subidaPendiente = true;
    return;
  }
  subiendo = true;
  try {
    do {
      subidaPendiente = false;
      await subirAhora();
      ultimoError = "";
    } while (subidaPendiente);
  } finally {
    subiendo = false;
  }
}

async function subirAhora() {
  const { vocabulario, eliminadas } = await chrome.storage.local.get([
    "vocabulario",
    "eliminadas",
  ]);
  await guardarEnSync({
    version: 1,
    actualizado: new Date().toISOString(),
    vocabulario: vocabulario || {},
    eliminadas: eliminadas || {},
  });
}

async function guardarEnSync(documento) {
  const json = JSON.stringify(documento);
  const partes = [];
  for (let i = 0; i < json.length; i += TAM_PARTE) partes.push(json.slice(i, i + TAM_PARTE));
  if (partes.length > 400) {
    throw new Error("QUOTA");
  }

  const todo = await chrome.storage.sync.get(null);
  const sobrantes = [];
  for (const clave of Object.keys(todo)) {
    if (!clave.startsWith(SYNC_PREFIJO)) continue;
    const indice = Number(clave.slice(SYNC_PREFIJO.length));
    if (indice >= partes.length) sobrantes.push(clave);
  }

  const datos = {
    [SYNC_META]: { partes: partes.length, actualizado: documento.actualizado },
  };
  partes.forEach((parte, indice) => {
    datos[SYNC_PREFIJO + indice] = parte;
  });

  marcarEscrituraSync();
  if (sobrantes.length) {
    marcarEscrituraSync();
    await chrome.storage.sync.remove(sobrantes);
  }
  await chrome.storage.sync.set(datos);
}

async function leerDeSync() {
  const todo = await chrome.storage.sync.get(null);
  const meta = todo[SYNC_META];
  if (!meta || !meta.partes) return null;
  let json = "";
  for (let i = 0; i < meta.partes; i++) {
    const parte = todo[SYNC_PREFIJO + i];
    if (typeof parte !== "string") return null;
    json += parte;
  }
  if (!json) return null;
  const datos = JSON.parse(json);
  return {
    version: 1,
    vocabulario: datos.vocabulario || {},
    eliminadas: datos.eliminadas || {},
  };
}

function marcarEscrituraSync() {
  escriturasSync++;
  clearTimeout(timerOlvido);
  timerOlvido = setTimeout(() => {
    escriturasSync = 0;
  }, 2000);
}

function mensajeError(error) {
  const texto = (error && error.message) || String(error);
  if (/QUOTA/i.test(texto)) {
    return "El diccionario es demasiado grande para sincronizarlo con la cuenta de Chrome. Puedes exportar el JSON.";
  }
  return texto;
}

function fusionarVocabulario(localVocab, localElim, remoto) {
  const vocabulario = { ...localVocab };
  const eliminadas = { ...(localElim || {}) };
  const remotoElim = (remoto && remoto.eliminadas) || {};
  const remotoVocab = (remoto && remoto.vocabulario) || {};

  for (const [clave, fecha] of Object.entries(remotoElim)) {
    if (!eliminadas[clave] || fecha > eliminadas[clave]) eliminadas[clave] = fecha;
  }

  const claves = new Set([...Object.keys(vocabulario), ...Object.keys(remotoVocab)]);
  for (const clave of claves) {
    const local = vocabulario[clave];
    const remotoItem = remotoVocab[clave];
    const tumba = eliminadas[clave];
    const masNuevo = masReciente(local, remotoItem);

    if (tumba && (!masNuevo || tumba >= fechaItem(masNuevo))) {
      delete vocabulario[clave];
      continue;
    }
    if (tumba) delete eliminadas[clave];

    if (local && remotoItem) {
      vocabulario[clave] = fechaItem(remotoItem) > fechaItem(local) ? remotoItem : local;
    } else if (remotoItem) {
      vocabulario[clave] = remotoItem;
    }
  }

  return { vocabulario, eliminadas };
}

function masReciente(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return fechaItem(b) > fechaItem(a) ? b : a;
}

function fechaItem(item) {
  if (!item) return "";
  return item.ultimaVez || item.fecha || "";
}

function distinto(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

async function responderErrorDrive(error, sendResponse) {
  let estado = {};
  try {
    estado = await estadoDrive();
  } catch (fallo) {
    estado = {};
  }
  sendResponse({ ...estado, ok: false, error: mensajeError(error) });
}

chrome.storage.onChanged.addListener((cambios, area) => {
  if (area === "sync") {
    if (escriturasSync > 0) {
      escriturasSync--;
      return;
    }
    const claves = Object.keys(cambios);
    if (!claves.some((clave) => clave === SYNC_META || clave.startsWith(SYNC_PREFIJO))) return;
    programarBajada();
    return;
  }
  if (area !== "local") return;
  if (silenciarCambios > 0) {
    silenciarCambios--;
    return;
  }
  if (!cambios.vocabulario && !cambios.eliminadas) return;
  programarSubida();
});

chrome.runtime.onStartup.addListener(() => {
  sincronizarDrive().catch((error) => console.warn("Nube:", error));
});
