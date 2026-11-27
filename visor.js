// Visor de PDF propio (PDF.js). Renderiza cada página en un canvas y, encima,
// una capa de texto transparente y seleccionable. Así el traductor de selección
// (content.js, incluido en visor.html) funciona igual que en una página web.

import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
  "vendor/pdfjs/pdf.worker.min.mjs"
);

const paginasEl = document.getElementById("paginas");
const estadoEl = document.getElementById("estado");
const tituloEl = document.getElementById("titulo");
const zoomEl = document.getElementById("zoom");
const abrirEl = document.getElementById("abrir");

let escala = 1.3;
let pdfActual = null;
const paginas = new Map(); // nº de página -> PDFPageProxy
const renderizadas = new Set();

const observador = new IntersectionObserver(alVer, { rootMargin: "400px 0px" });

// La URL original viene tras "archivo=" sin codificar; se toma tal cual para
// no romper su propia cadena de consulta (?a=1&b=2).
function obtenerArchivo() {
  const marca = "archivo=";
  const i = location.href.indexOf(marca);
  return i === -1 ? "" : location.href.slice(i + marca.length);
}

function nombreDeUrl(url) {
  try {
    const u = new URL(url);
    const partes = u.pathname.split("/").filter(Boolean);
    return decodeURIComponent(partes.pop() || u.hostname);
  } catch (error) {
    return url;
  }
}

async function iniciar() {
  const archivo = obtenerArchivo();
  if (!archivo) {
    estadoEl.textContent = "No se indicó ningún PDF.";
    return;
  }
  const nombre = nombreDeUrl(archivo);
  tituloEl.textContent = nombre;
  tituloEl.title = archivo;
  document.title = nombre;
  abrirEl.href = archivo;

  try {
    // withCredentials envía las cookies de sesión: necesario para PDFs que
    // están detrás de un inicio de sesión (p. ej. abiertos desde un servicio).
    pdfActual = await pdfjsLib.getDocument({
      url: archivo,
      withCredentials: true,
    }).promise;
    await construir();
    estadoEl.style.display = "none";
  } catch (error) {
    estadoEl.textContent =
      "No se pudo abrir el PDF: " + ((error && error.message) || error);
  }
}

async function construir() {
  observador.disconnect();
  paginasEl.innerHTML = "";
  paginas.clear();
  renderizadas.clear();
  actualizarZoom();

  for (let n = 1; n <= pdfActual.numPages; n++) {
    const pagina = await pdfActual.getPage(n);
    paginas.set(n, pagina);
    const viewport = pagina.getViewport({ scale: escala });

    const div = document.createElement("div");
    div.className = "pagina";
    div.dataset.n = String(n);
    div.style.width = Math.floor(viewport.width) + "px";
    div.style.height = Math.floor(viewport.height) + "px";
    div.style.setProperty("--scale-factor", String(escala));
    paginasEl.appendChild(div);
    observador.observe(div);
  }
}

function alVer(entradas) {
  for (const entrada of entradas) {
    if (!entrada.isIntersecting) continue;
    const n = Number(entrada.target.dataset.n);
    if (renderizadas.has(n)) continue;
    renderizadas.add(n);
    renderizarPagina(n, entrada.target).catch((error) => {
      renderizadas.delete(n);
      console.warn("No se pudo dibujar la página " + n + ":", error);
    });
  }
}

async function renderizarPagina(n, div) {
  const pagina = paginas.get(n);
  if (!pagina) return;

  const viewport = pagina.getViewport({ scale: escala });
  const ratio = window.devicePixelRatio || 1;

  const canvas = document.createElement("canvas");
  canvas.className = "lienzo";
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = Math.floor(viewport.width) + "px";
  canvas.style.height = Math.floor(viewport.height) + "px";

  const ctx = canvas.getContext("2d");
  await pagina.render({
    canvasContext: ctx,
    viewport,
    transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
  }).promise;

  const capa = document.createElement("div");
  capa.className = "textLayer";
  const textContent = await pagina.getTextContent();
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: capa,
    viewport,
  });
  await textLayer.render();

  div.appendChild(canvas);
  div.appendChild(capa);
}

// Antes de imprimir hay que dibujar todas las páginas (se cargan de forma
// perezosa al hacer scroll, así que las no visibles aún no existen).
async function renderizarTodas() {
  const divs = Array.from(paginasEl.querySelectorAll(".pagina"));
  for (const div of divs) {
    const n = Number(div.dataset.n);
    if (renderizadas.has(n)) continue;
    renderizadas.add(n);
    try {
      await renderizarPagina(n, div);
    } catch (error) {
      renderizadas.delete(n);
      console.warn("No se pudo dibujar la página " + n + ":", error);
    }
  }
}

async function imprimir() {
  const boton = document.getElementById("imprimir");
  if (!pdfActual || boton.disabled) return;
  const previo = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Preparando…";
  try {
    await renderizarTodas();
    window.print();
  } finally {
    boton.textContent = previo;
    boton.disabled = false;
  }
}

function actualizarZoom() {
  zoomEl.textContent = Math.round(escala * 100) + "%";
}

function cambiarZoom(delta) {
  const nueva = Math.min(3, Math.max(0.5, Math.round((escala + delta) * 10) / 10));
  if (nueva === escala) return;
  escala = nueva;
  if (pdfActual) construir();
}

document.getElementById("mas").addEventListener("click", () => cambiarZoom(0.2));
document.getElementById("menos").addEventListener("click", () => cambiarZoom(-0.2));
document.getElementById("imprimir").addEventListener("click", imprimir);
window.addEventListener("beforeprint", () => {
  renderizarTodas().catch(() => {});
});

iniciar();
