// Acepciones y frases de ejemplo. No bloquea la traducción: se pide después de
// guardar y se escribe en la misma ficha. Gemini si hay clave; si no, la IA de
// Chrome cuando ya está descargada; las frases que falten salen de Tatoeba
// (ejemplos reales ya traducidos) y las acepciones, del diccionario.

const DETALLE_OBJETIVO = 10;

const colaDetalle = [];
let enriqueciendo = false;

function sirveParaDetalle(texto) {
  const limpio = String(texto || "").replace(/\s+/g, " ").trim();
  if (!limpio || limpio.length > 40 || /[.!?]/.test(limpio)) return false;
  const partes = limpio.split(" ");
  return partes.length >= 1 && partes.length <= 4;
}

function programarEnriquecimiento(clave) {
  if (!clave || colaDetalle.includes(clave)) return;
  colaDetalle.push(clave);
  if (!enriqueciendo) procesarColaDetalle();
}

async function reponerColaDetalle() {
  const almacen = await chrome.storage.local.get("vocabulario");
  const vocabulario = almacen.vocabulario || {};
  for (const [clave, item] of Object.entries(vocabulario)) {
    if (necesitaDetalle(item)) programarEnriquecimiento(clave);
  }
}

function necesitaDetalle(item) {
  if (!item || !sirveParaDetalle(item.palabra)) return false;
  if ((item.ejemplos || []).length >= 1) return false;
  // Ya se buscó y no había frases: solo se repite si el usuario pulsa el botón.
  if (item.detalleEstado === "vacio") return false;
  const cuando = Date.parse(item.enriquecidoEn || "");
  if (item.detalleEstado === "error" && cuando && Date.now() - cuando < 2 * 60 * 1000) {
    return false;
  }
  return true;
}

async function reintentarDetalle(clave) {
  const almacen = await chrome.storage.local.get("vocabulario");
  const vocabulario = almacen.vocabulario || {};
  const item = vocabulario[clave];
  if (!item || !sirveParaDetalle(item.palabra)) return { ok: false };
  delete item.enriquecidoEn;
  delete item.detalleEstado;
  await chrome.storage.local.set({ vocabulario });
  programarEnriquecimiento(clave);
  return { ok: true };
}

async function procesarColaDetalle() {
  enriqueciendo = true;
  try {
    while (colaDetalle.length) {
      const clave = colaDetalle.shift();
      try {
        await enriquecerPalabra(clave);
      } catch (error) {
        console.warn("Detalle:", error);
      }
    }
  } finally {
    enriqueciendo = false;
    if (colaDetalle.length) procesarColaDetalle();
  }
}

async function enriquecerPalabra(clave) {
  const almacen = await chrome.storage.local.get("vocabulario");
  const item = (almacen.vocabulario || {})[clave];
  if (!item || !necesitaDetalle(item)) return;

  const config = await obtenerConfig();
  const detalle = await obtenerDetalle(item, config);
  await guardarDetalle(clave, detalle);
}

async function obtenerDetalle(item, config) {
  const detalle = { acepciones: [], ejemplos: [], fuentes: [], error: false };
  const claveGemini = config.gemini && config.gemini.apiKey;
  let fallos = 0;
  let consultas = 0;

  if (claveGemini) {
    consultas++;
    try {
      sumarDetalle(detalle, await pedirGemini(item, claveGemini), "gemini");
    } catch (error) {
      fallos++;
      console.warn("Gemini:", error);
    }
  } else {
    try {
      const nano = await pedirChromeIA(item);
      if (nano) {
        consultas++;
        sumarDetalle(detalle, nano, "chrome");
      }
    } catch (error) {
      consultas++;
      fallos++;
      console.warn("IA de Chrome:", error);
    }
  }

  if (detalle.ejemplos.length < DETALLE_OBJETIVO) {
    consultas++;
    try {
      const frases = await pedirTatoeba(item.palabra);
      if (frases.length) sumarDetalle(detalle, { ejemplos: frases }, "tatoeba");
    } catch (error) {
      fallos++;
      console.warn("Tatoeba:", error);
    }
  }

  if (detalle.acepciones.length < 2) {
    consultas++;
    try {
      const acepciones = await pedirDiccionario(item, config);
      if (acepciones.length) sumarDetalle(detalle, { acepciones }, "diccionario");
    } catch (error) {
      fallos++;
      console.warn("Diccionario:", error);
    }
  }
  detalle.error = !detalle.ejemplos.length && consultas > 0 && fallos === consultas;

  detalle.acepciones = detalle.acepciones.slice(0, 3);
  detalle.ejemplos = detalle.ejemplos.slice(0, DETALLE_OBJETIVO);
  return detalle;
}

function sumarDetalle(destino, nuevo, fuente) {
  destino.acepciones = unirAcepciones(destino.acepciones, nuevo.acepciones || []);
  destino.ejemplos = unirEjemplos(destino.ejemplos, nuevo.ejemplos || []);
  if ((nuevo.acepciones || []).length || (nuevo.ejemplos || []).length) {
    if (!destino.fuentes.includes(fuente)) destino.fuentes.push(fuente);
  }
}

async function guardarDetalle(clave, detalle) {
  const almacen = await chrome.storage.local.get("vocabulario");
  const vocabulario = almacen.vocabulario || {};
  const item = vocabulario[clave];
  if (!item) return;
  if (detalle.acepciones.length) item.acepciones = detalle.acepciones;
  if (detalle.ejemplos.length) item.ejemplos = detalle.ejemplos;
  item.detalleFuente = detalle.fuentes.join("+") || "ninguna";
  item.detalleEstado = detalle.ejemplos.length ? "ok" : detalle.error ? "error" : "vacio";
  item.enriquecidoEn = new Date().toISOString();
  await chrome.storage.local.set({ vocabulario });
}

function terminoDe(palabra) {
  return String(palabra || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(to|a|an|the)\s+/i, "");
}

function textoPlano(valor) {
  return String(valor || "").replace(/\s+/g, " ").trim();
}

function clavePlana(valor) {
  return textoPlano(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function unirAcepciones(actuales, nuevas) {
  const lista = actuales.slice();
  for (const cruda of nuevas) {
    const es = textoPlano(cruda && (cruda.es || cruda.definicion));
    if (!es) continue;
    const clave = clavePlana(es);
    if (lista.some((item) => clavePlana(item.es) === clave)) continue;
    lista.push({ tipo: textoPlano(cruda.tipo).slice(0, 24), es: es.slice(0, 180) });
    if (lista.length >= 3) break;
  }
  return lista;
}

function unirEjemplos(actuales, nuevos) {
  const lista = actuales.slice();
  for (const crudo of nuevos) {
    const en = textoPlano(crudo && (crudo.en || crudo.ingles));
    const es = textoPlano(crudo && (crudo.es || crudo.espanol));
    if (!en || !es) continue;
    const clave = clavePlana(en);
    if (lista.some((item) => clavePlana(item.en) === clave)) continue;
    lista.push({ en: en.slice(0, 220), es: es.slice(0, 220) });
    if (lista.length >= DETALLE_OBJETIVO) break;
  }
  return lista;
}

function interpretarDetalle(texto, palabra) {
  const limpio = String(texto || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) throw new Error("La respuesta no trae datos");
  const datos = JSON.parse(limpio.slice(inicio, fin + 1));
  const termino = clavePlana(terminoDe(palabra));
  const ejemplos = (datos.ejemplos || []).filter((ejemplo) => {
    const en = clavePlana(ejemplo && (ejemplo.en || ejemplo.ingles));
    return !termino || en.includes(termino);
  });
  return {
    acepciones: unirAcepciones([], datos.acepciones || []),
    ejemplos: unirEjemplos([], ejemplos),
  };
}

function promptDetalle(item) {
  return (
    "Eres profesor de inglés para hispanohablantes. Para la expresión inglesa «" +
    item.palabra +
    "» (traducción principal: «" +
    (item.traduccion || "") +
    "») responde solo JSON con esta forma:\n" +
    '{"acepciones":[{"tipo":"verbo","es":"acepción breve en español"}],' +
    '"ejemplos":[{"en":"oración natural en inglés","es":"su traducción al español"}]}\n' +
    "Reglas: 2 o 3 acepciones reales y distintas, las más usadas, en español. " +
    "Si solo existe una, devuelve una. 10 oraciones de ejemplo frecuentes y " +
    "variadas (casa, trabajo, conversación); cada una debe incluir la expresión. " +
    "Español natural. Sin markdown ni texto fuera del JSON."
  );
}

async function pedirGemini(item, apiKey) {
  const cuerpo = {
    contents: [{ parts: [{ text: promptDetalle(item) }] }],
    generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
  };
  const modelos = ["gemini-2.5-flash", "gemini-flash-latest"];
  let ultimo = "Gemini no respondió";
  for (const modelo of modelos) {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      modelo +
      ":generateContent?key=" +
      encodeURIComponent(apiKey);
    const respuesta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(20000),
    });
    if (respuesta.status === 404) {
      ultimo = "Modelo no disponible";
      continue;
    }
    if (!respuesta.ok) {
      throw new Error("Gemini HTTP " + respuesta.status + " " + (await respuesta.text()).slice(0, 180));
    }
    const datos = await respuesta.json();
    const texto =
      datos &&
      datos.candidates &&
      datos.candidates[0] &&
      datos.candidates[0].content &&
      datos.candidates[0].content.parts &&
      datos.candidates[0].content.parts[0] &&
      datos.candidates[0].content.parts[0].text;
    if (!texto) throw new Error("Gemini no devolvió texto");
    return interpretarDetalle(texto, item.palabra);
  }
  throw new Error(ultimo);
}

async function pedirChromeIA(item) {
  const Modelo = self.LanguageModel || (self.ai && self.ai.languageModel);
  if (!Modelo || typeof Modelo.create !== "function") return null;
  if (typeof Modelo.availability === "function") {
    const estado = await Modelo.availability();
    if (estado !== "available") return null;
  }
  const sesion = await Modelo.create({ temperature: 0.4 });
  try {
    const texto = await sesion.prompt(promptDetalle(item));
    return interpretarDetalle(texto, item.palabra);
  } finally {
    if (typeof sesion.destroy === "function") sesion.destroy();
  }
}

async function pedirTatoeba(palabra) {
  const consulta = terminoDe(palabra) || palabra;
  let frases = await buscarEnTatoeba(consulta);
  // Una expresión de varias palabras a menudo no está tal cual. Se buscan
  // frases con su palabra más larga.
  const clave = palabraMasLarga(consulta);
  if (!frases.length && clave && clave !== clavePlana(consulta)) {
    frases = await buscarEnTatoeba(clave);
  }
  return frases;
}

function palabraMasLarga(consulta) {
  const ignorar = { that: 1, with: 1, from: 1, this: 1, have: 1, your: 1, into: 1 };
  const partes = clavePlana(consulta)
    .split(" ")
    .filter((parte) => parte.length >= 4 && !ignorar[parte]);
  partes.sort((a, b) => b.length - a.length);
  return partes[0] || "";
}

async function buscarEnTatoeba(consulta) {
  const frases = [];
  const buscada = clavePlana(consulta);
  for (let pagina = 1; pagina <= 3 && frases.length < DETALLE_OBJETIVO; pagina++) {
    const url =
      "https://tatoeba.org/en/api_v0/search?from=eng&to=spa&query=" +
      encodeURIComponent(consulta) +
      "&page=" +
      pagina;
    const respuesta = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!respuesta.ok) throw new Error("Tatoeba HTTP " + respuesta.status);
    const datos = await respuesta.json();
    const resultados = (datos && datos.results) || [];
    if (!resultados.length) break;
    for (const resultado of resultados) {
      const en = textoPlano(resultado.text);
      const es = primeraTraduccion(resultado.translations, "spa");
      if (!en || !es) continue;
      if (buscada && !clavePlana(en).includes(buscada)) continue;
      frases.push({ en, es });
      if (frases.length >= DETALLE_OBJETIVO) break;
    }
  }
  return unirEjemplos([], frases);
}

function primeraTraduccion(grupos, idioma) {
  for (const grupo of grupos || []) {
    for (const traduccion of grupo || []) {
      if (traduccion && traduccion.lang === idioma && traduccion.text) {
        return textoPlano(traduccion.text);
      }
    }
  }
  return "";
}

const TIPOS_DICCIONARIO = {
  noun: "sustantivo",
  verb: "verbo",
  adjective: "adjetivo",
  adverb: "adverbio",
  interjection: "interjección",
  preposition: "preposición",
  conjunction: "conjunción",
  pronoun: "pronombre",
  phrase: "frase",
};

async function pedirDiccionario(item, config) {
  const consulta = terminoDe(item.palabra) || item.palabra;
  const respuesta = await fetch(
    "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(consulta),
    { signal: AbortSignal.timeout(12000) }
  );
  if (respuesta.status === 404) return [];
  if (!respuesta.ok) throw new Error("Diccionario HTTP " + respuesta.status);
  const datos = await respuesta.json();
  const definiciones = [];
  for (const entrada of datos || []) {
    for (const significado of entrada.meanings || []) {
      const tipo = TIPOS_DICCIONARIO[significado.partOfSpeech] || significado.partOfSpeech || "";
      for (const definicion of significado.definitions || []) {
        const en = textoPlano(definicion.definition);
        if (!en || definiciones.some((item) => item.en === en)) continue;
        definiciones.push({ tipo, en });
        if (definiciones.length >= 3) break;
      }
      if (definiciones.length >= 3) break;
    }
  }

  const acepciones = [];
  for (const definicion of definiciones) {
    try {
      const es = textoPlano(await traducir(definicion.en, config)).replace(/\s+[-–—]+\s*$/, "");
      if (es) acepciones.push({ tipo: definicion.tipo, es });
    } catch (error) {
      console.warn("No se tradujo una acepción:", error);
    }
  }
  return unirAcepciones([], acepciones);
}

chrome.runtime.onStartup.addListener(() => {
  reponerColaDetalle().catch((error) => console.warn("Detalle:", error));
});

// El service worker se apaga solo. Al volver a arrancar retoma las palabras
// que se quedaron sin frases.
reponerColaDetalle().catch((error) => console.warn("Detalle:", error));

chrome.runtime.onInstalled.addListener(() => {
  reponerColaDetalle().catch((error) => console.warn("Detalle:", error));
});
