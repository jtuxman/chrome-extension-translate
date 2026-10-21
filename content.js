// Content script: captura la selección y su contexto, pide la traducción
// al service worker y muestra una burbuja flotante con el resultado.

(() => {
  let burbujaActual = null;

  document.addEventListener("mouseup", onSeleccion, true);
  document.addEventListener("dblclick", onSeleccion, true);

  // Cerrar la burbuja al hacer clic fuera de ella.
  document.addEventListener(
    "mousedown",
    (e) => {
      if (burbujaActual && !burbujaActual.contains(e.target)) {
        cerrarBurbuja();
      }
    },
    true
  );

  function onSeleccion() {
    // Pequeño retraso para que la selección esté estabilizada.
    setTimeout(procesarSeleccion, 10);
  }

  function procesarSeleccion() {
    const seleccion = window.getSelection();
    if (!seleccion || seleccion.isCollapsed) return;

    const texto = seleccion.toString().trim();
    if (!texto || texto.length > 200) return;

    const contexto = obtenerContexto(seleccion, texto);
    const rect = obtenerRect(seleccion);
    if (!rect) return;

    mostrarBurbuja(rect, "Traduciendo…");

    chrome.runtime.sendMessage(
      { tipo: "traducir", texto, contexto, url: location.href },
      (respuesta) => {
        if (chrome.runtime.lastError) {
          actualizarBurbuja("Error: " + chrome.runtime.lastError.message);
          return;
        }
        if (respuesta && respuesta.ok) {
          actualizarBurbuja(respuesta.traduccion, texto);
        } else {
          actualizarBurbuja(
            "No se pudo traducir" +
              (respuesta && respuesta.error ? ": " + respuesta.error : "")
          );
        }
      }
    );
  }

  // Deriva la oración donde aparece la selección a partir del texto del
  // contenedor, para dar contexto de aprendizaje.
  function obtenerContexto(seleccion, texto) {
    try {
      const nodo = seleccion.anchorNode;
      const contenedor =
        nodo && nodo.nodeType === Node.TEXT_NODE ? nodo.parentElement : nodo;
      const textoCompleto = (contenedor && contenedor.textContent) || texto;
      const normalizado = textoCompleto.replace(/\s+/g, " ").trim();

      const idx = normalizado.toLowerCase().indexOf(texto.toLowerCase());
      if (idx === -1) return normalizado.slice(0, 300);

      // Buscar límites de oración alrededor de la palabra.
      const inicio = buscarInicioOracion(normalizado, idx);
      const fin = buscarFinOracion(normalizado, idx + texto.length);
      return normalizado.slice(inicio, fin).trim();
    } catch (e) {
      return texto;
    }
  }

  function buscarInicioOracion(texto, idx) {
    for (let i = idx; i > 0; i--) {
      if (/[.!?]/.test(texto[i - 1]) && /\s/.test(texto[i])) return i;
    }
    return 0;
  }

  function buscarFinOracion(texto, idx) {
    for (let i = idx; i < texto.length; i++) {
      if (/[.!?]/.test(texto[i])) return i + 1;
    }
    return texto.length;
  }

  function obtenerRect(seleccion) {
    const rango = seleccion.getRangeAt(0);
    const rects = rango.getClientRects();
    if (rects.length > 0) return rects[rects.length - 1];
    return rango.getBoundingClientRect();
  }

  function mostrarBurbuja(rect, textoInicial) {
    cerrarBurbuja();

    const burbuja = document.createElement("div");
    burbuja.className = "avoc-burbuja";

    const contenido = document.createElement("div");
    contenido.className = "avoc-contenido";
    contenido.textContent = textoInicial;

    const cerrar = document.createElement("button");
    cerrar.className = "avoc-cerrar";
    cerrar.textContent = "×";
    cerrar.title = "Cerrar";
    cerrar.addEventListener("click", cerrarBurbuja);

    burbuja.appendChild(cerrar);
    burbuja.appendChild(contenido);
    document.body.appendChild(burbuja);

    const top = window.scrollY + rect.bottom + 8;
    const left = window.scrollX + rect.left;
    burbuja.style.top = top + "px";
    burbuja.style.left = left + "px";

    burbujaActual = burbuja;
  }

  function actualizarBurbuja(traduccion, palabra) {
    if (!burbujaActual) return;
    const contenido = burbujaActual.querySelector(".avoc-contenido");
    if (!contenido) return;
    contenido.textContent = "";

    if (palabra) {
      const original = document.createElement("div");
      original.className = "avoc-original";
      original.textContent = palabra;
      contenido.appendChild(original);
    }

    const trad = document.createElement("div");
    trad.className = "avoc-traduccion";
    trad.textContent = traduccion;
    contenido.appendChild(trad);
  }

  function cerrarBurbuja() {
    if (burbujaActual && burbujaActual.parentNode) {
      burbujaActual.parentNode.removeChild(burbujaActual);
    }
    burbujaActual = null;
  }
})();
