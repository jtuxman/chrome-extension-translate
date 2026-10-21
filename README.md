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
- `sidepanel.html` / `sidepanel.js` / `sidepanel.css` — panel lateral de repaso.
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
4. Abre el panel (icono de la extensión) para repasar tu vocabulario; se
   actualiza automáticamente cada vez que guardas una palabra nueva.

## Motor de traducción

Se usa la [MyMemory API](https://mymemory.translated.net/doc/spec.php): gratis y
sin API key. Tiene un límite diario por IP y funciona mejor con palabras o
frases cortas. Para cambiar de motor solo hay que editar `traducirConMyMemory`
en `background.js`; el resto del código no cambia.

## Ideas futuras

- Definición y fonética (Free Dictionary API) tipo WordReference.
- Repaso con tarjetas (flashcards) y sistema de repetición espaciada.
- Exportar / importar el vocabulario.
- Atajos de teclado.
