// Content script: traduce la selección de texto y, con Control + arrastre,
// el recuadro marcado (enlaces no seleccionables o texto dentro de una imagen).

(() => {
  let burbujaActual = null;
  let solicitud = 0;
  let ignorarSeleccion = false;
  let ctrlPulsado = false;
  let suprimirClick = false;
  let gesto = null;

  document.addEventListener("mouseup", onSeleccion, true);
  document.addEventListener("dblclick", onSeleccion, true);

  document.addEventListener(
    "mousedown",
    (evento) => {
      if (burbujaActual && !burbujaActual.contains(evento.target)) {
        cerrarBurbuja();
      }
    },
    true
  );

  document.addEventListener("keydown", onTeclaAbajo, true);
  document.addEventListener("keyup", onTeclaArriba, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);
  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("blur", cancelarGesto);

  function onSeleccion(evento) {
    if (evento.ctrlKey || gesto) return;
    if (evento.target.closest && evento.target.closest(".avoc-burbuja, .avoc-capa")) return;
    setTimeout(procesarSeleccion, 10);
  }

  function procesarSeleccion() {
    if (ignorarSeleccion) return;

    const seleccion = window.getSelection();
    if (!seleccion || seleccion.isCollapsed) return;

    const texto = seleccion.toString().trim();
    if (!texto || texto.length > 200) return;

    const contexto = obtenerContexto(seleccion, texto);
    const rect = obtenerRect(seleccion);
    if (!rect) return;

    const id = ++solicitud;
    pedirTraduccion(rect, texto, id, contexto);
  }

  function onTeclaAbajo(evento) {
    if (evento.key === "Escape" && gesto) {
      evento.preventDefault();
      cancelarGesto();
      return;
    }
    if (evento.key !== "Control" || evento.repeat) return;
    ctrlPulsado = true;
    actualizarCursor();
  }

  function onTeclaArriba(evento) {
    if (evento.key !== "Control") return;
    ctrlPulsado = false;
    actualizarCursor();
  }

  function onPointerDown(evento) {
    if (!evento.ctrlKey || evento.button !== 0) return;
    if (evento.pointerType && evento.pointerType !== "mouse") return;
    if (evento.target.closest && evento.target.closest(".avoc-burbuja")) return;

    gesto = {
      pointerId: evento.pointerId,
      x: evento.clientX,
      y: evento.clientY,
      ux: evento.clientX,
      uy: evento.clientY,
      recortando: false,
    };
  }

  function onPointerMove(evento) {
    if (!gesto || evento.pointerId !== gesto.pointerId) return;

    if (!evento.ctrlKey && !gesto.recortando) {
      gesto = null;
      actualizarCursor();
      return;
    }

    gesto.ux = evento.clientX;
    gesto.uy = evento.clientY;
    const distancia = Math.hypot(gesto.ux - gesto.x, gesto.uy - gesto.y);

    if (!gesto.recortando) {
      if (distancia < 6) return;
      gesto.recortando = true;
      document.documentElement.classList.add("avoc-arrastrando");
      const seleccion = window.getSelection();
      if (seleccion) seleccion.removeAllRanges();
      if (evento.target.setPointerCapture) {
        try {
          evento.target.setPointerCapture(evento.pointerId);
        } catch (error) {
          // El elemento puede no aceptar la captura; el arrastre sigue en document.
        }
      }
    }

    evento.preventDefault();
    evento.stopPropagation();
    pintarRecorte(gesto.x, gesto.y, gesto.ux, gesto.uy);
  }

  function onPointerUp(evento) {
    if (!gesto || (evento.pointerId !== undefined && evento.pointerId !== gesto.pointerId)) {
      return;
    }
    if (evento.type === "pointerup") {
      gesto.ux = evento.clientX;
      gesto.uy = evento.clientY;
    }
    const actual = gesto;
    gesto = null;
    document.documentElement.classList.remove("avoc-arrastrando");
    quitarCapa();
    actualizarCursor();

    if (!actual.recortando) return;

    suprimirClick = true;
    setTimeout(() => {
      suprimirClick = false;
    }, 500);
    evento.preventDefault();
    evento.stopPropagation();

    const rect = rectDesdePuntos(actual.x, actual.y, actual.ux, actual.uy);
    if (rect.width < 8 || rect.height < 8) return;
    procesarRecuadro(rect);
  }

  function onDragStart(evento) {
    if (!ctrlPulsado && !gesto) return;
    evento.preventDefault();
    evento.stopPropagation();
  }

  function onClick(evento) {
    if (!suprimirClick) return;
    suprimirClick = false;
    evento.preventDefault();
    evento.stopPropagation();
  }

  function cancelarGesto() {
    ctrlPulsado = false;
    gesto = null;
    quitarCapa();
    document.documentElement.classList.remove("avoc-arrastrando");
    actualizarCursor();
  }

  function actualizarCursor() {
    document.documentElement.classList.toggle(
      "avoc-modo-recorte",
      ctrlPulsado || !!(gesto && gesto.recortando)
    );
  }

  function pintarRecorte(x0, y0, x1, y1) {
    const rect = rectDesdePuntos(x0, y0, x1, y1);
    let capa = document.querySelector(".avoc-capa");
    if (!capa) {
      capa = document.createElement("div");
      capa.className = "avoc-capa";
      capa.setAttribute("aria-hidden", "true");
      const marco = document.createElement("div");
      marco.className = "avoc-rect";
      capa.appendChild(marco);
      document.documentElement.appendChild(capa);
    }
    const marco = capa.querySelector(".avoc-rect");
    marco.style.left = rect.left + "px";
    marco.style.top = rect.top + "px";
    marco.style.width = rect.width + "px";
    marco.style.height = rect.height + "px";
  }

  function quitarCapa() {
    const capa = document.querySelector(".avoc-capa");
    if (capa && capa.parentNode) capa.parentNode.removeChild(capa);
  }

  function rectDesdePuntos(x0, y0, x1, y1) {
    const left = Math.max(0, Math.min(x0, x1));
    const top = Math.max(0, Math.min(y0, y1));
    const right = Math.min(window.innerWidth, Math.max(x0, x1));
    const bottom = Math.min(window.innerHeight, Math.max(y0, y1));
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  async function procesarRecuadro(rect) {
    const id = ++solicitud;
    ignorarSeleccion = true;
    setTimeout(() => {
      ignorarSeleccion = false;
    }, 80);

    const seleccion = window.getSelection();
    if (seleccion) seleccion.removeAllRanges();

    let textoDom = "";
    let preferirImagen = false;
    try {
      const analisis = analizarRecuadro(rect);
      textoDom = limitarTexto(analisis.texto);
      // El recuadro cubre una imagen y casi no hay texto accesible: leer la imagen.
      preferirImagen =
        analisis.coberturaImagen >= 0.5 && analisis.coberturaTexto < 0.12;
    } catch (error) {
      textoDom = "";
    }

    if (textoDom && !preferirImagen) {
      pedirTraduccion(rect, textoDom, id);
      return;
    }

    mostrarBurbuja(rect, "Leyendo el recuadro…");
    await esperarPintado();
    if (id !== solicitud) return;

    chrome.runtime.sendMessage(
      {
        tipo: "reconocer",
        rect: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      },
      (respuesta) => {
        if (id !== solicitud) return;
        if (chrome.runtime.lastError) {
          if (textoDom) {
            pedirTraduccion(rect, textoDom, id);
            return;
          }
          actualizarBurbuja("No se pudo leer el texto: " + chrome.runtime.lastError.message);
          return;
        }
        if (!respuesta || !respuesta.ok || !respuesta.texto) {
          if (textoDom) {
            pedirTraduccion(rect, textoDom, id);
            return;
          }
          actualizarBurbuja(
            (respuesta && respuesta.error) || "No se encontró texto en el recuadro"
          );
          return;
        }
        pedirTraduccion(rect, limitarTexto(respuesta.texto), id);
      }
    );
  }

  function esperarPintado() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  function pedirTraduccion(rect, texto, id, contexto) {
    if (id !== solicitud) return;
    mostrarBurbuja(rect, "Traduciendo…");
    actualizarBurbuja("Traduciendo…", texto);

    chrome.runtime.sendMessage(
      {
        tipo: "traducir",
        texto,
        contexto: contexto || texto,
        url: location.href,
      },
      (respuesta) => {
        if (id !== solicitud) return;
        if (chrome.runtime.lastError) {
          actualizarBurbuja("Error: " + chrome.runtime.lastError.message, texto);
          return;
        }
        if (respuesta && respuesta.ok) {
          actualizarBurbuja(respuesta.traduccion, texto);
        } else {
          actualizarBurbuja(
            "No se pudo traducir" +
              (respuesta && respuesta.error ? ": " + respuesta.error : ""),
            texto
          );
        }
      }
    );
  }

  function limitarTexto(texto) {
    const limpio = String(texto || "").replace(/\s+/g, " ").trim();
    if (limpio.length <= 500) return limpio;
    return limpio.slice(0, 500).trim();
  }

  // Texto real de la página dentro del recuadro, aunque no se pueda seleccionar
  // (user-select: none, enlaces que el sitio bloquea, etc.).
  function analizarRecuadro(sel) {
    if (!document.body) {
      return { texto: "", coberturaTexto: 0, coberturaImagen: 0 };
    }
    const palabras = [];
    const vistos = new Set();
    const visibilidad = new WeakMap();

    porCadaRaiz(document.body, (raiz) => {
      const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
      let nodo;
      while ((nodo = walker.nextNode())) {
        if (!nodo.nodeValue || !/\S/.test(nodo.nodeValue)) continue;
        const padre = nodo.parentElement;
        if (!padre) continue;
        if (padre.closest("script, style, noscript, .avoc-capa, .avoc-burbuja")) continue;
        const caja = padre.getBoundingClientRect();
        if (!intersecta(caja, sel) || caja.width < 1 || caja.height < 1) continue;
        if (!elementoVisible(padre, visibilidad)) continue;
        medirPalabras(nodo, sel, palabras, vistos);
      }
    });

    const unidos = unirPalabras(palabras) || textoDeCampos(sel);
    const superficie = Math.max(1, sel.width * sel.height);
    let tinta = 0;
    for (const palabra of palabras) {
      tinta += (palabra.width || 0) * (palabra.height || 0);
    }
    return {
      texto: unidos,
      coberturaTexto: tinta / superficie,
      coberturaImagen: coberturaDeImagen(sel),
    };
  }

  function coberturaDeImagen(sel) {
    const superficie = Math.max(1, sel.width * sel.height);
    const vistos = new Set();
    let mejor = 0;
    const pasos = 3;
    for (let iy = 0; iy <= pasos; iy++) {
      for (let ix = 0; ix <= pasos; ix++) {
        const x = sel.left + (sel.width * ix) / pasos;
        const y = sel.top + (sel.height * iy) / pasos;
        const pila = document.elementsFromPoint(x, y);
        for (const elemento of pila) {
          if (vistos.has(elemento)) continue;
          vistos.add(elemento);
          if (elemento.closest && elemento.closest(".avoc-capa, .avoc-burbuja")) continue;
          const etiqueta = (elemento.tagName || "").toUpperCase();
          if (
            etiqueta !== "IMG" &&
            etiqueta !== "CANVAS" &&
            etiqueta !== "VIDEO" &&
            etiqueta !== "PICTURE"
          ) {
            continue;
          }
          const cobertura = areaInterseccion(elemento.getBoundingClientRect(), sel) / superficie;
          if (cobertura > mejor) mejor = cobertura;
        }
      }
    }
    return mejor;
  }

  function areaInterseccion(a, b) {
    const ancho = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const alto = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ancho <= 0 || alto <= 0) return 0;
    return ancho * alto;
  }

  function porCadaRaiz(raiz, fn) {
    fn(raiz);
    if (!raiz.querySelectorAll) return;
    const elementos = raiz.querySelectorAll("*");
    for (const elemento of elementos) {
      if (elemento.shadowRoot) porCadaRaiz(elemento.shadowRoot, fn);
    }
  }

  function elementoVisible(elemento, visibilidad) {
    if (visibilidad.has(elemento)) return visibilidad.get(elemento);
    const estilo = getComputedStyle(elemento);
    const visible =
      estilo.display !== "none" &&
      estilo.visibility !== "hidden" &&
      estilo.opacity !== "0";
    visibilidad.set(elemento, visible);
    return visible;
  }

  function medirPalabras(nodo, sel, palabras, vistos) {
    const rango = document.createRange();
    try {
      rango.selectNodeContents(nodo);
      const cajas = rango.getClientRects();
      let toca = false;
      for (const caja of cajas) {
        if (caja.width > 0 && caja.height > 0 && intersecta(caja, sel)) {
          toca = true;
          break;
        }
      }
      if (!toca) return;

      const texto = nodo.nodeValue;
      const expresion = /\S+/g;
      let coincidencia;
      while ((coincidencia = expresion.exec(texto))) {
        rango.setStart(nodo, coincidencia.index);
        rango.setEnd(nodo, coincidencia.index + coincidencia[0].length);
        const rects = rango.getClientRects();
        for (const rect of rects) {
          if (rect.width < 0.5 || rect.height < 0.5) continue;
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          if (cx < sel.left || cx > sel.right || cy < sel.top || cy > sel.bottom) continue;
          const clave =
            coincidencia[0] + "@" + Math.round(rect.left) + "," + Math.round(rect.top);
          if (vistos.has(clave)) break;
          vistos.add(clave);
          palabras.push({
            text: coincidencia[0],
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          });
          break;
        }
      }
    } catch (error) {
      // Un nodo desconectado no se puede medir.
    } finally {
      rango.detach();
    }
  }

  function unirPalabras(palabras) {
    if (!palabras.length) return "";
    const ordenadas = palabras.slice().sort((a, b) => a.top - b.top || a.left - b.left);
    const lineas = [];
    for (const palabra of ordenadas) {
      const umbral = Math.max(8, (palabra.height || 12) * 0.7);
      const linea = lineas.find((item) => Math.abs(item.top - palabra.top) <= umbral);
      if (linea) {
        linea.items.push(palabra);
        linea.top =
          (linea.top * (linea.items.length - 1) + palabra.top) / linea.items.length;
      } else {
        lineas.push({ top: palabra.top, items: [palabra] });
      }
    }
    return lineas
      .map((linea) =>
        linea.items
          .sort((a, b) => a.left - b.left)
          .map((item) => item.text)
          .join(" ")
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function textoDeCampos(sel) {
    const tiposExcluidos = {
      password: true,
      hidden: true,
      file: true,
      checkbox: true,
      radio: true,
      submit: true,
      button: true,
      image: true,
      range: true,
      color: true,
    };
    const puntos = [
      [sel.left + sel.width / 2, sel.top + sel.height / 2],
      [sel.left + 4, sel.top + 4],
      [sel.right - 4, sel.bottom - 4],
    ];
    const vistos = new Set();
    const partes = [];

    for (const [x, y] of puntos) {
      const pila = document.elementsFromPoint(x, y);
      for (const elemento of pila) {
        if (vistos.has(elemento)) continue;
        vistos.add(elemento);
        if (elemento.closest && elemento.closest(".avoc-capa, .avoc-burbuja")) continue;
        const etiqueta = elemento.tagName;
        if (etiqueta !== "INPUT" && etiqueta !== "TEXTAREA") continue;
        if (tiposExcluidos[(elemento.type || "").toLowerCase()]) continue;
        const valor = (elemento.value || "").trim();
        if (!valor) continue;
        if (!intersecta(elemento.getBoundingClientRect(), sel)) continue;
        partes.push(valor);
      }
    }
    return partes.join(" ");
  }

  function intersecta(a, b) {
    return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
  }

  function obtenerContexto(seleccion, texto) {
    try {
      const nodo = seleccion.anchorNode;
      const contenedor =
        nodo && nodo.nodeType === Node.TEXT_NODE ? nodo.parentElement : nodo;
      const textoCompleto = (contenedor && contenedor.textContent) || texto;
      const normalizado = textoCompleto.replace(/\s+/g, " ").trim();

      const idx = normalizado.toLowerCase().indexOf(texto.toLowerCase());
      if (idx === -1) return normalizado.slice(0, 300);

      const inicio = buscarInicioOracion(normalizado, idx);
      const fin = buscarFinOracion(normalizado, idx + texto.length);
      return normalizado.slice(inicio, fin).trim();
    } catch (error) {
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
    cerrar.type = "button";
    cerrar.textContent = "×";
    cerrar.title = "Cerrar";
    cerrar.addEventListener("click", cerrarBurbuja);

    burbuja.appendChild(cerrar);
    burbuja.appendChild(contenido);
    (document.body || document.documentElement).appendChild(burbuja);

    const top = window.scrollY + rect.bottom + 8;
    const left = Math.max(8, window.scrollX + rect.left);
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
