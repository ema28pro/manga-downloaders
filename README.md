# manga-downloaders

Userscripts independientes para descargar capítulos de manga completos en formato ZIP desde el navegador.

## Scripts

| Dominio | Script | Enlace directo |
|---|---|---|
| mangadex.org | `mangadexuserscript.js` | [Instalar](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangadexuserscript.js) |
| mangafire.to | `mangafiredownloader.js` | [Instalar](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangafiredownloader.js) |
| comix.to | `comixdownloader.js` | [Instalar](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/comixdownloader.js) |
| lmtos.net | `lmtosdownloader.js` | [Instalar](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/lmtosdownloader.js) |
| mangaplaza.com | `mangaplazadownloader.js` | [Instalar](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangaplazadownloader.js) |

## Instalación

1. Tener instalado Tampermonkey o Violentmonkey.
2. Hacer clic en el enlace de instalación del sitio deseado.
3. Confirmar la instalación en el gestor.
4. Abrir cualquier capítulo en el sitio compatible.

## Detalles técnicos

- **MangaDex**: Usa la API oficial (`api.mangadex.org/at-home/server/`). Evita raspado de DOM y problemas con CSP o TrustedTypes.
- **MangaFire / LMTOS**: Implementan trigger de scroll automático sobre contenedores de imágenes para forzar la carga bajo demanda (*lazy loading* / *virtual scroll*).
- **Procesamiento de imágenes**: Las peticiones de red usan `GM_xmlhttpRequest` con cabeceras `Referer` adecuadas para evitar bloqueos por CDN y respuestas de error de 5KB.
- **Empaquetado**: Comprime las páginas a un archivo ZIP con `JSZip` y fuerza la descarga con `FileSaver`.

## Licencia

GPL-3.0
