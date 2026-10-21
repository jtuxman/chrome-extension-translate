// Panel lateral: muestra el vocabulario y se actualiza solo cuando
// chrome.storage cambia.

const STORAGE_KEY = "vocabulario";

const lista = document.getElementById("lista");
const vacio = document.getElementById("vacio");
const contador = document.getElementById("contador");
const buscar = document.getElementById("buscar");
const borrarTodo = document.getElementById("borrarTodo");
const ajustes = document.getElementById("ajustes");

let vocabularioActual = {};

document.addEventListener("DOMContentLoaded", cargar);

buscar.addEventListener("input", render);

ajustes.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

borrarTodo.addEventListener("click", async () => {
  if (confirm("¿Borrar todo tu vocabulario guardado?")) {
    await chrome.storage.local.set({ [STORAGE_KEY]: {} });
  }
});

// Se actualiza solo cuando el service worker guarda una palabra nueva.
chrome.storage.onChanged.addListener((cambios, area) => {
  if (area === "local" && cambios[STORAGE_KEY]) {
    vocabularioActual = cambios[STORAGE_KEY].newValue || {};
    render();
  }
});

async function cargar() {
  const almacen = await chrome.storage.local.get(STORAGE_KEY);
  vocabularioActual = almacen[STORAGE_KEY] || {};
  render();
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
  borrar.textContent = "borrar";
  borrar.addEventListener("click", () => borrarItem(it.palabra));
  meta.appendChild(borrar);

  li.appendChild(meta);
  return li;
}

function resaltarContexto(contexto, palabra) {
  return contexto;
}

async function borrarItem(palabra) {
  const clave = (palabra || "").toLowerCase();
  const almacen = await chrome.storage.local.get(STORAGE_KEY);
  const vocabulario = almacen[STORAGE_KEY] || {};
  delete vocabulario[clave];
  await chrome.storage.local.set({ [STORAGE_KEY]: vocabulario });
}
