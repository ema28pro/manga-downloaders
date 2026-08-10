// ==UserScript==
// @name         ComixDownloader
// @namespace    https://github.com/ema28pro/manga-downloaders
// @version      2.4
// @license      GPL-3.0
// @author       ema28pro
// @description  Manga downloader for comix.to (Supports single page, double page, LTR/RTL and long strip modes)
// @icon         https://comix.to/favicon.ico
// @homepageURL  https://github.com/ema28pro/manga-downloaders
// @supportURL   https://github.com/ema28pro/manga-downloaders/issues
// @downloadURL  https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/comixdownloader.js
// @updateURL    https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/comixdownloader.js
// @match        https://comix.to/*
// @match        https://*.comix.to/*
// @require      https://unpkg.com/axios@0.27.2/dist/axios.min.js
// @require      https://unpkg.com/jszip@3.7.1/dist/jszip.min.js
// @require      https://unpkg.com/file-saver@2.0.5/dist/FileSaver.min.js
// @require      https://update.greasyfork.org/scripts/451810/ImageDownloaderLib.js
// @require      https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/lib/CanvasDownloaderLib.js
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(async function(axios, JSZip, saveAs, ImageDownloader) {
  'use strict';

  const VERSION = '2.4';
  let initialized = false;
  let currentUrl = location.href;
  let navLock = Promise.resolve();
  let chapterInterceptStart = 0;

  // Enable CORS on remote image loads if CanvasDownloader is available
  if (typeof CanvasDownloader !== 'undefined' && CanvasDownloader.enableImageCORS) {
    CanvasDownloader.enableImageCORS();
  }

  // ── Network & Canvas Interceptors ──────────────────────────────────────
  const interceptedImageUrls = [];

  function isMangaImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.includes('data:image') || url.includes('favicon') || url.includes('avatar') || url.includes('poster') || url.includes('logo') || url.includes('icon')) return false;
    if (url.startsWith('blob:')) return true;
    if (/\.(?:jpg|jpeg|png|webp|avif)(?:\?.*)?$/i.test(url)) return true;
    return url.includes('wowpic') || url.includes('/i5/') || url.includes('/i4/') || url.includes('/i3/') || url.includes('/i2/') || url.includes('/i1/') || url.includes('/c713/') || url.includes('static.comix.to');
  }

  // Set crossOrigin = 'anonymous' on image elements to prevent canvas tainting
  try {
    const origSrcSetter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (origSrcSetter && origSrcSetter.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        get: function() { return origSrcSetter.get.call(this); },
        set: function(url) {
          if (url && typeof url === 'string' && url.startsWith('http') && !this.crossOrigin) {
            this.crossOrigin = 'anonymous';
          }
          return origSrcSetter.set.call(this, url);
        },
        configurable: true,
        enumerable: true
      });
    }
  } catch (_) {}

  // 1. Intercept Canvas drawImage calls to capture original image URLs on canvas elements
  const origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
    try {
      const src = image?.src || image?.currentSrc;
      if (src && isMangaImageUrl(src)) {
        const canvas = this.canvas;
        if (canvas) canvas._mangaSrc = src;
        const pageEl = canvas?.closest?.('.rpage-page');
        if (pageEl) pageEl._mangaSrc = src;
        if (!interceptedImageUrls.includes(src)) interceptedImageUrls.push(src);
      }
    } catch (_) {}
    return origDrawImage.apply(this, [image, ...args]);
  };

  // 2. Intercept window.fetch
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    if (isMangaImageUrl(url) && !interceptedImageUrls.includes(url)) {
      interceptedImageUrls.push(url);
    }
    return originalFetch.apply(this, args);
  };

  // 3. Intercept XMLHttpRequest
  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (isMangaImageUrl(url) && !interceptedImageUrls.includes(url)) {
      interceptedImageUrls.push(url);
    }
    return origXHROpen.apply(this, [method, url, ...rest]);
  };

  // Deep recursive React Fiber inspector to extract image URLs from React component props
  function findUrlInReactTree(node, depth = 0) {
    if (!node || depth > 8) return null;
    if (typeof node === 'string') {
      if (isMangaImageUrl(node)) return node;
      const m = node.match(/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp|avif)[^"'\s]*/i) ||
                node.match(/https?:\/\/[^"'\s]*(?:wowpic|\/i5\/|\/i4\/|\/i3\/|\/i2\/|\/i1\/)[^"'\s]*/i);
      if (m && isMangaImageUrl(m[0])) return m[0];
      return null;
    }
    if (typeof node === 'object') {
      const props = node.memoizedProps || node.pendingProps || node.props;
      if (props && typeof props === 'object') {
        for (const key of ['src', 'url', 'image', 'path', 'href', 'original']) {
          const val = props[key];
          if (typeof val === 'string' && isMangaImageUrl(val)) return val;
        }
      }
      try {
        if (node.memoizedProps) {
          const r = findUrlInReactTree(node.memoizedProps, depth + 1);
          if (r) return r;
        }
        if (node.child) {
          const r = findUrlInReactTree(node.child, depth + 1);
          if (r) return r;
        }
        if (node.sibling) {
          const r = findUrlInReactTree(node.sibling, depth + 1);
          if (r) return r;
        }
      } catch (_) {}
    }
    return null;
  }

  function findUrlInElement(el) {
    if (!el) return null;
    for (const attr of ['data-src', 'data-url', 'data-image', 'data-original', 'src']) {
      const val = el.getAttribute?.(attr);
      if (val && isMangaImageUrl(val)) return val;
    }
    try {
      for (const key of Object.keys(el)) {
        if (key.startsWith('__reactFiber') || key.startsWith('__reactProps')) {
          const url = findUrlInReactTree(el[key]);
          if (url) return url;
        }
      }
    } catch (_) {}
    return null;
  }

  function withNavLock(fn) {
    const next = navLock.then(() => fn());
    navLock = next.catch(() => {});
    return next;
  }

  // ── Chapter Change & Reset ─────────────────────────────────────────────
  function resetForNewChapter() {
    initialized = false;
    chapterInterceptStart = interceptedImageUrls.length;
    currentUrl = location.href;
    const oldWidget = document.getElementById('ImageDownloader');
    if (oldWidget) oldWidget.remove();
    console.log(`[ComixDownloader v${VERSION}] Chapter changed -> Widget reset.`);
  }

  window.addEventListener('popstate', resetForNewChapter);
  setInterval(() => {
    if (location.href !== currentUrl) resetForNewChapter();
  }, 600);

  // ── Initializer ────────────────────────────────────────────────────────
  const checkAndInit = () => {
    if (!document.body) return;

    const progressSegs = document.querySelectorAll('.rpage-progress__seg');
    const pageEls = document.querySelectorAll('.rpage-page');

    let totalPages = progressSegs.length;
    if (progressSegs.length > 0) {
      const last = progressSegs[progressSegs.length - 1];
      const m = (last.getAttribute('title') || last.getAttribute('aria-label') || '').match(/(\d+)/);
      if (m) totalPages = Math.max(totalPages, parseInt(m[1], 10));
    }
    if (totalPages === 0) totalPages = pageEls.length;

    if (totalPages > 0 && !initialized) {
      initialized = true;
      let title = document.title;
      const syncEl = document.getElementById('syncData');
      if (syncEl) {
        try {
          const sync = JSON.parse(syncEl.textContent);
          if (sync.name && sync.number) title = `${sync.name} - Ch.${sync.number}`;
        } catch (_) {}
      }

      console.log(`[ComixDownloader v${VERSION}] Initialized. ${totalPages} pages found.`);

      ImageDownloader.init({
        maxImageAmount: totalPages,
        title,
        getImagePromises: (startNum, endNum) => {
          const promises = [];
          for (let i = startNum - 1; i < endNum; i++) {
            const p = i + 1;
            promises.push(
              getPageImageData(p)
                .then(res => {
                  console.log(`[ComixDownloader v${VERSION}] Page ${p}/${totalPages}: OK (${res.byteLength} bytes)`);
                  return ImageDownloader.fulfillHandler(res);
                })
                .catch(err => {
                  console.error(`[ComixDownloader v${VERSION}] Page ${p}/${totalPages}: FAILED`, err);
                  return ImageDownloader.rejectHandler(err);
                })
            );
          }
          return promises;
        }
      });
    }
  };

  checkAndInit();
  setInterval(checkAndInit, 1200);

  // ── Media Extraction ───────────────────────────────────────────────────
  async function extractPageMedia(pageEl) {
    if (!pageEl) return null;

    // 1. Captured _mangaSrc from CanvasRenderingContext2D.prototype.drawImage
    if (pageEl._mangaSrc) {
      return { type: 'url', url: pageEl._mangaSrc };
    }
    const canvas = pageEl.tagName === 'CANVAS' ? pageEl : pageEl.querySelector('canvas');
    if (canvas?._mangaSrc) {
      return { type: 'url', url: canvas._mangaSrc };
    }

    // 2. Direct <img> HTTP or Blob URL
    const img = pageEl.tagName === 'IMG' ? pageEl : pageEl.querySelector('img');
    if (img?.src) {
      if (img.src.startsWith('http') && !img.src.includes('data:image')) {
        return { type: 'url', url: img.src };
      }
      if (img.src.startsWith('blob:')) {
        return { type: 'blob', url: img.src };
      }
    }

    // 3. Rendered <canvas> to PNG binary buffer using CanvasDownloader
    if (canvas && canvas.width > 10 && canvas.height > 10) {
      try {
        let buf = null;
        if (typeof CanvasDownloader !== 'undefined' && CanvasDownloader.canvasToBuffer) {
          buf = await CanvasDownloader.canvasToBuffer(canvas);
        } else {
          const dataUrl = canvas.toDataURL('image/png');
          const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          const bin = atob(b64);
          if (bin.length > 1000) {
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            buf = bytes.buffer;
          }
        }
        if (buf && buf.byteLength > 1000) {
          return { type: 'buffer', buffer: buf };
        }
      } catch (_) {}
    }

    // 4. React Fiber tree or Dataset URL on pageEl or children
    const reactUrl = findUrlInElement(pageEl);
    if (reactUrl) return { type: 'url', url: reactUrl };
    if (pageEl.children) {
      for (const child of pageEl.children) {
        const childUrl = findUrlInElement(child);
        if (childUrl) return { type: 'url', url: childUrl };
      }
    }

    return null;
  }

  // ── Process Page Request ───────────────────────────────────────────────
  async function getPageImageData(pageNum) {
    console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Requesting...`);
    let result = null;

    await withNavLock(async () => {
      let pageEl = document.querySelector(`.rpage-page[data-page="${pageNum}"]`);
      result = await extractPageMedia(pageEl);

      if (!result) {
        const segBtn = document.querySelector(
          `.rpage-progress__seg[title="Page ${pageNum}"], ` +
          `.rpage-progress__seg[aria-label="Go to page ${pageNum}"], ` +
          `.rpage-progress .rpage-progress__seg:nth-child(${pageNum})`
        );

        if (segBtn) segBtn.click();
        if (pageEl) {
          pageEl.click();
          pageEl.scrollIntoView({ block: 'center', inline: 'center' });
        }
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('scroll'));

        // Poll up to 3.5s for canvas draw / React mount / image load
        for (let i = 0; i < 35; i++) {
          await new Promise(r => setTimeout(r, 100));
          pageEl = document.querySelector(`.rpage-page[data-page="${pageNum}"]`);
          result = await extractPageMedia(pageEl);
          if (result) break;
          if (i === 15) {
            if (segBtn) segBtn.click();
            if (pageEl) pageEl.click();
            window.dispatchEvent(new Event('resize'));
            window.dispatchEvent(new Event('scroll'));
          }
        }
      }

      if (result) {
        const label = result.type === 'url' ? `img -> ${result.url}`
                    : result.type === 'blob' ? `blob`
                    : `canvas (${result.buffer.byteLength}B)`;
        console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: ${label}`);
      }
    });

    // Strategy 1: Captured Canvas / HTTP URL
    if (result?.type === 'url') return fetchImageWithRetry(pageNum, result.url);

    // Strategy 2: Rendered Canvas Buffer
    if (result?.type === 'buffer') return result.buffer;

    // Strategy 3: Blob URL
    if (result?.type === 'blob') {
      try {
        const buf = await fetch(result.url).then(r => r.arrayBuffer());
        if (buf.byteLength > 1000) return buf;
      } catch (_) {}
    }

    // Strategy 4: Fallback to Page-Map
    const pageMap = new Map();
    const pageEls = document.querySelectorAll('.rpage-page[data-page]');
    for (const el of pageEls) {
      const p = parseInt(el.getAttribute('data-page'), 10);
      const media = await extractPageMedia(el);
      if (p && media?.type === 'url') pageMap.set(p, media.url);
    }

    if (pageMap.has(pageNum)) {
      const mappedUrl = pageMap.get(pageNum);
      console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Using pageMap URL -> ${mappedUrl}`);
      return fetchImageWithRetry(pageNum, mappedUrl);
    }

    // Strategy 5: Throw error instead of 1KB dummy placeholder
    console.error(`[ComixDownloader v${VERSION}] Page ${pageNum}: Canvas/image empty or failed to extract.`);
    throw new Error(`[ComixDownloader] Failed to extract image content for page ${pageNum}`);
  }


  // ── Image Fetching with Retries ────────────────────────────────────────
  async function fetchImageWithRetry(pageNum, url, retries = 4) {
    for (let i = 1; i <= retries; i++) {
      try {
        const data = await fetchImageBuffer(url);
        if (data?.byteLength > 1000) return data;
      } catch (e) {
        if (i === retries) throw e;
      }
      await new Promise(r => setTimeout(r, 600 * i));
    }
    throw new Error(`Failed to fetch binary data for page ${pageNum}`);
  }

  function fetchImageBuffer(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: {
          'Referer': location.href,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        },
        responseType: 'arraybuffer',
        onload: r => r.status === 200 && r.response?.byteLength > 1000
          ? resolve(r.response)
          : reject(new Error(`HTTP ${r.status}, ${r.response?.byteLength || 0}B`)),
        onerror: reject
      });
    });
  }

})(axios, JSZip, saveAs, ImageDownloader);
