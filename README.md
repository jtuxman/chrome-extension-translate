# Aprende Vocabulario - Traductor EN/ES

Extensión de Chrome (Manifest V3) para aprender vocabulario inglés mientras lees.
Seleccionas una palabra o frase en inglés, la extensión la traduce al español,
muestra una burbuja flotante y guarda la palabra (con su contexto) en un panel
lateral para que la vayas repasando.

## Cómo funciona

```
Pestaña con texto
  └─ content.js  (detecta la selección + su oración de contexto)
        └─ chrome.runtime.sendMessage({tipo:"traducir", texto, contexto})
              └─ background.js (service worker)
                    ├─ traduce con MyMemory API (en → es)
                    ├─ guarda {palabra, traduccion, contexto, url, fecha, vecesVista}
                    │     en chrome.storage.local
                    └─ responde la traducción
        └─ content.js muestra la burbuja flotante
  chrome.storage.onChanged ─► sidepanel.js se actualiza solo
```

## Archivos

- `manifest.json` — configuración y permisos de la extensión.
- `background.js` — service worker: traduce y persiste el vocabulario.
- `content.js` / `content.css` — captura la selección y muestra la burbuja.
- `sidepanel.html` / `sidepanel.js` / `sidepanel.css` — panel lateral de repaso (con Jugar, Ajustes, exportar/importar).
- `options.html` / `options.js` / `options.css` — página de ajustes (motor de traducción y API keys).
- `juego.html` / `juego.js` / `juego.css` — juegos de vocabulario (reto, opción múltiple, escribir).
- `icons/` — iconos placeholder (16/48/128).

## Instalar en Chrome (modo desarrollador)

1. Abre `chrome://extensions` en Chrome.
2. Activa el **Modo de desarrollador** (interruptor arriba a la derecha).
3. Haz clic en **Cargar descomprimida** (Load unpacked).
4. Selecciona esta carpeta (`chrome-extension-translate`).
5. Fija la extensión y haz clic en su icono para abrir el **panel lateral**.

## Usar

1. Abre cualquier artículo en inglés.
2. Selecciona una palabra (p. ej. `overwhelming`) o una frase corta.
3. Aparecerá una burbuja con la traducción y se guardará en el panel lateral.
   Para una palabra corta, enseguida se agregan 2 o 3 acepciones y hasta 10
   frases de ejemplo con su traducción (Gemini si pegas una clave en Ajustes;
   si no, un diccionario y frases reales de Tatoeba).
4. Abre el panel (icono de la extensión) para repasar tu vocabulario; se
   actualiza automáticamente cada vez que guardas una palabra nueva.

## Juegos de vocabulario

Desde el panel lateral, el botón **Jugar** abre `juego.html` (en una pestaña
nueva). Los juegos usan las palabras que ya tienes guardadas:

- **Reto:** 10 opciones parecidas entre sí y una barra de tiempo (teclas
  1–9 y 0). La velocidad, también en los otros juegos, se elige en Lento (25 s),
  Normal (15 s) o Rápido (8 s). Al empezar queda en Lento.
  La opción correcta es siempre la traducción que guardaste.
- **Opción múltiple:** eliges la traducción correcta entre varias (los
  distractores salen de tu propio vocabulario).
- **Escribir:** solo palabras sueltas, sin frases. Antes de escribir ves una
  casilla por letra con la primera ya puesta; al comprobar, la corrección queda
  en pantalla hasta pulsar Siguiente (se ignoran mayúsculas y acentos).

Cada palabra guarda la fecha en que la agregaste (se ve en el panel). En
**Palabras guardadas** eliges qué repasar en cualquiera de los juegos: las de
hoy, las de los últimos 7 días, las de los últimos 30 días o todas. La misma
lista está en la barra de cada juego para cambiar de periodo sin salir.

Puedes elegir la **dirección**: Inglés → Español (por defecto) o el modo
inverso Español → Inglés. También hay una **racha diaria** (🔥): cuenta los días
seguidos que practicas y se reinicia si te saltas un día; se muestra en el panel
lateral y en la pantalla de juegos.

Incluye **repetición espaciada** (sistema Leitner): cada acierto sube el nivel
de la palabra y espacia su próximo repaso (0, 1, 3, 7, 14, 30 días); un fallo la
devuelve al nivel 0. Por defecto el juego prioriza las palabras que "tocan hoy".
Estos datos (`nivel`, `aciertos`, `fallos`, `proximoRepaso`) se guardan junto a
cada palabra en `chrome.storage.local`.

## Copia de seguridad (exportar / importar)

En el pie del panel lateral:

- **Exportar JSON:** descarga todo tu vocabulario como `vocabulario-FECHA.json`.
- **Importar JSON:** carga un archivo exportado; se fusiona con lo existente
  (acepta tanto el formato objeto como un array de palabras).

## Motor de traducción (configurable)

El motor se elige desde la **página de opciones** (icono de la extensión →
`Ajustes`, o botón "Ajustes" del panel lateral). La configuración se guarda en
`chrome.storage.sync`. Motores disponibles:

| Motor | API key | Notas |
| --- | --- | --- |
| MyMemory | No | Gratis. Límite diario por IP; mejor con frases cortas. |
| LibreTranslate | Opcional | URL de servidor configurable (público o propio). |
| Chrome integrado | No | API `Translator` del navegador, offline. Experimental; requiere Chrome reciente. |
| DeepL | Sí | Selector Free/Pro. Alta calidad. |
| Google Cloud Translate | Sí | API key de Google Cloud. |

El botón **Probar traducción** de la página de ajustes verifica el motor
traduciendo la palabra `hello` sin guardarla en el vocabulario.

Internamente, `background.js` lee la config y despacha a una función por motor
(`traducirMyMemory`, `traducirLibre`, `traducirChrome`, `traducirDeepL`,
`traducirGoogle`). Añadir un motor nuevo es agregar una función y una entrada en
el `switch` de `traducir()`.

### Permisos

`manifest.json` declara los hosts de los motores en `host_permissions`. Si en
LibreTranslate usas una URL distinta a `libretranslate.com`, al guardar Chrome
pedirá permiso para ese dominio (`optional_host_permissions`).

## Ideas futuras

- Definición y fonética (Free Dictionary API) tipo WordReference.
- Repaso con tarjetas (flashcards) y sistema de repetición espaciada.
- Exportar / importar el vocabulario.
- Atajos de teclado.
