# manga-downloaders

Userscripts independientes para descargar capítulos de manga completos en formato ZIP desde el navegador.

## Scripts

| Dominio | Script | Enlace directo |
|---|---|---|
| mangadex.org | `mangadexuserscript.js` | [Instalar](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangadexuserscript.js) |
| mangafire.to | `mangafiredownloader.js` | [Instalar](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangafiredownloader.js) |
| comix.to | `comixdownloader.js` | [Instalar](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/comixdownloader.js) |
| lmtos.net | `lmtosdownloader.js` | [Instalar](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/lmtosdownloader.js) |
| weloma.net | `welomadownloader.js` | [Instalar](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/welomadownloader.js) |
| mangaplaza.com | `mangaplazadownloader.js` | [Instalar](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangaplazadownloader.js) |

## Instalación

1. Tener instalado Tampermonkey o Violentmonkey.
2. Hacer clic en el enlace de instalación del sitio deseado.
3. Confirmar la instalación en el gestor.
4. Abrir cualquier capítulo en el sitio compatible.

## Detalles técnicos

- **MangaDex**: Usa la API oficial (`api.mangadex.org/at-home/server/`). Evita raspado de DOM y problemas con CSP o TrustedTypes.
- **Weloma**: Decodifica URLs codificadas en Base64 (`data-img`) y extrae las imágenes sin necesidad de forzar el renderizado secuencial.
- **Comix.to**: Intercepta de forma transparente la API desencriptada y las transiciones SPA de Next.js (`/_next/data/`). Procesa la descodificación binaria y la permutación de baldosas (*tile unscrambling*) mediante **Web Worker + OffscreenCanvas** con transferencia de memoria *Zero-Copy*, eliminando completamente el bloqueo de *tainted canvas* de Tampermonkey (evitando archivos corruptos de 69 bytes). Evalúa el `scrambleSeamScore` de las baldosas para seleccionar automáticamente la variante exacta (`0xe42f`, `0x1`, `0x1cb1d`) en cada página. Cuenta con fallback DOM serializado mediante Mutex para evitar condiciones de carrera en descargas paralelas.
- **MangaFire / LMTOS**: Implementan trigger de scroll automático sobre contenedores de imágenes para forzar la carga bajo demanda (*lazy loading* / *virtual scroll*).
- **Procesamiento de imágenes**: Las peticiones de red usan `GM_xmlhttpRequest` con cabeceras `Referer` adecuadas para evitar bloqueos por CDN y respuestas de error de 5KB.
- **Empaquetado**: Comprime las páginas a un archivo ZIP con `JSZip` y fuerza la descarga con `FileSaver`.

## Librerías de Respaldo (`lib/`)

Se almacenan copias locales de todas las dependencias externas en la carpeta `lib/` para prevenir fallos en caso de eliminación o caída de CDNs / repositorios de terceros:

- `lib/ImageDownloaderLib.js`: Interfaz de usuario flotante y controlador de descarga (actualizado con reset de estado para navegaciones SPA entre capítulos).
- `lib/axios.min.js`: Cliente HTTP para interacción con APIs.
- `lib/jszip.min.js`: Generación y compresión de archivos ZIP en memoria.
- `lib/FileSaver.min.js`: Gestor de descargas nativas del navegador.

## Créditos y Referencias

El módulo de descifrado y reconstrucción de baldosas (*tile unscrambling*) para **comix.to** está basado en la arquitectura, constantes de inicialización y algoritmos investigados por el proyecto de extensión [N3uralCreativity/comix-downloader](https://github.com/N3uralCreativity/comix-downloader).

## Licencia

GPL-3.0
