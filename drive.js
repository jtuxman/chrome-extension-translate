// Copia del vocabulario en Google Drive (carpeta "Aprende Vocabulario",
// archivo aprende-vocabulario.json). El diccionario local sigue siendo la copia
// de trabajo; Drive se fusiona al conectar, al arrancar y al cambiar.

const CLIENT_ID_MARCADOR = "PEGAR_CLIENT_ID.apps.googleusercontent.com";
const CARPETA_DRIVE = "Aprende Vocabulario";
const ARCHIVO_DRIVE = "aprende-vocabulario.json";

let silenciarCambios = 0;
let subiendo = false;
let subidaPendiente = false;
let timerSubida = null;

function clientIdConfigurado() {
  const id = (chrome.runtime.getManifest().oauth2 || {}).client_id || "";
  return !!id && id !== CLIENT_ID_MARCADOR && id.endsWith(".apps.googleusercontent.com");
}

async function estadoDrive() {
  const { driveConectado, driveEmail } = await chrome.storage.local.get([
    "driveConectado",
    "driveEmail",
  ]);
  const configurado = clientIdConfigurado();
  return {
    ok: true,
    configurado,
    conectado: !!driveConectado && configurado,
    email: driveEmail || "",
    carpeta: CARPETA_DRIVE,
    archivo: ARCHIVO_DRIVE,
  };
}

async function conectarDrive() {
  if (!clientIdConfigurado()) {
    const estado = await estadoDrive();
    return {
      ...estado,
      ok: false,
      error: "El inicio de sesión con Google todavía no está activado en esta versión de la extensión.",
    };
  }
  try {
    const token = await obtenerToken(true);
    const email = await leerEmail(token);
    await chrome.storage.local.set({ driveConectado: true, driveEmail: email });
    await sincronizarDrive();
    return await estadoDrive();
  } catch (error) {
    const estado = await estadoDrive();
    return { ...estado, ok: false, conectado: false, error: mensajeError(error) };
  }
}

async function desconectarDrive() {
  try {
    if (chrome.identity.clearAllCachedAuthTokens) {
      await chrome.identity.clearAllCachedAuthTokens();
    }
  } catch (error) {
    console.warn("No se pudo limpiar el token de Google:", error);
  }
  await chrome.storage.local.set({ driveConectado: false, driveEmail: "" });
  await chrome.storage.local.remove(["driveFileId", "driveCarpetaId"]);
  return estadoDrive();
}

async function sincronizarDrive() {
  const almacen = await chrome.storage.local.get([
    "driveConectado",
    "vocabulario",
    "eliminadas",
  ]);
  if (!almacen.driveConectado || !clientIdConfigurado()) return estadoDrive();

  const token = await obtenerToken(false);
  const remoto = await descargarDocumento(token);
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
    !remoto.existe ||
    distinto(remoto.vocabulario || {}, fusion.vocabulario) ||
    distinto(remoto.eliminadas || {}, fusion.eliminadas);
  if (cambioRemoto) await subirAhora();
  return estadoDrive();
}

function programarSubida() {
  clearTimeout(timerSubida);
  timerSubida = setTimeout(() => {
    subirVocabulario().catch((error) => console.warn("Drive:", error));
  }, 1500);
}

async function subirVocabulario() {
  const { driveConectado } = await chrome.storage.local.get("driveConectado");
  if (!driveConectado || !clientIdConfigurado()) return;
  if (subiendo) {
    subidaPendiente = true;
    return;
  }
  subiendo = true;
  try {
    do {
      subidaPendiente = false;
      await subirAhora();
    } while (subidaPendiente);
  } finally {
    subiendo = false;
  }
}

async function subirAhora() {
  const token = await obtenerToken(false);
  const { vocabulario, eliminadas } = await chrome.storage.local.get([
    "vocabulario",
    "eliminadas",
  ]);
  const contenido = JSON.stringify(
    {
      version: 1,
      actualizado: new Date().toISOString(),
      vocabulario: vocabulario || {},
      eliminadas: eliminadas || {},
    },
    null,
    2
  );
  const carpetaId = await asegurarCarpeta(token);
  let archivoId = await buscarArchivo(token, carpetaId);
  if (!archivoId) {
    archivoId = await crearArchivo(token, carpetaId, contenido);
  } else {
    await actualizarArchivo(token, archivoId, contenido);
  }
  await chrome.storage.local.set({ driveFileId: archivoId, driveCarpetaId: carpetaId });
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

function mensajeError(error) {
  const texto = (error && error.message) || String(error);
  if (/did not approve|canceled|cancelled/i.test(texto)) {
    return "No se completó el inicio de sesión con Google.";
  }
  if (/not signed in|sign in/i.test(texto)) {
    return "Inicia sesión en Chrome con tu cuenta de Google e inténtalo de nuevo.";
  }
  return texto;
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

function obtenerToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: !!interactive }, (token) => {
      const fallo = chrome.runtime.lastError;
      const valor = typeof token === "string" ? token : token && token.token;
      if (fallo || !valor) {
        reject(new Error((fallo && fallo.message) || "Google no entregó un token"));
        return;
      }
      resolve(valor);
    });
  });
}

async function leerEmail(token) {
  try {
    const respuesta = await driveFetch(
      "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
      { method: "GET" },
      token
    );
    if (!respuesta.ok) return "";
    const datos = await respuesta.json();
    return (datos.user && datos.user.emailAddress) || "";
  } catch (error) {
    return "";
  }
}

async function driveFetch(url, opciones, token, reintento) {
  const respuesta = await fetch(url, {
    ...opciones,
    headers: {
      Authorization: "Bearer " + token,
      ...(opciones.headers || {}),
    },
  });
  if (respuesta.status === 401 && !reintento) {
    await new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, resolve);
    });
    const nuevo = await obtenerToken(false);
    return driveFetch(url, opciones, nuevo, true);
  }
  return respuesta;
}

async function leerError(respuesta) {
  try {
    const datos = await respuesta.json();
    return (datos.error && datos.error.message) || "HTTP " + respuesta.status;
  } catch (error) {
    return "HTTP " + respuesta.status;
  }
}

async function asegurarCarpeta(token) {
  const { driveCarpetaId } = await chrome.storage.local.get("driveCarpetaId");
  if (driveCarpetaId && (await existeArchivo(token, driveCarpetaId))) return driveCarpetaId;

  const consulta =
    "name = '" +
    CARPETA_DRIVE +
    "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const encontrada = await buscarPrimero(token, consulta);
  if (encontrada) {
    await chrome.storage.local.set({ driveCarpetaId: encontrada });
    return encontrada;
  }

  const respuesta = await driveFetch(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: CARPETA_DRIVE,
        mimeType: "application/vnd.google-apps.folder",
      }),
    },
    token
  );
  if (!respuesta.ok) throw new Error(await leerError(respuesta));
  const datos = await respuesta.json();
  await chrome.storage.local.set({ driveCarpetaId: datos.id });
  return datos.id;
}

async function buscarArchivo(token, carpetaId) {
  const { driveFileId } = await chrome.storage.local.get("driveFileId");
  if (driveFileId && (await existeArchivo(token, driveFileId))) return driveFileId;
  const consulta =
    "name = '" + ARCHIVO_DRIVE + "' and '" + carpetaId + "' in parents and trashed = false";
  return buscarPrimero(token, consulta);
}

async function existeArchivo(token, id) {
  const respuesta = await driveFetch(
    "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?fields=id,trashed",
    { method: "GET" },
    token
  );
  if (!respuesta.ok) return false;
  const datos = await respuesta.json();
  return datos && !datos.trashed;
}

async function buscarPrimero(token, consulta) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", consulta);
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "1");
  const respuesta = await driveFetch(url.toString(), { method: "GET" }, token);
  if (!respuesta.ok) throw new Error(await leerError(respuesta));
  const datos = await respuesta.json();
  return datos.files && datos.files[0] ? datos.files[0].id : "";
}

async function crearArchivo(token, carpetaId, contenido) {
  const boundary = "aprende-vocabulario";
  const meta = JSON.stringify({
    name: ARCHIVO_DRIVE,
    mimeType: "application/json",
    parents: [carpetaId],
  });
  const body =
    "--" + boundary +
    "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
    "\r\n--" + boundary +
    "\r\nContent-Type: application/json\r\n\r\n" + contenido +
    "\r\n--" + boundary + "--";
  const respuesta = await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body,
    },
    token
  );
  if (!respuesta.ok) throw new Error(await leerError(respuesta));
  const datos = await respuesta.json();
  return datos.id;
}

async function actualizarArchivo(token, archivoId, contenido) {
  const respuesta = await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files/" +
      encodeURIComponent(archivoId) +
      "?uploadType=media",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: contenido,
    },
    token
  );
  if (!respuesta.ok) throw new Error(await leerError(respuesta));
}

async function descargarDocumento(token) {
  const vacio = { existe: false, vocabulario: {}, eliminadas: {} };
  const carpetaId = await asegurarCarpeta(token);
  const archivoId = await buscarArchivo(token, carpetaId);
  if (!archivoId) return vacio;

  const respuesta = await driveFetch(
    "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(archivoId) + "?alt=media",
    { method: "GET" },
    token
  );
  if (respuesta.status === 404) {
    await chrome.storage.local.remove("driveFileId");
    return vacio;
  }
  if (!respuesta.ok) throw new Error(await leerError(respuesta));
  const texto = await respuesta.text();
  if (!texto.trim()) return vacio;
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch (error) {
    throw new Error("El archivo de Drive no es un vocabulario válido");
  }
  return {
    existe: true,
    vocabulario: datos.vocabulario || {},
    eliminadas: datos.eliminadas || {},
  };
}

chrome.storage.onChanged.addListener((cambios, area) => {
  if (area !== "local") return;
  if (silenciarCambios > 0) {
    silenciarCambios--;
    return;
  }
  if (!cambios.vocabulario && !cambios.eliminadas) return;
  programarSubida();
});

chrome.runtime.onStartup.addListener(() => {
  sincronizarDrive().catch((error) => console.warn("Drive:", error));
});
