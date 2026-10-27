// Pantalla de juegos: usa el vocabulario guardado en chrome.storage.local
// y aplica repetición espaciada (Leitner) para priorizar el repaso.

const STORAGE_KEY = "vocabulario";
const PREGUNTAS_POR_RONDA = 10;

// Intervalos de repaso por nivel (en días). Nivel 0 = repasar hoy.
const INTERVALOS_DIAS = [0, 1, 3, 7, 14, 30];
const NIVEL_MAX = INTERVALOS_DIAS.length - 1;

const DIA_MS = 24 * 60 * 60 * 1000;

// --- Estado ----------------------------------------------------------------

let vocabulario = {}; // objeto { clave: item }
let ronda = []; // array de items para esta ronda
let indice = 0;
let aciertos = 0;
let fallos = 0;
let modoActual = "flashcards";

// --- Referencias DOM --------------------------------------------------------

const el = {
  statTotal: document.getElementById("statTotal"),
  statPendientes: document.getElementById("statPendientes"),
  menu: document.getElementById("menu"),
  juego: document.getElementById("juego"),
  resultados: document.getElementById("resultados"),
  tarjeta: document.getElementById("tarjeta"),
  avisoVacio: document.getElementById("avisoVacio"),
  soloPendientes: document.getElementById("soloPendientes"),
  progresoTexto: document.getElementById("progresoTexto"),
  barraFill: document.getElementById("barraFill"),
  aciertos: document.getElementById("aciertos"),
  fallos: document.getElementById("fallos"),
  salir: document.getElementById("salir"),
  resumen: document.getElementById("resumen"),
  jugarOtra: document.getElementById("jugarOtra"),
  volverMenu: document.getElementById("volverMenu"),
};

// --- Init -------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await cargarVocabulario();

  document.querySelectorAll(".modo").forEach((btn) => {
    btn.addEventListener("click", () => empezar(btn.dataset.modo));
  });
  el.salir.addEventListener("click", irAlMenu);
  el.volverMenu.addEventListener("click", irAlMenu);
  el.jugarOtra.addEventListener("click", () => empezar(modoActual));

  actualizarStats();
}

async function cargarVocabulario() {
  const almacen = await chrome.storage.local.get(STORAGE_KEY);
  vocabulario = almacen[STORAGE_KEY] || {};
}

function listaItems() {
  return Object.values(vocabulario);
}

function itemsPendientes() {
  const ahora = Date.now();
  return listaItems().filter((it) => {
    if (!it.proximoRepaso) return true; // nunca repasada
    return new Date(it.proximoRepaso).getTime() <= ahora;
  });
}

function actualizarStats() {
  const total = listaItems().length;
  const pend = itemsPendientes().length;
  el.statTotal.textContent = total === 1 ? "1 palabra" : total + " palabras";
  el.statPendientes.textContent = pend + " por repasar";
  el.avisoVacio.hidden = total > 0;
}

// --- Flujo de juego ---------------------------------------------------------

function empezar(modo) {
  modoActual = modo;

  const base = el.soloPendientes.checked ? itemsPendientes() : listaItems();
  const fuente = base.length > 0 ? base : listaItems();

  if (fuente.length === 0) {
    irAlMenu();
    actualizarStats();
    return;
  }

  ronda = mezclar(fuente.slice()).slice(0, PREGUNTAS_POR_RONDA);
  indice = 0;
  aciertos = 0;
  fallos = 0;

  mostrarSeccion("juego");
  el.aciertos.textContent = "0";
  el.fallos.textContent = "0";
  siguientePregunta();
}

function siguientePregunta() {
  if (indice >= ronda.length) {
    terminar();
    return;
  }

  const item = ronda[indice];
  el.progresoTexto.textContent = indice + 1 + " / " + ronda.length;
  el.barraFill.style.width = ((indice / ronda.length) * 100).toFixed(0) + "%";

  if (modoActual === "flashcards") renderFlashcard(item);
  else if (modoActual === "opcion") renderOpcionMultiple(item);
  else renderEscribir(item);
}

// --- Modo: Flashcards -------------------------------------------------------

function renderFlashcard(item) {
  el.tarjeta.innerHTML = "";

  const palabra = document.createElement("div");
  palabra.className = "palabra-grande";
  palabra.textContent = item.palabra;
  el.tarjeta.appendChild(palabra);

  if (item.contexto) {
    const ctx = document.createElement("p");
    ctx.className = "contexto";
    ctx.textContent = item.contexto;
    el.tarjeta.appendChild(ctx);
  }

  const respuesta = document.createElement("div");
  respuesta.className = "respuesta-oculta";
  respuesta.textContent = item.traduccion;
  respuesta.hidden = true;
  el.tarjeta.appendChild(respuesta);

  const btnMostrar = document.createElement("button");
  btnMostrar.className = "btn-primario";
  btnMostrar.textContent = "Mostrar traducción";
  el.tarjeta.appendChild(btnMostrar);

  const juicio = document.createElement("div");
  juicio.className = "juicio";
  juicio.hidden = true;
  juicio.innerHTML =
    '<button class="btn-mal">No la sabía</button>' +
    '<button class="btn-ok">¡La sabía!</button>';
  el.tarjeta.appendChild(juicio);

  btnMostrar.addEventListener("click", () => {
    respuesta.hidden = false;
    btnMostrar.hidden = true;
    juicio.hidden = false;
  });

  juicio.querySelector(".btn-ok").addEventListener("click", () =>
    resolver(item, true)
  );
  juicio.querySelector(".btn-mal").addEventListener("click", () =>
    resolver(item, false)
  );
}

// --- Modo: Opción múltiple --------------------------------------------------

function renderOpcionMultiple(item) {
  el.tarjeta.innerHTML = "";

  const palabra = document.createElement("div");
  palabra.className = "palabra-grande";
  palabra.textContent = item.palabra;
  el.tarjeta.appendChild(palabra);

  const opciones = generarOpciones(item);
  const cont = document.createElement("div");
  cont.className = "opciones";

  opciones.forEach((texto) => {
    const btn = document.createElement("button");
    btn.className = "opcion-btn";
    btn.textContent = texto;
    btn.addEventListener("click", () => {
      const correcto = texto === item.traduccion;
      // Marcar visualmente.
      cont.querySelectorAll(".opcion-btn").forEach((b) => {
        b.disabled = true;
        if (b.textContent === item.traduccion) b.classList.add("correcta");
        else if (b === btn) b.classList.add("incorrecta");
      });
      setTimeout(() => resolver(item, correcto), 900);
    });
    cont.appendChild(btn);
  });

  el.tarjeta.appendChild(cont);
}

function generarOpciones(item) {
  const distractores = mezclar(
    listaItems()
      .filter((it) => it.traduccion && it.traduccion !== item.traduccion)
      .map((it) => it.traduccion)
  );

  const unicos = [];
  for (const d of distractores) {
    if (!unicos.includes(d)) unicos.push(d);
    if (unicos.length >= 3) break;
  }

  return mezclar([item.traduccion, ...unicos]);
}

// --- Modo: Escribir ---------------------------------------------------------

function renderEscribir(item) {
  el.tarjeta.innerHTML = "";

  const palabra = document.createElement("div");
  palabra.className = "palabra-grande";
  palabra.textContent = item.palabra;
  el.tarjeta.appendChild(palabra);

  const form = document.createElement("form");
  form.className = "form-escribir";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Escribe la traducción…";
  input.autocomplete = "off";
  form.appendChild(input);

  const btn = document.createElement("button");
  btn.type = "submit";
  btn.className = "btn-primario";
  btn.textContent = "Comprobar";
  form.appendChild(btn);

  const feedback = document.createElement("div");
  feedback.className = "feedback";
  feedback.hidden = true;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const correcto = normalizar(input.value) === normalizar(item.traduccion);
    input.disabled = true;
    btn.disabled = true;
    feedback.hidden = false;
    feedback.className = "feedback " + (correcto ? "ok" : "mal");
    feedback.textContent = correcto
      ? "¡Correcto!"
      : 'Respuesta: "' + item.traduccion + '"';
    setTimeout(() => resolver(item, correcto), correcto ? 700 : 1400);
  });

  el.tarjeta.appendChild(form);
  el.tarjeta.appendChild(feedback);
  input.focus();
}

function normalizar(texto) {
  return (texto || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar acentos
    .replace(/\s+/g, " ");
}

// --- Resolución y repetición espaciada --------------------------------------

async function resolver(item, correcto) {
  if (correcto) {
    aciertos++;
    el.aciertos.textContent = String(aciertos);
  } else {
    fallos++;
    el.fallos.textContent = String(fallos);
  }

  await actualizarSR(item, correcto);

  indice++;
  siguientePregunta();
}

async function actualizarSR(item, correcto) {
  const clave = (item.palabra || "").toLowerCase();
  const almacen = await chrome.storage.local.get(STORAGE_KEY);
  const vocab = almacen[STORAGE_KEY] || {};
  const guardado = vocab[clave];
  if (!guardado) return;

  const nivelActual = guardado.nivel || 0;
  const nuevoNivel = correcto
    ? Math.min(nivelActual + 1, NIVEL_MAX)
    : 0;

  guardado.nivel = nuevoNivel;
  guardado.aciertos = (guardado.aciertos || 0) + (correcto ? 1 : 0);
  guardado.fallos = (guardado.fallos || 0) + (correcto ? 0 : 1);
  guardado.proximoRepaso = new Date(
    Date.now() + INTERVALOS_DIAS[nuevoNivel] * DIA_MS
  ).toISOString();
  guardado.ultimoRepaso = new Date().toISOString();

  await chrome.storage.local.set({ [STORAGE_KEY]: vocab });
  // Mantener copia local en memoria sincronizada.
  vocabulario = vocab;
}

// --- Fin de ronda -----------------------------------------------------------

function terminar() {
  const total = ronda.length;
  const pct = total ? Math.round((aciertos / total) * 100) : 0;
  el.resumen.textContent =
    "Acertaste " + aciertos + " de " + total + " (" + pct + "%).";
  mostrarSeccion("resultados");
  actualizarStats();
}

function irAlMenu() {
  mostrarSeccion("menu");
  actualizarStats();
}

// --- Utilidades -------------------------------------------------------------

function mostrarSeccion(cual) {
  el.menu.hidden = cual !== "menu";
  el.juego.hidden = cual !== "juego";
  el.resultados.hidden = cual !== "resultados";
}

function mezclar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
