// Content script: traduce la selección de texto y, con Control + arrastre,
// el recuadro marcado (enlaces no seleccionables o texto dentro de una imagen).

(() => {
  let burbujaActual = null;
  let solicitud = 0;
  let ignorarSeleccion = false;
  let ctrlPulsado = false;
  let suprimirClick = false;
  let gesto = null;
  const enMarco = window.top !== window;
  let marcoConBurbuja = null;
  let deshacerActual = null; // cómo quitar del diccionario la traducción visible
  let descartarPendiente = 0; // id de la solicitud que se cerró con Escape
  let ultimaSeleccion = { texto: "", momento: 0 };

  // En window y en captura, para adelantarse a reproductores que detienen los
  // eventos antes de que lleguen a document.
  window.addEventListener("mouseup", onSeleccion, true);
  window.addEventListener("dblclick", onSeleccion, true);

  window.addEventListener(
    "mousedown",
    (evento) => {
      if (burbujaActual && !burbujaActual.contains(evento.target)) {
        cerrarBurbuja();
      }
    },
    true
  );

  window.addEventListener("keydown", onTeclaAbajo, true);
  window.addEventListener("keyup", onTeclaArriba, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("dragstart", onDragStart, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("blur", cancelarGesto);
  window.addEventListener("message", onPosicionPedida);
  window.addEventListener("message", onAvisoBurbuja);

  function onSeleccion(evento) {
    if (evento.ctrlKey || gesto) return;
    if (!evento.target || !evento.target.closest) return;
    if (evento.target.closest(".avoc-burbuja, .avoc-capa")) return;
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

    // Un doble clic dispara mouseup y dblclick: la misma palabra no se traduce
    // (ni se cuenta) dos veces.
    const ahora = Date.now();
    if (burbujaActual && texto === ultimaSeleccion.texto && ahora - ultimaSeleccion.momento < 1500) {
      return;
    }
    ultimaSeleccion = { texto, momento: ahora };

    const id = ++solicitud;
    pedirTraduccion(rect, texto, id, contexto);
  }

  function onTeclaAbajo(evento) {
    if (evento.key === "Escape" && gesto) {
      evento.preventDefault();
      cancelarGesto();
      return;
    }
    if (evento.key === "Control") {
      if (evento.repeat) return;
      ctrlPulsado = true;
      actualizarCursor();
      return;
    }
    cerrarConTecla(evento);
  }

  // Cualquier tecla cierra la traducción, salvo modificadores y atajos con
  // Control/Cmd (Ctrl+C, recorte). Escape además la quita del diccionario.
  // Sin un campo de texto enfocado, la tecla no llega a la página: así Espacio
  // no pausa el video al cerrar.
  function cerrarConTecla(evento) {
    if (gesto || evento.ctrlKey || evento.metaKey) return;
    if (["Shift", "Alt", "AltGraph", "Meta", "CapsLock", "Dead"].includes(evento.key)) return;
    const descartar = evento.key === "Escape";

    if (!burbujaActual) {
      if (!enMarco && marcoConBurbuja) {
        try {
          marcoConBurbuja.postMessage({ avoc: "cerrar-burbuja", descartar }, "*");
        } catch (error) {
          // El marco ya no existe.
        }
        marcoConBurbuja = null;
      }
      return;
    }

    cerrarPorTecla(descartar);
    if (!enEdicion(evento.target)) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
    }
  }

  function cerrarPorTecla(descartar) {
    if (descartar) {
      if (deshacerActual) {
        chrome.runtime.sendMessage({ tipo: "descartar", deshacer: deshacerActual }, () => {
          void chrome.runtime.lastError;
        });
        deshacerActual = null;
      } else {
        // La traducción todavía no llega: se descarta en cuanto se guarde.
        descartarPendiente = solicitud;
      }
    }
    ++solicitud;
    cerrarBurbuja();
  }

  function enEdicion(elemento) {
    if (!elemento || !elemento.closest) return false;
    return !!elemento.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
  }

  // La traducción vive en el marco donde se pidió, pero el foco del teclado
  // puede seguir en la página principal: ésta le reenvía el cierre.
  function onAvisoBurbuja(evento) {
    const datos = evento.data;
    if (!datos || typeof datos.avoc !== "string") return;
    if (!enMarco && datos.avoc === "burbuja-abierta") {
      marcoConBurbuja = evento.source;
    } else if (!enMarco && datos.avoc === "burbuja-cerrada") {
      if (marcoConBurbuja === evento.source) marcoConBurbuja = null;
    } else if (enMarco && datos.avoc === "cerrar-burbuja" && evento.source === window.top) {
      cerrarPorTecla(!!datos.descartar);
    }
  }

  function avisarAlPrincipal(tipo) {
    if (!enMarco) return;
    try {
      window.top.postMessage({ avoc: tipo }, "*");
    } catch (error) {
      // Sin acceso a la página principal.
    }
  }

  function onTeclaArriba(evento) {
    if (evento.key !== "Control") return;
    ctrlPulsado = false;
    actualizarCursor();
  }

  function onPointerDown(evento) {
    if (!evento.ctrlKey || evento.button !== 0) return;
    if (evento.pointerType && evento.pointerType !== "mouse") return;
    if (evento.target && evento.target.closest && evento.target.closest(".avoc-burbuja")) {
      return;
    }

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
      raizCapas().appendChild(capa);
    }
    const marco = capa.querySelector(".avoc-rect");
    marco.style.left = rect.left + "px";
    marco.style.top = rect.top + "px";
    marco.style.width = rect.width + "px";
    marco.style.height = rect.height + "px";
  }

  // En pantalla completa solo se ve lo que está dentro del elemento ampliado.
  function raizCapas() {
    const ampliado = document.fullscreenElement;
    if (ampliado && ampliado.tagName !== "VIDEO") return ampliado;
    return document.documentElement;
  }

  // Posición de este marco dentro de la pestaña: la captura de pantalla es de la
  // pestaña entera y cada iframe sólo conoce sus propias coordenadas.
  function posicionEnPestana() {
    if (!enMarco) {
      return Promise.resolve({
        x: 0,
        y: 0,
        ancho: window.innerWidth,
        alto: window.innerHeight,
      });
    }
    return new Promise((resolve) => {
      const id = "avoc-" + Math.random().toString(36).slice(2);
      const limite = setTimeout(() => terminar(null), 1500);
      function oir(evento) {
        const datos = evento.data;
        if (evento.source !== window.parent) return;
        if (!datos || datos.avoc !== "posicion" || datos.id !== id) return;
        terminar(datos.posicion);
      }
      function terminar(posicion) {
        clearTimeout(limite);
        window.removeEventListener("message", oir);
        resolve(posicion);
      }
      window.addEventListener("message", oir);
      window.parent.postMessage({ avoc: "posicion?", id }, "*");
    });
  }

  async function onPosicionPedida(evento) {
    const datos = evento.data;
    if (!datos || datos.avoc !== "posicion?" || !evento.source) return;
    const iframe = buscarIframe(evento.source);
    if (!iframe) return;

    const caja = iframe.getBoundingClientRect();
    const estilo = getComputedStyle(iframe);
    const dx = caja.left + iframe.clientLeft + (parseFloat(estilo.paddingLeft) || 0);
    const dy = caja.top + iframe.clientTop + (parseFloat(estilo.paddingTop) || 0);
    const propia = await posicionEnPestana();
    if (!propia) return;
    evento.source.postMessage(
      {
        avoc: "posicion",
        id: datos.id,
        posicion: {
          x: propia.x + dx,
          y: propia.y + dy,
          ancho: propia.ancho,
          alto: propia.alto,
        },
      },
      "*"
    );
  }

  function buscarIframe(ventana) {
    let encontrado = null;
    porCadaRaiz(document, (raiz) => {
      if (encontrado || !raiz.querySelectorAll) return;
      for (const iframe of raiz.querySelectorAll("iframe, frame")) {
        if (iframe.contentWindow === ventana) {
          encontrado = iframe;
          return;
        }
      }
    });
    return encontrado;
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
    const posicion = await posicionEnPestana();
    await esperarPintado();
    if (id !== solicitud) return;
    if (!posicion) {
      if (textoDom) {
        pedirTraduccion(rect, textoDom, id);
        return;
      }
      actualizarBurbuja("No se pudo ubicar este recuadro en la pantalla");
      return;
    }

    chrome.runtime.sendMessage(
      {
        tipo: "reconocer",
        rect: {
          x: rect.left + posicion.x,
          y: rect.top + posicion.y,
          width: rect.width,
          height: rect.height,
        },
        viewport: {
          width: posicion.ancho,
          height: posicion.alto,
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
        const error = chrome.runtime.lastError;
        if (!error && respuesta && respuesta.ok && respuesta.deshacer && descartarPendiente === id) {
          descartarPendiente = 0;
          chrome.runtime.sendMessage({ tipo: "descartar", deshacer: respuesta.deshacer }, () => {
            void chrome.runtime.lastError;
          });
          return;
        }
        if (id !== solicitud) return;
        if (error) {
          actualizarBurbuja("Error: " + error.message, texto);
          return;
        }
        if (respuesta && respuesta.ok) {
          deshacerActual = respuesta.deshacer || null;
          actualizarBurbuja(respuesta.traduccion, texto, respuesta.detalle, respuesta.detallePendiente);
          const aCopiar = respuesta.textoCopiar || respuesta.traduccion;
          copiarAlPortapapeles(aCopiar).then((copiado) => {
            if (copiado && id === solicitud) marcarCopiado(respuesta.esEspanol);
          });
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

    const raiz = raizCapas();
    if (raiz !== document.documentElement) {
      burbuja.style.position = "fixed";
      burbuja.style.top = Math.min(rect.bottom + 8, window.innerHeight - 80) + "px";
      burbuja.style.left = Math.max(8, rect.left) + "px";
      raiz.appendChild(burbuja);
    } else {
      (document.body || document.documentElement).appendChild(burbuja);
      burbuja.style.top = window.scrollY + rect.bottom + 8 + "px";
      burbuja.style.left = Math.max(8, window.scrollX + rect.left) + "px";
    }

    burbujaActual = burbuja;
    avisarAlPrincipal("burbuja-abierta");
  }

  function actualizarBurbuja(traduccion, palabra, detalle, pendiente) {
    if (!burbujaActual) return;
    const contenido = burbujaActual.querySelector(".avoc-contenido");
    if (!contenido) return;
    contenido.textContent = "";
    burbujaActual.dataset.palabra = palabra || "";

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
    pintarDetalle(detalle, pendiente);
    pintarEnlaces(palabra);
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

  function pintarEnlaces(palabra) {
    if (!burbujaActual) return;
    const contenido = burbujaActual.querySelector(".avoc-contenido");
    if (!contenido) return;
    const previo = contenido.querySelector(".avoc-mas");
    if (previo) previo.remove();
    const ligas = enlacesEjemplo(palabra);
    if (!ligas.length) return;

    const fila = document.createElement("div");
    fila.className = "avoc-mas";
    for (const [nombre, href] of ligas) {
      const liga = document.createElement("a");
      liga.href = href;
      liga.target = "_blank";
      liga.rel = "noreferrer";
      liga.textContent = nombre;
      fila.appendChild(liga);
    }
    const aviso = contenido.querySelector(".avoc-copiado");
    contenido.insertBefore(fila, aviso);
  }

  function expresionCorta(texto) {
    const limpio = String(texto || "").trim();
    return limpio.length > 0 && limpio.length <= 40 && limpio.split(/\s+/).length <= 4 && !/[.!?]/.test(limpio);
  }

  function pintarDetalle(detalle, pendiente) {
    if (!burbujaActual) return;
    const contenido = burbujaActual.querySelector(".avoc-contenido");
    if (!contenido) return;
    const previo = contenido.querySelector(".avoc-detalle");
    if (previo) previo.remove();

    const acepciones = (detalle && detalle.acepciones) || [];
    const ejemplos = (detalle && detalle.ejemplos) || [];
    const corta = expresionCorta(burbujaActual.dataset.palabra || "");
    const respondida = pendiente === true || pendiente === false;
    if (!acepciones.length && !ejemplos.length && !respondida) return;
    if (!acepciones.length && !ejemplos.length && !pendiente && !corta) return;

    const bloque = document.createElement("div");
    bloque.className = "avoc-detalle";

    if (!acepciones.length && !ejemplos.length) {
      const espera = document.createElement("p");
      espera.className = "avoc-espera";
      espera.textContent = pendiente
        ? "Buscando acepciones y frases…"
        : "No hay frases de ejemplo para esta expresión.";
      bloque.appendChild(espera);
    }

    if (acepciones.length) {
      const titulo = document.createElement("p");
      titulo.className = "avoc-detalle-titulo";
      titulo.textContent = "Otras acepciones";
      bloque.appendChild(titulo);
      for (const acepcion of acepciones) {
        const linea = document.createElement("p");
        linea.className = "avoc-acepcion";
        linea.textContent = (acepcion.tipo ? acepcion.tipo + ": " : "") + acepcion.es;
        bloque.appendChild(linea);
      }
    }

    if (ejemplos.length) {
      const lista = document.createElement("details");
      lista.className = "avoc-frases";
      const resumen = document.createElement("summary");
      resumen.textContent = ejemplos.length + (ejemplos.length === 1 ? " frase de ejemplo" : " frases de ejemplo");
      lista.appendChild(resumen);
      for (const ejemplo of ejemplos) {
        const frase = document.createElement("p");
        frase.className = "avoc-frase";
        const en = document.createElement("span");
        en.className = "avoc-frase-en";
        en.textContent = ejemplo.en;
        const es = document.createElement("span");
        es.textContent = ejemplo.es;
        frase.appendChild(en);
        frase.appendChild(es);
        lista.appendChild(frase);
      }
      bloque.appendChild(lista);
    }

    const aviso = contenido.querySelector(".avoc-copiado");
    const mas = contenido.querySelector(".avoc-mas");
    contenido.insertBefore(bloque, mas || aviso);
  }

  chrome.storage.onChanged.addListener((cambios, area) => {
    if (area !== "local" || !cambios.vocabulario || !burbujaActual) return;
    const clave = (burbujaActual.dataset.palabra || "").toLowerCase();
    const item = ((cambios.vocabulario.newValue || {})[clave]);
    if (!item) return;
    pintarDetalle({ acepciones: item.acepciones || [], ejemplos: item.ejemplos || [] }, false);
  });

  function marcarCopiado(soloTexto) {
    if (!burbujaActual) return;
    const contenido = burbujaActual.querySelector(".avoc-contenido");
    if (!contenido) return;
    let aviso = contenido.querySelector(".avoc-copiado");
    if (!aviso) {
      aviso = document.createElement("div");
      aviso.className = "avoc-copiado";
      contenido.appendChild(aviso);
    }
    aviso.textContent = soloTexto
      ? "✓ Texto copiado al portapapeles"
      : "✓ Traducción y original copiados";
  }

  // Copia texto al portapapeles. Intenta la API moderna y, si no hay permiso o
  // activación del usuario (la copia ocurre tras la traducción), usa execCommand
  // con un textarea temporal (habilitado por el permiso "clipboardWrite").
  async function copiarAlPortapapeles(texto) {
    const valor = String(texto || "");
    if (!valor) return false;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(valor);
        return true;
      } catch (error) {
        // Sin activación o sin permiso: se usa el método de respaldo.
      }
    }
    return copiarConExecCommand(valor);
  }

  function copiarConExecCommand(valor) {
    const area = document.createElement("textarea");
    area.value = valor;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.left = "0";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    (document.body || document.documentElement).appendChild(area);

    let ok = false;
    try {
      const activo = document.activeElement;
      area.select();
      area.setSelectionRange(0, valor.length);
      ok = document.execCommand("copy");
      if (activo && typeof activo.focus === "function") activo.focus();
    } catch (error) {
      ok = false;
    } finally {
      if (area.parentNode) area.parentNode.removeChild(area);
    }
    return ok;
  }

  function cerrarBurbuja() {
    const habia = !!burbujaActual;
    deshacerActual = null;
    if (burbujaActual && burbujaActual.parentNode) {
      burbujaActual.parentNode.removeChild(burbujaActual);
    }
    burbujaActual = null;
    if (habia) avisarAlPrincipal("burbuja-cerrada");
  }
})();
