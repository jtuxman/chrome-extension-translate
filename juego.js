// Pantalla de juegos: usa el vocabulario guardado en chrome.storage.local
// y aplica repetición espaciada (Leitner) para priorizar el repaso.

const STORAGE_KEY = "vocabulario";
const PREGUNTAS_POR_RONDA = 10;

// Intervalos de repaso por nivel (en días). Nivel 0 = repasar hoy.
const INTERVALOS_DIAS = [0, 1, 3, 7, 14, 30];
const NIVEL_MAX = INTERVALOS_DIAS.length - 1;

const DIA_MS = 24 * 60 * 60 * 1000;

const OPCIONES_RETO = 10;
const VELOCIDADES = [
  { id: "lento", nombre: "Lento", segundos: 25 },
  { id: "normal", nombre: "Normal", segundos: 15 },
  { id: "rapido", nombre: "Rápido", segundos: 8 },
];

// Relleno para el reto cuando el diccionario tiene pocas palabras.
const RELLENO_ES = [
  "casa", "camino", "ventana", "cuchillo", "hermoso", "lento", "fuerte", "barato",
  "cansado", "ruidoso", "pregunta", "respuesta", "semana", "montaña", "olvidar",
  "aprender", "esperar", "mejorar", "conseguir", "lograr", "temprano", "tarde",
  "orgulloso", "valiente", "peligroso", "sencillo", "rápido", "oscuro", "brillante",
  "vacío", "lleno", "amable", "enojado", "dinero", "trabajo", "ciudad", "puente",
  "cuenta", "regalo", "sueño",
];
const RELLENO_EN = [
  "house", "road", "window", "knife", "beautiful", "slow", "strong", "cheap",
  "tired", "noisy", "question", "answer", "week", "mountain", "forget", "learn",
  "wait", "improve", "achieve", "reach", "early", "late", "proud", "brave",
  "dangerous", "simple", "fast", "dark", "bright", "empty", "full", "kind",
  "angry", "money", "work", "city", "bridge", "account", "gift", "dream",
];

// --- Estado ----------------------------------------------------------------

let vocabulario = {}; // objeto { clave: item }
let ronda = []; // array de items para esta ronda
let indice = 0;
let aciertos = 0;
let fallos = 0;
let modoActual = "reto";
let direccion = "en-es"; // "en-es" (inglés→español) o "es-en" (inverso)
let temporizador = null;
let periodo = "todas";
let velocidad = "lento";

// Repaso por fecha en que se guardó la palabra. Semana y mes cuentan hacia
// atrás desde hoy, para que el lunes o el día 1 no queden casi vacíos.
const PERIODOS = [
  { id: "hoy", nombre: "De hoy", dias: 1, vacio: "Hoy todavía no guardaste palabras." },
  { id: "semana", nombre: "De los últimos 7 días", dias: 7, vacio: "No guardaste palabras en los últimos 7 días." },
  { id: "mes", nombre: "De los últimos 30 días", dias: 30, vacio: "No guardaste palabras en los últimos 30 días." },
  { id: "todas", nombre: "Todas", dias: 0, vacio: "" },
];
let sinonimos = {}; // { palabra en inglés: sinónimo común o "" }
let parecidas = {}; // { palabra en inglés: palabras de significado cercano }

// --- Referencias DOM --------------------------------------------------------

const el = {
  statTotal: document.getElementById("statTotal"),
  statPendientes: document.getElementById("statPendientes"),
  statRacha: document.getElementById("statRacha"),
  resumenRacha: document.getElementById("resumenRacha"),
  menu: document.getElementById("menu"),
  juego: document.getElementById("juego"),
  resultados: document.getElementById("resultados"),
  tarjeta: document.getElementById("tarjeta"),
  avisoVacio: document.getElementById("avisoVacio"),
  avisoModo: document.getElementById("avisoModo"),
  periodoMenu: document.getElementById("periodoMenu"),
  periodoJuego: document.getElementById("periodoJuego"),
  velocidadMenu: document.getElementById("velocidadMenu"),
  velocidadJuego: document.getElementById("velocidadJuego"),
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

  document.querySelectorAll('input[name="direccion"]').forEach((r) => {
    r.addEventListener("change", () => {
      direccion = r.value;
    });
  });

  const guardado = await chrome.storage.local.get(["periodoJuego", "velocidadReto"]);
  if (PERIODOS.some((p) => p.id === guardado.periodoJuego)) periodo = guardado.periodoJuego;
  if (VELOCIDADES.some((v) => v.id === guardado.velocidadReto)) velocidad = guardado.velocidadReto;
  pintarVelocidades();
  el.periodoMenu.addEventListener("change", () => cambiarPeriodo(el.periodoMenu.value, false));
  el.periodoJuego.addEventListener("change", () => cambiarPeriodo(el.periodoJuego.value, true));
  el.velocidadMenu.addEventListener("change", () => cambiarVelocidad(el.velocidadMenu.value));
  el.velocidadJuego.addEventListener("change", () => cambiarVelocidad(el.velocidadJuego.value));

  actualizarStats();
  await mostrarRacha();
}

async function cambiarPeriodo(nuevo, reiniciar) {
  periodo = nuevo;
  el.avisoModo.hidden = true;
  pintarPeriodos();
  await chrome.storage.local.set({ periodoJuego: periodo });
  if (reiniciar) empezar(modoActual);
}

function fechaGuardada(item) {
  return Date.parse(item.fecha || item.ultimaVez || "") || 0;
}

function enPeriodo(item, id) {
  const datos = PERIODOS.find((p) => p.id === (id || periodo));
  if (!datos || !datos.dias) return true;
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const desde = inicioHoy.getTime() - (datos.dias - 1) * DIA_MS;
  return fechaGuardada(item) >= desde;
}

// Las dos listas (menú y barra del juego) muestran cuántas palabras hay en
// cada periodo y quedan sincronizadas.
function segundosReto() {
  const datos = VELOCIDADES.find((v) => v.id === velocidad) || VELOCIDADES[1];
  return datos.segundos;
}

async function cambiarVelocidad(nueva) {
  if (!VELOCIDADES.some((v) => v.id === nueva)) return;
  velocidad = nueva;
  pintarVelocidades();
  await chrome.storage.local.set({ velocidadReto: velocidad });
}

function pintarVelocidades() {
  for (const select of [el.velocidadMenu, el.velocidadJuego]) {
    if (select.options.length !== VELOCIDADES.length) {
      select.textContent = "";
      for (const v of VELOCIDADES) {
        const opcion = document.createElement("option");
        opcion.value = v.id;
        opcion.textContent = v.nombre + " · " + v.segundos + " s";
        select.appendChild(opcion);
      }
    }
    select.value = velocidad;
  }
  el.velocidadJuego.hidden = el.juego.hidden;
}

function pintarPeriodos() {
  const items = listaItems();
  for (const select of [el.periodoMenu, el.periodoJuego]) {
    select.textContent = "";
    for (const p of PERIODOS) {
      const opcion = document.createElement("option");
      opcion.value = p.id;
      const cuantas = items.filter((it) => enPeriodo(it, p.id)).length;
      opcion.textContent = p.nombre + " (" + cuantas + ")";
      select.appendChild(opcion);
    }
    select.value = periodo;
  }
}

function direccionSeleccionada() {
  const r = document.querySelector('input[name="direccion"]:checked');
  return r ? r.value : "en-es";
}

// Devuelve el texto que se muestra (la pregunta) según la dirección.
function textoPregunta(item) {
  return direccion === "en-es" ? item.palabra : item.traduccion;
}

// Devuelve el texto correcto (la respuesta) según la dirección.
function textoRespuesta(item) {
  return limpiarTexto(direccion === "en-es" ? item.traduccion : item.palabra);
}

// Los motores a veces devuelven la traducción con punto final ("abrumador.")
// o con un guion suelto ("Para hervir a fuego lento -").
function limpiarTexto(texto) {
  return String(texto || "")
    .trim()
    .replace(/^[\s¡¿"'«(\-–—…]+/, "")
    .replace(/[\s.,;:!?"'»)\-–—…]+$/, "")
    .trim();
}

function contarPalabras(texto) {
  const limpio = limpiarTexto(texto);
  return limpio ? limpio.split(/\s+/).length : 0;
}

// Sin traducción, o con la misma palabra en inglés, no se puede preguntar.
function tieneTraduccion(item) {
  const en = limpiarTexto(item && item.palabra);
  const es = limpiarTexto(item && item.traduccion);
  return !!en && !!es && claveSentido(en) !== claveSentido(es);
}

// Escribir: sólo palabras sueltas y cortas; las frases quedan fuera.
function esPalabraCorta(item) {
  if (!tieneTraduccion(item)) return false;
  const ingles = limpiarTexto(item.palabra);
  const espanol = limpiarTexto(item.traduccion);
  return (
    contarPalabras(ingles) === 1 &&
    ingles.length <= 14 &&
    contarPalabras(espanol) >= 1 &&
    contarPalabras(espanol) <= 2 &&
    espanol.length <= 18
  );
}

function sirveParaReto(item) {
  return (
    tieneTraduccion(item) &&
    contarPalabras(item.palabra) <= 4 &&
    limpiarTexto(item.traduccion).length <= 40
  );
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
  pintarPeriodos();
}

// --- Flujo de juego ---------------------------------------------------------

async function empezar(modo) {
  modoActual = modo;
  direccion = direccionSeleccionada();
  el.avisoModo.hidden = true;

  const filtro = (item) => {
    if (!tieneTraduccion(item)) return false;
    if (modo === "escribir") return esPalabraCorta(item);
    if (modo === "reto") return sirveParaReto(item);
    return true;
  };
  const delPeriodo = listaItems().filter((it) => enPeriodo(it));
  const todos = delPeriodo.filter(filtro);
  const pendientes = itemsPendientes().filter((it) => enPeriodo(it) && filtro(it));
  const fuente = el.soloPendientes.checked && pendientes.length > 0 ? pendientes : todos;

  if (fuente.length === 0) {
    irAlMenu();
    if (listaItems().length > 0) {
      const datos = PERIODOS.find((p) => p.id === periodo);
      el.avisoModo.textContent =
        delPeriodo.length === 0
          ? datos.vacio + " Elige otro periodo en «Palabras guardadas»."
          : delPeriodo.every((it) => !tieneTraduccion(it))
            ? "Estas palabras no tienen una traducción distinta del inglés, así que no entran al juego."
            : modo === "escribir"
              ? "Para Escribir hacen falta palabras sueltas; las frases no entran en este juego."
              : "No hay palabras que sirvan para este juego.";
      el.avisoModo.hidden = false;
    }
    return;
  }

  ronda = mezclar(fuente.slice()).slice(0, PREGUNTAS_POR_RONDA);
  indice = 0;
  aciertos = 0;
  fallos = 0;

  mostrarSeccion("juego");
  pintarVelocidades();
  el.aciertos.textContent = "0";
  el.fallos.textContent = "0";

  siguientePregunta();
}

function siguientePregunta() {
  detenerTemporizador();
  if (indice >= ronda.length) {
    terminar();
    return;
  }

  const item = ronda[indice];
  el.progresoTexto.textContent = indice + 1 + " / " + ronda.length;
  el.barraFill.style.width = ((indice / ronda.length) * 100).toFixed(0) + "%";

  if (modoActual === "reto") renderReto(item);
  else if (modoActual === "opcion") renderOpcionMultiple(item);
  else renderEscribir(item);
}

// --- Modo: Reto (10 opciones, sinónimos y tiempo) ---------------------------

function renderReto(item) {
  el.tarjeta.innerHTML = "";
  const ingles = limpiarTexto(item.palabra);
  const correcta = textoRespuesta(item);

  const consigna = document.createElement("p");
  consigna.className = "consigna";
  consigna.textContent =
    direccion === "en-es" ? "¿Cómo se dice en español?" : "¿Cómo se dice en inglés?";
  el.tarjeta.appendChild(consigna);

  const palabra = document.createElement("div");
  palabra.className = "palabra-grande";
  palabra.textContent = textoPregunta(item);
  el.tarjeta.appendChild(palabra);

  el.tarjeta.appendChild(iniciarBarra(() => responder(null)));

  const opciones = generarOpciones(item, correcta, OPCIONES_RETO);
  const cont = document.createElement("div");
  cont.className = "opciones opciones-reto";
  el.tarjeta.appendChild(cont);

  const detalle = document.createElement("div");
  detalle.className = "feedback";
  detalle.hidden = true;
  el.tarjeta.appendChild(detalle);

  let respondida = false;
  function responder(elegido) {
    if (respondida) return;
    respondida = true;
    detenerTemporizador();
    const acierto = elegido !== null && claveSentido(elegido) === claveSentido(correcta);
    cont.querySelectorAll(".opcion-btn").forEach((b) => {
      b.disabled = true;
      if (claveSentido(b.dataset.valor) === claveSentido(correcta)) b.classList.add("correcta");
      else if (b.dataset.valor === elegido) b.classList.add("incorrecta");
    });
    detalle.hidden = false;
    detalle.className = "feedback " + (acierto ? "ok" : "mal");
    const prefijo = acierto ? "¡Correcto! " : elegido === null ? "Se acabó el tiempo. " : "";
    detalle.textContent = prefijo + ingles + " = " + correcta;
    mostrarSiguiente(item, acierto);
  }

  opciones.forEach((texto, posicion) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opcion-btn";
    btn.dataset.valor = texto;
    const tecla = document.createElement("span");
    tecla.className = "tecla";
    tecla.textContent = String((posicion + 1) % 10);
    btn.appendChild(tecla);
    btn.appendChild(document.createTextNode(texto));
    btn.addEventListener("click", () => responder(texto));
    cont.appendChild(btn);
  });
}

function iniciarBarra(alAgotar) {
  const tiempo = document.createElement("div");
  tiempo.className = "tiempo";
  const tiempoFill = document.createElement("div");
  tiempo.appendChild(tiempoFill);
  const duracion = segundosReto() * 1000;
  const inicio = Date.now();
  temporizador = setInterval(() => {
    const restante = Math.max(0, 1 - (Date.now() - inicio) / duracion);
    tiempoFill.style.width = (restante * 100).toFixed(1) + "%";
    tiempo.classList.toggle("urgente", restante < 0.3);
    if (restante <= 0) {
      detenerTemporizador();
      alAgotar();
    }
  }, 100);
  return tiempo;
}

function opcionesSinonimo(item, correcta) {
  const evitar = new Set(
    [correcta, item.palabra, ...(parecidas[claveSinonimo(item)] || [])].map(claveSentido)
  );
  const candidatos = listaItems()
    .map((it) => limpiarTexto(it.palabra))
    .filter((t) => contarPalabras(t) === 1)
    .concat(RELLENO_EN);
  return mezclar([correcta, ...elegirDistractores(candidatos, correcta, evitar, OPCIONES_RETO - 1)]);
}

function claveSinonimo(item) {
  return normalizar(limpiarTexto(item.palabra));
}

// Sinónimo común en inglés (Datamuse, sin clave). Se guarda para no repetir
// la consulta; si no hay red, la pregunta queda como traducción.
async function prepararSinonimos(items) {
  const { sinonimosEn: guardados } = await chrome.storage.local.get("sinonimosEn");
  const cache = guardados || {};
  const faltan = items
    .filter((it) => contarPalabras(it.palabra) === 1)
    .map(claveSinonimo)
    .filter((clave) => clave && !(clave in cache));

  await Promise.all(
    faltan.map(async (clave) => {
      try {
        const respuesta = await fetch(
          "https://api.datamuse.com/words?md=f&max=30&ml=" + encodeURIComponent(clave),
          { signal: AbortSignal.timeout(3000) }
        );
        if (!respuesta.ok) return;
        cache[clave] = elegirSinonimo(clave, await respuesta.json());
      } catch (error) {
        // Sin conexión: se vuelve a intentar en otra ronda.
      }
    })
  );
  if (faltan.length) await chrome.storage.local.set({ sinonimosEn: cache });

  sinonimos = {};
  parecidas = {};
  for (const [clave, dato] of Object.entries(cache)) {
    sinonimos[clave] = (dato && dato.sinonimo) || "";
    parecidas[clave] = (dato && dato.parecidas) || [];
  }
}

// De lo que Datamuse da como "significa algo como" (ya ordenado por cercanía),
// el primer sinónimo de uso medio: las palabras muy frecuentes suelen tener
// otro sentido ("drawn" por "tired", "weather" por "brave") y las raras no
// sirven para aprender. Todas se guardan para que ninguna salga como opción falsa.
function elegirSinonimo(clave, datos) {
  let mejor = "";
  const parecidasPalabra = [];
  for (const entrada of datos || []) {
    const palabra = String(entrada.word || "").toLowerCase();
    if (!palabra) continue;
    parecidasPalabra.push(palabra);
    const tags = entrada.tags || [];
    if (!tags.includes("syn") || !/^[a-z]+$/.test(palabra)) continue;
    if (palabra === clave || palabra.startsWith(clave) || clave.startsWith(palabra)) continue;
    const etiqueta = tags.find((t) => t.startsWith("f:"));
    const f = etiqueta ? parseFloat(etiqueta.slice(2)) : 0;
    if (!mejor && f >= 1.5 && f <= 45) mejor = palabra;
  }
  return { sinonimo: mejor, parecidas: parecidasPalabra };
}

function detenerTemporizador() {
  clearInterval(temporizador);
  temporizador = null;
}

// Tras responder: si fue correcto se avanza solo; si no, la corrección se
// queda hasta que se pulse Siguiente (o Enter).
function mostrarSiguiente(item, acierto) {
  if (acierto) {
    setTimeout(() => resolver(item, true), 900);
    return;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-primario";
  btn.textContent = "Siguiente →";
  btn.addEventListener("click", () => {
    btn.disabled = true;
    resolver(item, false);
  });
  el.tarjeta.appendChild(btn);
  btn.focus();
}

document.addEventListener("keydown", (evento) => {
  if (el.juego.hidden || modoActual !== "reto") return;
  if (!/^[0-9]$/.test(evento.key)) return;
  const posicion = evento.key === "0" ? 9 : Number(evento.key) - 1;
  const boton = el.tarjeta.querySelectorAll(".opcion-btn")[posicion];
  if (boton && !boton.disabled) boton.click();
});

// --- Modo: Opción múltiple --------------------------------------------------

function renderOpcionMultiple(item) {
  el.tarjeta.innerHTML = "";

  const palabra = document.createElement("div");
  palabra.className = "palabra-grande";
  palabra.textContent = textoPregunta(item);
  el.tarjeta.appendChild(palabra);
  let respondida = false;
  el.tarjeta.appendChild(
    iniciarBarra(() => {
      if (respondida) return;
      respondida = true;
      cont.querySelectorAll(".opcion-btn").forEach((b) => {
        b.disabled = true;
        if (claveSentido(b.textContent) === claveSentido(correcta)) b.classList.add("correcta");
      });
      setTimeout(() => resolver(item, false), 900);
    })
  );

  const correcta = textoRespuesta(item);
  const opciones = generarOpciones(item, correcta);
  const cont = document.createElement("div");
  cont.className = "opciones";

  opciones.forEach((texto) => {
    const btn = document.createElement("button");
    btn.className = "opcion-btn";
    btn.textContent = texto;
    if (!texto) return;
    btn.addEventListener("click", () => {
      if (respondida) return;
      respondida = true;
      detenerTemporizador();
      const acierto = claveSentido(texto) === claveSentido(correcta);
      // Marcar visualmente.
      cont.querySelectorAll(".opcion-btn").forEach((b) => {
        b.disabled = true;
        if (claveSentido(b.textContent) === claveSentido(correcta)) b.classList.add("correcta");
        else if (b === btn) b.classList.add("incorrecta");
      });
      setTimeout(() => resolver(item, acierto), 900);
    });
    cont.appendChild(btn);
  });

  el.tarjeta.appendChild(cont);
}

function generarOpciones(item, correcta, cantidad) {
  const total = cantidad || 4;
  const candidatos = listaItems()
    .filter(tieneTraduccion)
    .map((it) => textoRespuesta(it));
  if (total > 4) candidatos.push(...(direccion === "en-es" ? RELLENO_ES : RELLENO_EN));
  const evitar = new Set([claveSentido(correcta)]);
  return mezclar([correcta, ...elegirDistractores(candidatos, correcta, evitar, total - 1)]);
}

// Distractores que se parezcan a la respuesta (mismo número de palabras y
// largo parecido): así no se adivina por la forma. Nunca dos que digan lo mismo.
function elegirDistractores(candidatos, correcta, evitar, cantidad) {
  const vistos = new Set(evitar);
  const unicos = [];
  for (const bruto of mezclar(candidatos.slice())) {
    const texto = limpiarTexto(bruto);
    const clave = claveSentido(texto);
    if (!clave || vistos.has(clave)) continue;
    if (mismoSentido(texto, correcta) || unicos.some((u) => mismoSentido(u, texto))) continue;
    vistos.add(clave);
    unicos.push(texto);
  }
  const palabras = contarPalabras(correcta);
  const largo = correcta.length;
  const parecido = (texto) =>
    Math.abs(contarPalabras(texto) - palabras) * 6 + Math.abs(texto.length - largo) + Math.random() * 4;
  return unicos.sort((a, b) => parecido(a) - parecido(b)).slice(0, cantidad);
}

// --- Modo: Escribir ---------------------------------------------------------

function renderEscribir(item) {
  el.tarjeta.innerHTML = "";

  const palabra = document.createElement("div");
  palabra.className = "palabra-grande";
  palabra.textContent = limpiarTexto(textoPregunta(item));
  el.tarjeta.appendChild(palabra);
  el.tarjeta.appendChild(iniciarBarra(() => cerrar(true)));

  const esperado = textoRespuesta(item);
  const pista = document.createElement("div");
  pista.className = "pista";
  pista.setAttribute("aria-label", "Pista: empieza por " + esperado[0]);
  pintarPista(pista, esperado, "");
  el.tarjeta.appendChild(pista);

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

  input.maxLength = esperado.length + 6;
  input.addEventListener("input", () => pintarPista(pista, esperado, input.value));

  function cerrar(porTiempo) {
    if (input.disabled) return;
    detenerTemporizador();
    const correcto = !porTiempo && claveSentido(input.value) === claveSentido(esperado);
    input.disabled = true;
    btn.hidden = true;
    pintarPista(pista, esperado, esperado, porTiempo ? "" : input.value);
    feedback.hidden = false;
    feedback.className = "feedback " + (correcto ? "ok" : "mal");
    feedback.textContent = correcto
      ? "¡Correcto!"
      : porTiempo
        ? "Se acabó el tiempo. La respuesta es «" + esperado + "»."
        : "Escribiste «" + input.value.trim() + "». La respuesta es «" + esperado + "».";
    mostrarSiguiente(item, correcto);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.disabled || !input.value.trim()) return;
    cerrar(false);
  });

  el.tarjeta.appendChild(form);
  el.tarjeta.appendChild(feedback);
  input.focus();
}

// Una casilla por letra con la primera ya puesta. Mientras escribes se van
// llenando; al comprobar muestran la palabra correcta y marcan en rojo las
// letras que fallaste.
function pintarPista(contenedor, esperado, escrito, intento) {
  contenedor.textContent = "";
  const letras = Array.from(esperado);
  const tecleadas = Array.from(escrito.replace(/\s+/g, " "));
  const comparar = intento !== undefined ? Array.from(intento.trim()) : null;
  letras.forEach((letra, i) => {
    const casilla = document.createElement("span");
    if (letra === " ") {
      casilla.className = "casilla espacio";
      contenedor.appendChild(casilla);
      return;
    }
    casilla.className = "casilla";
    let visible = tecleadas[i] || (i === 0 ? letra : "");
    if (comparar) {
      visible = letra;
      casilla.classList.add(
        comparar[i] && normalizar(comparar[i]) === normalizar(letra) ? "bien" : "mal"
      );
    } else if (!tecleadas[i] && i === 0) {
      casilla.classList.add("dada");
    }
    casilla.textContent = visible;
    contenedor.appendChild(casilla);
  });
}

// Para comparar respuestas: sin mayúsculas, acentos ni signos.
function normalizar(texto) {
  return limpiarTexto(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar acentos
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Lo mismo, sin el "to" del infinitivo inglés ni el "para"/artículo inicial
// que a veces añade el traductor: "Para hervir a fuego lento" = "hervir a
// fuego lento", "to simmer" = "simmer".
function claveSentido(texto) {
  return normalizar(texto).replace(/^(to|para|el|la|los|las|un|una|the|a|an)\s+/, "");
}

// Dos opciones dicen lo mismo si coinciden o si una frase de varias palabras
// está contenida entera en la otra.
function mismoSentido(a, b) {
  const x = claveSentido(a);
  const y = claveSentido(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [corta, larga] = x.length <= y.length ? [x, y] : [y, x];
  return corta.includes(" ") && (" " + larga + " ").includes(" " + corta + " ");
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

async function terminar() {
  const total = ronda.length;
  const pct = total ? Math.round((aciertos / total) * 100) : 0;
  el.resumen.textContent =
    "Acertaste " + aciertos + " de " + total + " (" + pct + "%).";

  const racha = await registrarRacha();
  el.resumenRacha.textContent =
    racha.dias === 1
      ? "🔥 ¡Empiezas una racha! Día 1."
      : "🔥 Racha de " + racha.dias + " días seguidos. ¡Sigue así!";
  await mostrarRacha();

  mostrarSeccion("resultados");
  actualizarStats();
}

// --- Racha diaria -----------------------------------------------------------

function fechaLocal(d) {
  // YYYY-MM-DD en hora local.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + dia;
}

async function registrarRacha() {
  const { racha } = await chrome.storage.local.get("racha");
  const r = racha || { ultimaFecha: null, dias: 0, mejor: 0 };

  const hoy = fechaLocal(new Date());
  const ayer = fechaLocal(new Date(Date.now() - DIA_MS));

  if (r.ultimaFecha === hoy) {
    // Ya se contó la práctica de hoy; no cambia la racha.
    return r;
  }

  r.dias = r.ultimaFecha === ayer ? (r.dias || 0) + 1 : 1;
  r.ultimaFecha = hoy;
  if (r.dias > (r.mejor || 0)) r.mejor = r.dias;

  await chrome.storage.local.set({ racha: r });
  return r;
}

async function mostrarRacha() {
  const { racha } = await chrome.storage.local.get("racha");
  const r = racha || { ultimaFecha: null, dias: 0 };

  // Si la última práctica no fue hoy ni ayer, la racha visible es 0.
  const hoy = fechaLocal(new Date());
  const ayer = fechaLocal(new Date(Date.now() - DIA_MS));
  const dias = r.ultimaFecha === hoy || r.ultimaFecha === ayer ? r.dias : 0;

  el.statRacha.textContent = "🔥 " + dias;
  el.statRacha.title =
    "Días seguidos practicando" +
    (r.mejor ? " · récord: " + r.mejor : "");
}

function irAlMenu() {
  detenerTemporizador();
  mostrarSeccion("menu");
  pintarVelocidades();
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
