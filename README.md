# 📚 Manga Downloaders

Colección de scripts de usuario (Userscripts) independientes para Tampermonkey / Violentmonkey que permiten descargar capítulos completos de manga en formato `.zip`.

## 🚀 Scripts Disponibles

| Sitio Web | Userscript | Enlace de Instalación Directa |
| :--- | :--- | :--- |
| **MangaDex** | `mangadexuserscript.js` | [Instalar Script](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangadexuserscript.js) |
| **MangaFire** | `mangafiredownloader.js` | [Instalar Script](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangafiredownloader.js) |
| **Comix** | `comixdownloader.js` | [Instalar Script](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/comixdownloader.js) |
| **LMTOS** | `lmtosdownloader.js` | [Instalar Script](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/lmtosdownloader.js) |
| **MangaPlaza** | `mangaplazadownloader.js` | [Instalar Script](https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangaplazadownloader.js) |

---

## 🛠️ Requisitos e Instalación

1. Instala un gestor de Userscripts en tu navegador:
   - [Tampermonkey](https://www.tampermonkey.net/) (Recomendado)
   - [Violentmonkey](https://violentmonkey.github.io/)
2. Haz clic en el enlace de **Instalar Script** del sitio que desees descargar.
3. El administrador de Userscripts abrirá automáticamente la pantalla de confirmación. Haz clic en **Instalar**.
4. Visita cualquier capítulo del manga en el sitio correspondiente y aparecerá la interfaz flotante para descargar el capítulo completo en `.zip`.

---

## ✨ Características Principales

- **Empaquetado en `.zip`**: Descarga todas las imágenes del capítulo en segundo plano utilizando `JSZip` y las guarda automáticamente en tu equipo.
- **Soporte para API Oficial (MangaDex)**: `MangaDexUserScript` consulta directamente los servidores de `api.mangadex.org`, garantizando descargas ultrarrápidas en la máxima resolución original e inmunes a restricciones de CSP/TrustedTypes.
- **Manejo de Virtual Scroll y Lazy Loading**: `mangafiredownloader.js` y `lmtosdownloader.js` fuerzan el renderizado y carga bajo demanda para asegurar que no quede ninguna página vacía.
- **Validación y Cabeceras de Red**: Incorpora cabeceras `Referer` y comprobación de integridad para evitar archivos corruptos.

---

## 📜 Licencia

Distribuido bajo la licencia [GPL-3.0](LICENSE).
