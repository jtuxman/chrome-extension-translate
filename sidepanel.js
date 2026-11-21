// Panel lateral: muestra el vocabulario y se actualiza solo cuando
// chrome.storage cambia.

const STORAGE_KEY = "vocabulario";
const ACTIVA_KEY = "avocActiva";

const lista = document.getElementById("lista");
const activar = document.getElementById("activar");
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
let periodoLista = "todas";
let paginaActual = 1;
const POR_PAGINA = 20;

const letraMenos = document.getElementById("letraMenos");
const letraMas = document.getElementById("letraMas");

document.addEventListener("DOMContentLoaded", () => {
  cargar();
  cargarActiva();
  prepararDrive();
  aplicarLetraGuardada();
});

letraMenos.addEventListener("click", () => cambiarLetra(-1));
letraMas.addEventListener("click", () => cambiarLetra(1));

function limitarLetra(valor) {
  return Math.min(22, Math.max(12, Number(valor) || 14));
}

function pintarLetra(px) {
  document.body.style.zoom = limitarLetra(px) / 14;
}

async function aplicarLetraGuardada() {
  const { config } = await chrome.storage.sync.get("config");
  const px = config && config.apariencia && config.apariencia.tamanoLetra;
  pintarLetra(px);
}

async function cambiarLetra(delta) {
  const { config } = await chrome.storage.sync.get("config");
  const actual = (config && config.apariencia) || {};
  const tamanoLetra = limitarLetra((actual.tamanoLetra || 14) + delta);
  await chrome.storage.sync.set({
    config: {
      ...(config || {}),
      apariencia: { ...actual, tamanoLetra },
    },
  });
  pintarLetra(tamanoLetra);
}

const paginaAnterior = document.getElementById("paginaAnterior");
const paginaSiguiente = document.getElementById("paginaSiguiente");
const paginaInfo = document.getElementById("paginaInfo");
const busquedaTraduccion = document.getElementById("busquedaTraduccion");
let timerBusqueda = null;
let busquedaEnCurso = 0;

buscar.addEventListener("input", () => {
  paginaActual = 1;
  render();
  programarTraduccionBusqueda();
});

paginaAnterior.addEventListener("click", () => {
  paginaActual -= 1;
  render();
});

paginaSiguiente.addEventListener("click", () => {
  paginaActual += 1;
  render();
});

document.querySelectorAll(".btn-periodo").forEach((boton) => {
  boton.addEventListener("click", () => {
    periodoLista = boton.dataset.periodo || "todas";
    paginaActual = 1;
    document.querySelectorAll(".btn-periodo").forEach((otro) => {
      otro.classList.toggle("activo", otro === boton);
    });
    render();
  });
});

// Interruptor para pausar la traducción al seleccionar mientras trabajas
// en otra cosa. El estado se guarda y lo lee el content script.
activar.addEventListener("click", async () => {
  const { [ACTIVA_KEY]: valor } = await chrome.storage.local.get(ACTIVA_KEY);
  const nueva = valor === false; // si estaba desactivada, se activa
  await chrome.storage.local.set({ [ACTIVA_KEY]: nueva });
  pintarActiva(nueva);
});

async function cargarActiva() {
  const { [ACTIVA_KEY]: valor } = await chrome.storage.local.get(ACTIVA_KEY);
  pintarActiva(valor !== false);
}

function pintarActiva(activa) {
  activar.classList.toggle("inactiva", !activa);
  activar.setAttribute("aria-checked", activa ? "true" : "false");
  activar.querySelector(".estado-activar").textContent = activa ? "Encendido" : "Apagado";
  activar.title = activa
    ? "Traducción activada. Pulsa para desactivarla mientras trabajas en otra cosa."
    : "Traducción desactivada. Pulsa para volver a activarla.";
}

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
  if (area === "sync" && cambios.config) {
    const nuevo = cambios.config.newValue || {};
    pintarLetra(nuevo.apariencia && nuevo.apariencia.tamanoLetra);
  }
  if (area !== "local") return;
  if (cambios[STORAGE_KEY]) {
    vocabularioActual = cambios[STORAGE_KEY].newValue || {};
    render();
  }
  if (cambios.racha) {
    mostrarRacha();
  }
  if (cambios[ACTIVA_KEY]) {
    pintarActiva(cambios[ACTIVA_KEY].newValue !== false);
  }
});

async function cargar() {
  const almacen = await chrome.storage.local.get(STORAGE_KEY);
  vocabularioActual = almacen[STORAGE_KEY] || {};
  render();
  mostrarRacha();
  chrome.runtime.sendMessage({ tipo: "detalle-reponer" }, () => {
    void chrome.runtime.lastError;
  });
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

function inicioDePeriodo(periodo) {
  const ahora = new Date();
  ahora.setHours(0, 0, 0, 0);
  if (periodo === "semana") {
    const dia = ahora.getDay();
    const hastaLunes = dia === 0 ? 6 : dia - 1;
    ahora.setDate(ahora.getDate() - hastaLunes);
    return ahora.getTime();
  }
  if (periodo === "mes") {
    ahora.setMonth(ahora.getMonth() - 1);
    return ahora.getTime();
  }
  if (periodo === "tres") {
    ahora.setMonth(ahora.getMonth() - 3);
    return ahora.getTime();
  }
  return 0;
}

function coincideBusqueda(it, filtro) {
  return (
    (it.palabra || "").toLowerCase().includes(filtro) ||
    (it.traduccion || "").toLowerCase().includes(filtro) ||
    (it.variantes || []).some((v) => (v.es || "").toLowerCase().includes(filtro))
  );
}

function ocultarTraduccionBusqueda() {
  busquedaTraduccion.hidden = true;
  busquedaTraduccion.classList.remove("error");
  busquedaTraduccion.textContent = "";
}

function programarTraduccionBusqueda() {
  clearTimeout(timerBusqueda);
  const texto = (buscar.value || "").replace(/\s+/g, " ").trim();
  if (texto.length < 2 || texto.length > 300) {
    ocultarTraduccionBusqueda();
    return;
  }
  const filtro = texto.toLowerCase();
  const existe = Object.values(vocabularioActual).some((it) => coincideBusqueda(it, filtro));
  if (existe) {
    ocultarTraduccionBusqueda();
    return;
  }
  busquedaTraduccion.hidden = false;
  busquedaTraduccion.classList.remove("error");
  busquedaTraduccion.textContent = "Traduciendo «" + texto + "»…";
  const id = ++busquedaEnCurso;
  timerBusqueda = setTimeout(() => traducirBusqueda(texto, id), 700);
}

function traducirBusqueda(texto, id) {
  chrome.runtime.sendMessage({ tipo: "traducir", texto, contexto: texto, url: "" }, (respuesta) => {
    if (id !== busquedaEnCurso) return;
    if ((buscar.value || "").replace(/\s+/g, " ").trim() !== texto) return;
    if (chrome.runtime.lastError || !respuesta || !respuesta.ok) {
      busquedaTraduccion.hidden = false;
      busquedaTraduccion.classList.add("error");
      busquedaTraduccion.textContent =
        "No se pudo traducir" +
        (respuesta && respuesta.error ? ": " + respuesta.error : "");
      return;
    }
    const otras = (respuesta.variantes || [])
      .map((v) => v.es)
      .filter((es) => es && es.toLowerCase() !== String(respuesta.traduccion || "").trim().toLowerCase());
    busquedaTraduccion.classList.remove("error");
    busquedaTraduccion.hidden = false;
    busquedaTraduccion.textContent =
      texto + " → " + respuesta.traduccion + (otras.length ? " (" + otras.join(", ") + ")" : "");
  });
}

function enPeriodoLista(it) {
  if (periodoLista === "todas") return true;
  const guardada = Date.parse(it.fecha || "");
  if (!guardada) return false;
  return guardada >= inicioDePeriodo(periodoLista);
}

function render() {
  const filtro = (buscar.value || "").toLowerCase().trim();

  const items = Object.values(vocabularioActual)
    .filter((it) => enPeriodoLista(it))
    .filter((it) => {
      if (!filtro) return true;
      return coincideBusqueda(it, filtro);
    })
    .sort((a, b) => (b.ultimaVez || b.fecha).localeCompare(a.ultimaVez || a.fecha));

  const total = Object.keys(vocabularioActual).length;
  contador.textContent = total === 1 ? "1 palabra" : total + " palabras";

  const paginas = Math.max(1, Math.ceil(items.length / POR_PAGINA));
  if (paginaActual > paginas) paginaActual = paginas;
  if (paginaActual < 1) paginaActual = 1;
  const inicio = (paginaActual - 1) * POR_PAGINA;
  const pagina = items.slice(inicio, inicio + POR_PAGINA);

  paginaInfo.textContent = "Página " + paginaActual + " de " + paginas;
  paginaAnterior.disabled = paginaActual <= 1;
  paginaSiguiente.disabled = paginaActual >= paginas;

  lista.innerHTML = "";

  if (items.length === 0) {
    vacio.style.display = "block";
    vacio.textContent = !total
      ? "Selecciona una palabra en inglés en cualquier página para empezar a construir tu vocabulario."
      : filtro
        ? "Sin resultados para tu búsqueda."
        : "No hay palabras guardadas en este periodo.";
    return;
  }
  vacio.style.display = "none";

  for (const it of pagina) {
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

  const otras = (it.variantes || [])
    .map((v) => (v && v.es) || "")
    .filter((es) => es && es.toLowerCase() !== String(it.traduccion || "").trim().toLowerCase());
  if (otras.length) {
    const variantes = document.createElement("p");
    variantes.className = "variantes";
    variantes.textContent = otras.join(", ");
    li.appendChild(variantes);
  }

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

  const guardada = Date.parse(it.fecha || "");
  if (guardada) {
    const fecha = document.createElement("span");
    const dia = new Date(guardada);
    const opciones = { day: "numeric", month: "short" };
    if (dia.getFullYear() !== new Date().getFullYear()) opciones.year = "numeric";
    fecha.textContent = "Guardada el " + dia.toLocaleDateString("es", opciones);
    fecha.title = dia.toLocaleString("es");
    meta.appendChild(fecha);
  }

  if (it.url) {
    const fuente = document.createElement("a");
    fuente.href = it.url;
    fuente.target = "_blank";
    fuente.rel = "noreferrer";
    fuente.textContent = "fuente";
    meta.appendChild(fuente);
  }

  const mas = document.createElement("span");
  mas.className = "mas-ejemplos";
  for (const [nombre, href] of enlacesEjemplo(it.palabra)) {
    const liga = document.createElement("a");
    liga.href = href;
    liga.target = "_blank";
    liga.rel = "noreferrer";
    liga.textContent = nombre;
    mas.appendChild(liga);
  }
  if (mas.childNodes.length) meta.appendChild(mas);

  const borrar = document.createElement("button");
  borrar.className = "btn-borrar";
  borrar.type = "button";
  borrar.textContent = "Eliminar";
  borrar.addEventListener("click", () => borrarItem(it.palabra));
  meta.appendChild(borrar);

  li.appendChild(meta);
  const detalle = bloqueDetalle(it);
  if (detalle) li.appendChild(detalle);
  return li;
}

function terminoBusqueda(palabra) {
  return String(palabra || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(to|a|an|the)\s+/i, "");
}

function enlacesEjemplo(palabra) {
  const termino = terminoBusqueda(palabra);
  if (!termino) return [];
  const consulta = encodeURIComponent(termino);
  return [
    ["Tatoeba", "https://tatoeba.org/es/sentences/search?from=eng&to=spa&query=" + consulta],
    ["Reverso", "https://context.reverso.net/traduccion/ingles-espanol/" + consulta],
    ["Linguee", "https://www.linguee.es/ingles-espanol/search?query=" + consulta],
  ];
}

function esExpresionCorta(palabra) {
  const texto = String(palabra || "").trim();
  return texto.length > 0 && texto.length <= 40 && texto.split(/\s+/).length <= 4 && !/[.!?]/.test(texto);
}

function bloqueDetalle(it) {
  const acepciones = it.acepciones || [];
  const ejemplos = it.ejemplos || [];
  const corta = esExpresionCorta(it.palabra);
  if (!corta && !acepciones.length && !ejemplos.length) {
    const nota = document.createElement("p");
    nota.className = "detalle-espera";
    nota.textContent = "Las frases de ejemplo se buscan en palabras o expresiones de hasta 4 palabras, no en oraciones.";
    return nota;
  }

  const bloque = document.createElement("div");
  bloque.className = "detalle";

  if (acepciones.length) {
    const grupo = document.createElement("details");
    grupo.className = "plegable";
    const resumen = document.createElement("summary");
    resumen.textContent = acepciones.length + (acepciones.length === 1 ? " acepción" : " acepciones");
    grupo.appendChild(resumen);
    for (const acepcion of acepciones) {
      const linea = document.createElement("p");
      linea.className = "acepcion";
      linea.textContent = (acepcion.tipo ? acepcion.tipo + ": " : "") + acepcion.es;
      grupo.appendChild(linea);
    }
    bloque.appendChild(grupo);
  }

  if (ejemplos.length) {
    const grupo = document.createElement("details");
    grupo.className = "plegable frases";
    const resumen = document.createElement("summary");
    resumen.textContent = ejemplos.length + (ejemplos.length === 1 ? " frase" : " frases");
    grupo.appendChild(resumen);
    for (const ejemplo of ejemplos) {
      const frase = document.createElement("p");
      const en = document.createElement("span");
      en.className = "frase-en";
      en.textContent = ejemplo.en;
      frase.appendChild(en);
      frase.appendChild(document.createTextNode(ejemplo.es));
      grupo.appendChild(frase);
    }
    bloque.appendChild(grupo);
  } else if (corta) {
    const espera = document.createElement("p");
    espera.className = "detalle-espera";
    espera.textContent = it.enriquecidoEn
      ? "No hay frases de ejemplo para esta expresión."
      : "Buscando acepciones y frases…";
    bloque.appendChild(espera);
    if (it.enriquecidoEn) bloque.appendChild(botonReintentar(it.palabra));
  }

  return bloque.childNodes.length ? bloque : null;
}

function botonReintentar(palabra) {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "btn-reintentar";
  boton.textContent = "Buscar de nuevo";
  boton.addEventListener("click", () => {
    boton.disabled = true;
    boton.textContent = "Buscando…";
    chrome.runtime.sendMessage(
      { tipo: "detalle-reintentar", clave: String(palabra || "").toLowerCase() },
      () => {
        void chrome.runtime.lastError;
      }
    );
  });
  return boton;
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
        if ((item.ejemplos || []).length > (fusionado[clave].ejemplos || []).length) {
          fusionado[clave].ejemplos = item.ejemplos;
          fusionado[clave].acepciones = item.acepciones;
          fusionado[clave].detalleFuente = item.detalleFuente;
        }
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
      variantes: Array.isArray(item.variantes) ? item.variantes : [],
      acepciones: Array.isArray(item.acepciones) ? item.acepciones : [],
      ejemplos: Array.isArray(item.ejemplos) ? item.ejemplos : [],
      detalleFuente: item.detalleFuente || "",
    };
  }
  return resultado;
}
