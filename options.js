// Página de opciones: carga y guarda la configuración del motor de traducción.

const CONFIG_POR_DEFECTO = {
  motor: "mymemory",
  sourceLang: "en",
  targetLang: "es",
  libre: { url: "https://libretranslate.com/translate", apiKey: "" },
  deepl: { apiKey: "", plan: "free" },
  google: { apiKey: "" },
};

const el = {
  motores: document.getElementById("motores"),
  sourceLang: document.getElementById("sourceLang"),
  targetLang: document.getElementById("targetLang"),
  libreUrl: document.getElementById("libreUrl"),
  libreApiKey: document.getElementById("libreApiKey"),
  deeplApiKey: document.getElementById("deeplApiKey"),
  deeplPlan: document.getElementById("deeplPlan"),
  googleApiKey: document.getElementById("googleApiKey"),
  guardar: document.getElementById("guardar"),
  probar: document.getElementById("probar"),
  estado: document.getElementById("estado"),
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const config = await cargarConfig();
  rellenarFormulario(config);
  actualizarVisibilidad();

  el.motores.addEventListener("change", actualizarVisibilidad);
  el.guardar.addEventListener("click", onGuardar);
  el.probar.addEventListener("click", onProbar);
}

async function cargarConfig() {
  const { config } = await chrome.storage.sync.get("config");
  return fusionar(CONFIG_POR_DEFECTO, config || {});
}

function fusionar(base, extra) {
  return {
    ...base,
    ...extra,
    libre: { ...base.libre, ...(extra.libre || {}) },
    deepl: { ...base.deepl, ...(extra.deepl || {}) },
    google: { ...base.google, ...(extra.google || {}) },
  };
}

function rellenarFormulario(config) {
  const radio = el.motores.querySelector(
    `input[name="motor"][value="${config.motor}"]`
  );
  if (radio) radio.checked = true;

  el.sourceLang.value = config.sourceLang;
  el.targetLang.value = config.targetLang;
  el.libreUrl.value = config.libre.url;
  el.libreApiKey.value = config.libre.apiKey;
  el.deeplApiKey.value = config.deepl.apiKey;
  el.deeplPlan.value = config.deepl.plan;
  el.googleApiKey.value = config.google.apiKey;
}

function motorSeleccionado() {
  const radio = el.motores.querySelector('input[name="motor"]:checked');
  return radio ? radio.value : "mymemory";
}

function actualizarVisibilidad() {
  const motor = motorSeleccionado();
  document.querySelectorAll(".opciones-motor").forEach((sec) => {
    sec.hidden = sec.dataset.motor !== motor;
  });
}

function leerFormulario() {
  return {
    motor: motorSeleccionado(),
    sourceLang: el.sourceLang.value.trim() || "en",
    targetLang: el.targetLang.value.trim() || "es",
    libre: {
      url: el.libreUrl.value.trim() || CONFIG_POR_DEFECTO.libre.url,
      apiKey: el.libreApiKey.value.trim(),
    },
    deepl: {
      apiKey: el.deeplApiKey.value.trim(),
      plan: el.deeplPlan.value,
    },
    google: {
      apiKey: el.googleApiKey.value.trim(),
    },
  };
}

async function onGuardar() {
  const config = leerFormulario();

  const error = validar(config);
  if (error) {
    mostrarEstado(error, "error");
    return;
  }

  // Si LibreTranslate usa una URL fuera de los host_permissions declarados,
  // pedimos permiso de host dinámicamente.
  if (config.motor === "libretranslate") {
    const concedido = await asegurarPermisoHost(config.libre.url);
    if (!concedido) {
      mostrarEstado(
        "Necesitas conceder permiso para ese servidor de LibreTranslate.",
        "error"
      );
      return;
    }
  }

  await chrome.storage.sync.set({ config });
  mostrarEstado("Ajustes guardados.", "ok");
}

function validar(config) {
  if (config.motor === "deepl" && !config.deepl.apiKey) {
    return "DeepL requiere una API key.";
  }
  if (config.motor === "google" && !config.google.apiKey) {
    return "Google Cloud Translate requiere una API key.";
  }
  if (config.motor === "libretranslate" && !config.libre.url) {
    return "Indica la URL del servidor de LibreTranslate.";
  }
  return null;
}

async function asegurarPermisoHost(url) {
  let origin;
  try {
    origin = new URL(url).origin + "/*";
  } catch (e) {
    return false;
  }
  try {
    const yaConcedido = await chrome.permissions.contains({ origins: [origin] });
    if (yaConcedido) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch (e) {
    // host_permissions estáticos (p. ej. libretranslate.com) ya cubren el caso.
    return true;
  }
}

async function onProbar() {
  const config = leerFormulario();
  const error = validar(config);
  if (error) {
    mostrarEstado(error, "error");
    return;
  }

  mostrarEstado("Probando…", "");
  try {
    const respuesta = await chrome.runtime.sendMessage({
      tipo: "probar",
      config,
    });
    if (respuesta && respuesta.ok) {
      mostrarEstado('OK: "hello" → "' + respuesta.traduccion + '"', "ok");
    } else {
      mostrarEstado(
        "Falló: " + ((respuesta && respuesta.error) || "desconocido"),
        "error"
      );
    }
  } catch (e) {
    mostrarEstado("Falló: " + String(e), "error");
  }
}

function mostrarEstado(texto, tipo) {
  el.estado.textContent = texto;
  el.estado.className = "estado" + (tipo ? " " + tipo : "");
}
