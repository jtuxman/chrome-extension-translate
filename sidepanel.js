// Panel lateral: muestra el vocabulario y se actualiza solo cuando
// chrome.storage cambia.

const STORAGE_KEY = "vocabulario";

const lista = document.getElementById("lista");
const vacio = document.getElementById("vacio");
const contador = document.getElementById("contador");
const buscar = document.getElementById("buscar");
const borrarTodo = document.getElementById("borrarTodo");
const ajustes = document.getElementById("ajustes");
const jugar = document.getElementById("jugar");
const rachaChip = document.getElementById("racha");
const exportar = document.getElementById("exportar");
const importar = document.getElementById("importar");
const archivoImport = document.getElementById("archivoImport");
const driveEstado = document.getElementById("driveEstado");
const driveConectar = document.getElementById("driveConectar");
const driveDesconectar = document.getElementById("driveDesconectar");

let vocabularioActual = {};

document.addEventListener("DOMContentLoaded", () => {
  cargar();
  prepararDrive();
});

buscar.addEventListener("input", render);

ajustes.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

jugar.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("juego.html") });
});

exportar.addEventListener("click", exportarJSON);
importar.addEventListener("click", () => archivoImport.click());
archivoImport.addEventListener("change", importarJSON);

borrarTodo.addEventListener("click", async () => {
  if (!confirm("¿Borrar todo tu vocabulario guardado?")) return;
  const almacen = await chrome.storage.local.get([STORAGE_KEY, "eliminadas"]);
  const vocabulario = almacen[STORAGE_KEY] || {};
  const eliminadas = almacen.eliminadas || {};
  const ahora = new Date().toISOString();
  for (const clave of Object.keys(vocabulario)) eliminadas[clave] = ahora;
  await chrome.storage.local.set({ [STORAGE_KEY]: {}, eliminadas });
});

// Se actualiza solo cuando el service worker guarda una palabra nueva
// o cuando los juegos actualizan la racha.
chrome.storage.onChanged.addListener((cambios, area) => {
  if (area !== "local") return;
  if (cambios[STORAGE_KEY]) {
    vocabularioActual = cambios[STORAGE_KEY].newValue || {};
    render();
  }
  if (cambios.racha) {
    mostrarRacha();
  }
});

async function cargar() {
  const almacen = await chrome.storage.local.get(STORAGE_KEY);
  vocabularioActual = almacen[STORAGE_KEY] || {};
  render();
  mostrarRacha();
}

async function mostrarRacha() {
  const { racha } = await chrome.storage.local.get("racha");
  const r = racha || { ultimaFecha: null, dias: 0 };

  const d = new Date();
  const hoy = fechaLocal(d);
  const ayer = fechaLocal(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const dias = r.ultimaFecha === hoy || r.ultimaFecha === ayer ? r.dias : 0;

  rachaChip.textContent = "🔥 " + dias;
  rachaChip.title =
    "Días seguidos practicando" + (r.mejor ? " · récord: " + r.mejor : "");
}

function fechaLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + dia;
}

function render() {
  const filtro = (buscar.value || "").toLowerCase().trim();

  const items = Object.values(vocabularioActual)
    .filter((it) => {
      if (!filtro) return true;
      return (
        (it.palabra || "").toLowerCase().includes(filtro) ||
        (it.traduccion || "").toLowerCase().includes(filtro)
      );
    })
    .sort((a, b) => (b.ultimaVez || b.fecha).localeCompare(a.ultimaVez || a.fecha));

  const total = Object.keys(vocabularioActual).length;
  contador.textContent = total === 1 ? "1 palabra" : total + " palabras";

  lista.innerHTML = "";

  if (items.length === 0) {
    vacio.style.display = "block";
    vacio.textContent = total
      ? "Sin resultados para tu búsqueda."
      : "Selecciona una palabra en inglés en cualquier página para empezar a construir tu vocabulario.";
    return;
  }
  vacio.style.display = "none";

  for (const it of items) {
    lista.appendChild(crearItem(it));
  }
}

function crearItem(it) {
  const li = document.createElement("li");
  li.className = "item";

  const fila = document.createElement("div");
  fila.className = "fila";

  const palabra = document.createElement("span");
  palabra.className = "palabra";
  palabra.textContent = it.palabra;

  const traduccion = document.createElement("span");
  traduccion.className = "traduccion";
  traduccion.textContent = it.traduccion;

  fila.appendChild(palabra);
  fila.appendChild(traduccion);
  li.appendChild(fila);

  if (it.contexto) {
    const contexto = document.createElement("p");
    contexto.className = "contexto";
    contexto.textContent = resaltarContexto(it.contexto, it.palabra);
    li.appendChild(contexto);
  }

  const meta = document.createElement("div");
  meta.className = "meta";

  const veces = document.createElement("span");
  veces.textContent = "Vista " + (it.vecesVista || 1) + "×";
  meta.appendChild(veces);

  if (it.url) {
    const fuente = document.createElement("a");
    fuente.href = it.url;
    fuente.target = "_blank";
    fuente.rel = "noreferrer";
    fuente.textContent = "fuente";
    meta.appendChild(fuente);
  }

  const borrar = document.createElement("button");
  borrar.className = "btn-borrar";
  borrar.type = "button";
  borrar.textContent = "Eliminar";
  borrar.addEventListener("click", () => borrarItem(it.palabra));
  meta.appendChild(borrar);

  li.appendChild(meta);
  return li;
}

function resaltarContexto(contexto, palabra) {
  return contexto;
}

async function borrarItem(palabra) {
  const visible = palabra || "";
  if (!confirm("¿Eliminar «" + visible + "» del diccionario?")) return;
  const clave = visible.toLowerCase();
  const almacen = await chrome.storage.local.get([STORAGE_KEY, "eliminadas"]);
  const vocabulario = almacen[STORAGE_KEY] || {};
  const eliminadas = almacen.eliminadas || {};
  delete vocabulario[clave];
  eliminadas[clave] = new Date().toISOString();
  await chrome.storage.local.set({ [STORAGE_KEY]: vocabulario, eliminadas });
}

function enviarDrive(mensaje) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(mensaje, (respuesta) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(respuesta || { ok: false, error: "Sin respuesta de la extensión" });
    });
  });
}

driveConectar.addEventListener("click", async () => {
  driveConectar.disabled = true;
  driveEstado.classList.remove("error");
  driveEstado.textContent = "Abriendo Google…";
  pintarDrive(await enviarDrive({ tipo: "drive-conectar" }));
  driveConectar.disabled = false;
});

driveDesconectar.addEventListener("click", async () => {
  pintarDrive(await enviarDrive({ tipo: "drive-desconectar" }));
});

async function prepararDrive() {
  const estado = await enviarDrive({ tipo: "drive-estado" });
  pintarDrive(estado);
  if (estado.conectado) pintarDrive(await enviarDrive({ tipo: "drive-sincronizar" }));
}

function pintarDrive(estado) {
  estado = estado || {};
  const conectado = !!estado.conectado;
  driveConectar.hidden = conectado;
  driveDesconectar.hidden = !conectado;
  driveEstado.classList.toggle("error", estado.ok === false);

  if (estado.ok === false) {
    driveEstado.textContent = estado.error || "No se pudo conectar con Google Drive";
  } else if (conectado) {
    const cuenta = estado.email ? " de " + estado.email : "";
    driveEstado.textContent =
      "Guardado en Google Drive" + cuenta + ": carpeta «" + estado.carpeta + "», archivo " +
      estado.archivo + ".";
  } else {
    driveEstado.textContent =
      "Guarda tus palabras en Google Drive para verlas desde otra computadora.";
  }
}

// --- Exportar / Importar ----------------------------------------------------

function exportarJSON() {
  const datos = JSON.stringify(vocabularioActual, null, 2);
  const blob = new Blob([datos], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const fecha = new Date().toISOString().slice(0, 10);

  const a = document.createElement("a");
  a.href = url;
  a.download = "vocabulario-" + fecha + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importarJSON(evento) {
  const archivo = evento.target.files && evento.target.files[0];
  if (!archivo) return;

  try {
    const texto = await archivo.text();
    const datos = JSON.parse(texto);
    const importado = normalizarImportado(datos);

    // Fusionar con lo existente: si la palabra ya existe, suma vecesVista.
    const fusionado = { ...vocabularioActual };
    for (const [clave, item] of Object.entries(importado)) {
      if (fusionado[clave]) {
        fusionado[clave].vecesVista =
          (fusionado[clave].vecesVista || 1) + (item.vecesVista || 1);
      } else {
        fusionado[clave] = item;
      }
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: fusionado });
    alert("Vocabulario importado correctamente.");
  } catch (e) {
    alert("No se pudo importar el archivo: " + e.message);
  } finally {
    evento.target.value = ""; // permitir reimportar el mismo archivo
  }
}

// Acepta tanto el formato objeto { clave: item } como un array de items.
function normalizarImportado(datos) {
  const resultado = {};
  const items = Array.isArray(datos) ? datos : Object.values(datos);

  for (const item of items) {
    if (!item || !item.palabra) continue;
    const clave = String(item.palabra).toLowerCase();
    resultado[clave] = {
      palabra: item.palabra,
      traduccion: item.traduccion || "",
      contexto: item.contexto || "",
      url: item.url || "",
      fecha: item.fecha || new Date().toISOString(),
      ultimaVez: item.ultimaVez || item.fecha || new Date().toISOString(),
      vecesVista: item.vecesVista || 1,
      nivel: item.nivel || 0,
      aciertos: item.aciertos || 0,
      fallos: item.fallos || 0,
      proximoRepaso: item.proximoRepaso || null,
    };
  }
  return resultado;
}
