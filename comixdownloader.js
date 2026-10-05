// ==UserScript==
// @name         ComixDownloader
// @namespace    https://github.com/ema28pro/manga-downloaders
// @version      8
// @license      GPL-3.0
// @author       ema28pro
// @description  Manga downloader for comix.to (Multi-Strategy Robust DOM & API Extraction)
// @icon         https://comix.to/favicon.ico
// @homepageURL  https://github.com/ema28pro/manga-downloaders
// @supportURL   https://github.com/ema28pro/manga-downloaders/issues
// @reference    https://github.com/N3uralCreativity/comix-downloader
// @downloadURL  https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/comixdownloader.js
// @updateURL    https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/comixdownloader.js
// @match        https://comix.to/*
// @match        https://*.comix.to/*
// @require      https://unpkg.com/jszip@3.7.1/dist/jszip.min.js
// @require      https://unpkg.com/file-saver@2.0.5/dist/FileSaver.min.js
// @require      https://update.greasyfork.org/scripts/451810/ImageDownloaderLib.js
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function(JSZip, saveAs, ImageDownloader) {
  'use strict';

  const TAG = '[ComixDownloader v8]';

  // ── Configuración ──────────────────────────────────────────────────────
  const MAX_WORKERS = 8;  // Workers simultáneos para unscramble / conversión a PNG
  const MAX_RETRIES = 2;  // Reintentos por página si falla la descarga

  let initialized = false;
  let currentUrl = location.href;

  const targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const rawNativeFetch = (targetWin.fetch || window.fetch).bind(targetWin);

  const scrambleMap = new Map();
  const chapterPagesMap = new Map();

  const getCurrentChapterSlug = (url = location.href) => {
    const m = url.match(/\/title\/([^/]+)\/([^/?#]+)/i);
    return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
  };
  const getChapterPages = () => chapterPagesMap.get(getCurrentChapterSlug()) || window.__cdlPages;

  // ── Scramble info helpers ──────────────────────────────────────────────
  function makeScramble(seed, grid, hash) {
    const m = (grid || '5x5').match(/(\d+)x(\d+)/i);
    return {
      seed: parseInt(seed, 10),
      cols: m ? parseInt(m[1], 10) : 5,
      rows: m ? parseInt(m[2], 10) : 5,
      hash: (hash || '').toLowerCase()
    };
  }

  function storeScramble(url, scramble) {
    scrambleMap.set(url, scramble);
    scrambleMap.set(url.split('?')[0], scramble);
  }

  function captureHeaders(url, seed, grid, hash) {
    if (url && seed && grid) storeScramble(url, makeScramble(seed, grid, hash));
  }

  const isScrambledHost = url => url && (url.includes('wowpic') || url.includes('/i5/') || url.includes('/i4/'));

  // ── Encrypted API Payload Interceptor ──────────────────────────────────
  function parsePagesJson(str) {
    try { return JSON.parse(str); } catch (_) {}
    const start = str.lastIndexOf('{', str.indexOf('"pages"'));
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < str.length; i++) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}' && --depth === 0) return JSON.parse(str.substring(start, i + 1));
    }
    return null;
  }

  function tryCaptureApiPages(str, reqUrl = '') {
    if (!str || typeof str !== 'string' || str.length < 50 || !str.includes('"pages"')) return;
    try {
      const parsed = parsePagesJson(str);
      const res = parsed?.result || parsed?.data || parsed;
      const pagesObj = res?.pages;
      const items = Array.isArray(pagesObj?.items) ? pagesObj.items : (Array.isArray(pagesObj) ? pagesObj : null);
      if (!items?.length) return;

      const baseUrl = pagesObj?.baseUrl || '';
      const currentSlug = getCurrentChapterSlug();
      const targetSlug = getCurrentChapterSlug(reqUrl) || currentSlug;
      const list = [];

      for (const item of items) {
        const u = item?.url || (typeof item === 'string' ? item : null);
        if (typeof u !== 'string' || !u) continue;
        const src = /^https?:/i.test(u) ? u : baseUrl + u;
        let scramble = null;
        if (item.scramble) {
          scramble = makeScramble(item.scramble.seed, item.scramble.grid, item.scramble.hash);
          storeScramble(src, scramble);
        }
        list.push({ src, scramble });
      }

      if (list.length && targetSlug) {
        chapterPagesMap.set(targetSlug, list);
        if (targetSlug === currentSlug) {
          window.__cdlPages = list;
          console.log(`${TAG} Intercepted ${list.length} pages for [${targetSlug}] from API!`);
        }
      }
    } catch (_) {}
  }

  // ── Network & Decode Hooks (installed on the real page window) ─────────
  if (targetWin.TextDecoder?.prototype) {
    const origDecode = targetWin.TextDecoder.prototype.decode;
    targetWin.TextDecoder.prototype.decode = function(...args) {
      const res = origDecode.apply(this, args);
      tryCaptureApiPages(res);
      return res;
    };
  }

  if (targetWin.atob) {
    const origAtob = targetWin.atob;
    targetWin.atob = function(str) {
      const res = origAtob.call(targetWin, str);
      tryCaptureApiPages(res);
      return res;
    };
  }

  if (targetWin.fetch) {
    const origFetch = targetWin.fetch;
    targetWin.fetch = async function(...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        const type = res.headers?.get('content-type') || '';
        const isMedia = url && (/\.(webp|png|jpe?g|gif|avif|mp4|webm)/i.test(url) || url.includes('/hi/'));

        // Only parse JSON/text/components, never images
        if (!isMedia && (!type || /json|text|x-component/.test(type))) {
          if (isScrambledHost(url)) {
            captureHeaders(url, res.headers.get('x-scramble-seed'), res.headers.get('x-scramble-grid'), res.headers.get('x-scramble-hash'));
          }
          res.clone().text().then(text => tryCaptureApiPages(text, url)).catch(() => {});
        }
      } catch (_) {}
      return res;
    };
  }

  if (targetWin.XMLHttpRequest?.prototype) {
    const origOpen = targetWin.XMLHttpRequest.prototype.open;
    targetWin.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.addEventListener('load', function() {
        try {
          if (typeof url !== 'string') return;
          if (isScrambledHost(url)) {
            captureHeaders(url, this.getResponseHeader('x-scramble-seed'), this.getResponseHeader('x-scramble-grid'), this.getResponseHeader('x-scramble-hash'));
          }
          if ((this.responseType === '' || this.responseType === 'text') && this.responseText) {
            tryCaptureApiPages(this.responseText, url);
          }
        } catch (_) {}
      });
      return origOpen.call(this, method, url, ...rest);
    };
  }

  // ── Permutation Generator & Cost Function (shared by main thread & Worker) ──
  const SCRAMBLE_INIT_CONSTS = [0xe42f, 0x1, 0x1cb1d];
  const SCRAMBLE_HASH_INIT_CONSTS = {
    '03632': [0xe42f],
    '02900': [0x1cb1d],
    '09197': [0x1],
    bca9b: [0x1],
    e8a87: [0x1],
  };

  function getScrambleInitCandidates(hash) {
    const preferred = (hash && SCRAMBLE_HASH_INIT_CONSTS[hash]) || [];
    return [...new Set([...preferred, ...SCRAMBLE_INIT_CONSTS])];
  }

  function makeScramblePermutation(seed, count, initConst = 0xe42f) {
    const order = Array.from({ length: count }, (_, i) => i);
    let state = (initConst ^ ((seed >>> 1) << 1)) >>> 0;

    for (let remaining = count; remaining >= 2; remaining--) {
      state = (state ^ (state << 13)) >>> 0;
      state = (state ^ (state >>> 17)) >>> 0;
      state = (state ^ (state << 5)) >>> 0;
      const swapWith = state % remaining;
      const last = remaining - 1;
      const tmp = order[last];
      order[last] = order[swapWith];
      order[swapWith] = tmp;
    }
    return order;
  }

  function scrambleSeamScore(ctx, W, H, tileW, tileH, cols, rows) {
    let data;
    try { data = ctx.getImageData(0, 0, W, H).data; } catch (_) { return Infinity; }
    const STEP = 3;
    const diff = (a, b) => Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]);
    let s = 0;
    for (let c = 1; c < cols; c++) {
      const x = c * tileW;
      for (let y = 0; y < H; y += STEP) s += diff((y * W + x - 1) * 4, (y * W + x) * 4);
    }
    for (let r = 1; r < rows; r++) {
      const y = r * tileH;
      for (let x = 0; x < W; x += STEP) s += diff(((y - 1) * W + x) * 4, (y * W + x) * 4);
    }
    return s;
  }

  function drawUnscrambledTiles(ctx, bitmap, seed, cols, rows, initConst) {
    const W = bitmap.width;
    const H = bitmap.height;
    const tileW = Math.floor(W / cols);
    const tileH = Math.floor(H / rows);
    const count = cols * rows;

    ctx.drawImage(bitmap, 0, 0);
    if (seed <= 0) return { tileW, tileH };

    const perm = makeScramblePermutation(seed, count, initConst);
    for (let i = 0; i < count; i++) {
      const dst = perm[i];
      ctx.drawImage(
        bitmap,
        (i % cols) * tileW, Math.floor(i / cols) * tileH, tileW, tileH,
        (dst % cols) * tileW, Math.floor(dst / cols) * tileH, tileW, tileH
      );
    }
    return { tileW, tileH };
  }

  // ── Web Worker + OffscreenCanvas multi-variant unscrambler ─────────────
  const WORKER_CODE = `
    const SCRAMBLE_INIT_CONSTS = ${JSON.stringify(SCRAMBLE_INIT_CONSTS)};
    const SCRAMBLE_HASH_INIT_CONSTS = ${JSON.stringify(SCRAMBLE_HASH_INIT_CONSTS)};
    ${getScrambleInitCandidates.toString()}
    ${makeScramblePermutation.toString()}
    ${scrambleSeamScore.toString()}
    ${drawUnscrambledTiles.toString()}

    self.onmessage = async (e) => {
      try {
        const { buffer, seed, cols, rows, hash } = e.data;
        const bitmap = await createImageBitmap(new Blob([buffer]));
        const W = bitmap.width;
        const H = bitmap.height;
        // Unscrambled images only need one pass; scrambled ones try every variant
        const candidates = seed > 0 ? getScrambleInitCandidates(hash) : [0xe42f];

        let bestCanvas = null;
        let bestScore = Infinity;

        for (const initConst of candidates) {
          const canvas = new OffscreenCanvas(W, H);
          const ctx = canvas.getContext('2d');
          const { tileW, tileH } = drawUnscrambledTiles(ctx, bitmap, seed, cols, rows, initConst);
          const score = candidates.length > 1
            ? scrambleSeamScore(ctx, tileW * cols, tileH * rows, tileW, tileH, cols, rows)
            : 0;
          if (!bestCanvas || score < bestScore) { bestCanvas = canvas; bestScore = score; }
        }

        bitmap.close();
        const outBuffer = await (await bestCanvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
        self.postMessage({ ok: true, buffer: outBuffer }, [outBuffer]);
      } catch (err) {
        self.postMessage({ ok: false, error: err.message });
      }
    };
  `;

  // Reusable worker pool: at most MAX_WORKERS decoding at once, extra pages wait in line
  const pool = { url: null, idle: [], total: 0, waiting: [] };

  function spawnWorker() {
    pool.url ||= URL.createObjectURL(new Blob([WORKER_CODE], { type: 'application/javascript' }));
    const worker = new Worker(pool.url);
    pool.total++;
    return worker;
  }

  const acquireWorker = () => pool.idle.pop()
    || (pool.total < MAX_WORKERS ? spawnWorker() : new Promise((resolve, reject) => pool.waiting.push({ resolve, reject })));

  function releaseWorker(worker, broken) {
    if (broken) { worker.terminate(); pool.total--; worker = null; }
    const next = pool.waiting.shift();
    if (!next) { if (worker) pool.idle.push(worker); return; }
    try { next.resolve(worker || spawnWorker()); } catch (err) { next.reject(err); }
  }

  async function unscrambleInWorker(arrayBuffer, { seed, cols, rows, hash }) {
    const worker = await acquireWorker();
    let broken = false;
    try {
      return await new Promise((resolve, reject) => {
        worker.onmessage = e => e.data.ok ? resolve(e.data.buffer) : reject(new Error(e.data.error));
        worker.onerror = err => reject(new Error(`Worker error: ${err.message}`));
        const copy = arrayBuffer.slice(0);
        worker.postMessage({ buffer: copy, seed, cols, rows, hash }, [copy]);
      });
    } catch (err) {
      broken = true; // discard the worker so the next job gets a clean one
      throw err;
    } finally {
      releaseWorker(worker, broken);
    }
  }

  const getHeader = (headers, name) => typeof headers === 'string'
    ? (headers.match(new RegExp(`${name}:\\s*([^\\r\\n]+)`, 'i')) || [])[1]?.trim() || null
    : headers?.get?.(name) || null;

  // ── Network fetcher with timeout; GM_xmlhttpRequest as the only fallback ──
  async function requestImageOnce(pageNum, url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await rawNativeFetch(url, {
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
        mode: 'cors',
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength <= 1000) throw new Error(`Invalid buffer (${buffer.byteLength}B)`);
      return { buffer, headers: res.headers };
    } catch (err) {
      console.warn(`${TAG} Page ${pageNum}: fetch failed (${err.message}), trying GM_xmlhttpRequest...`);
      return new Promise((resolve, reject) => {
        const fail = msg => () => reject(new Error(`Page ${pageNum}: ${msg}`));
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          anonymous: true,
          timeout: 25000,
          headers: { Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
          responseType: 'arraybuffer',
          onload: r => r.status === 200 && r.response?.byteLength > 1000
            ? resolve({ buffer: r.response, headers: r.responseHeaders })
            : reject(new Error(`Page ${pageNum}: GM_xmlhttpRequest HTTP ${r.status}`)),
          ontimeout: fail('GM_xmlhttpRequest timed out'),
          onabort: fail('GM_xmlhttpRequest aborted'),
          onerror: fail('Both fetch and GM_xmlhttpRequest failed')
        });
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Retries transient failures (fetch + GM fallback already failed) with a growing delay
  async function requestImageBinary(pageNum, url) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await requestImageOnce(pageNum, url);
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw err;
        console.warn(`${TAG} Page ${pageNum}: retry ${attempt + 1}/${MAX_RETRIES} (${err.message})`);
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }

  // ── Image fetcher & unscrambler ────────────────────────────────────────
  // Every page goes through the Worker and comes out as lossless PNG
  // (ideal for Photoshop editing).
  async function fetchImageBuffer(pageNum, url, directScramble) {
    const { buffer, headers } = await requestImageBinary(pageNum, url);

    const seedVal = getHeader(headers, 'x-scramble-seed');
    const gridVal = getHeader(headers, 'x-scramble-grid');
    const info = (seedVal && gridVal)
      ? makeScramble(seedVal, gridVal, getHeader(headers, 'x-scramble-hash'))
      : directScramble || scrambleMap.get(url) || scrambleMap.get(url.split('?')[0])
      || { seed: 0, cols: 5, rows: 5, hash: '' };

    // ── Ruta anterior (descomentar para activarla) ────────────────────────
    // Sin scramble devuelve los bytes originales tal cual los sirve el sitio:
    // no reencodea (menos peso, mismo origen). El hook de JSZip de abajo ajusta
    // la extensión al formato real (.webp, .jpg, .png).
    // if (!(info.seed > 0)) return buffer;

    try {
      return await unscrambleInWorker(buffer, info);
    } catch (err) {
      console.warn(`${TAG} Page ${pageNum}: unscramble failed, returning raw image:`, err);
      return buffer;
    }
  }

  // ── Real extension from magic bytes (null if not a known image) ────────
  function getImageExtension(data) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data, 0, Math.min(data.byteLength, 12))
      : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, Math.min(data.byteLength, 12))
      : null;
    if (!bytes) return null;

    const at = (offset, str) => [...str].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
    if (bytes[0] === 0x89 && at(1, 'PNG')) return 'png';
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpg';
    if (at(0, 'RIFF') && at(8, 'WEBP')) return 'webp';
    if (at(0, 'GIF')) return 'gif';
    if (at(4, 'ftypavif')) return 'avif';
    return null;
  }

  // Rename each file inside the ZIP to match its real format
  if (JSZip?.prototype?.file) {
    const origZipFile = JSZip.prototype.file;
    JSZip.prototype.file = function(name, data, options) {
      const ext = typeof name === 'string' && getImageExtension(data);
      return origZipFile.call(this, ext ? name.replace(/\.[a-z0-9]+$/i, `.${ext}`) : name, data, options);
    };
  }

  async function fetchPageFromDOM(pageNum, scrambleInfo) {
    const selector = `[data-page="${pageNum}"] img, img[data-page="${pageNum}"]`;
    for (let attempt = 0; attempt < 25; attempt++) {
      const src = document.querySelector(selector)?.src;
      if (src?.startsWith('http')) return fetchImageBuffer(pageNum, src, scrambleInfo);
      await new Promise(r => setTimeout(r, 180));
    }
    throw new Error(`Failed to locate image source for page ${pageNum}`);
  }

  async function getPageImageData(pageNum) {
    const pageInfo = getChapterPages()?.[pageNum - 1];
    const scramble = pageInfo?.scramble || null;

    if (pageInfo?.src) {
      try {
        return await fetchImageBuffer(pageNum, pageInfo.src, scramble);
      } catch (err) {
        console.warn(`${TAG} Page ${pageNum}: API fetch failed, falling back to DOM:`, err);
      }
    }
    return fetchPageFromDOM(pageNum, scramble);
  }

  // ── Page metadata ──────────────────────────────────────────────────────
  const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  function getTitle() {
    let title = document.querySelector('.rpage-chap-ending__title')?.textContent?.trim() || '';
    if (title) {
      const ch = document.querySelector('.rpage-chap-ending__meta')?.textContent?.match(/Ch\.\s*\d+/i);
      if (ch) title += ` ${ch[0]}`;
    } else {
      title = (document.title || '').replace(/-\s*Comix.*/i, '').replace(/\|.*/, '').trim();
    }
    let safe = title.replace(/[\/\\?%*:|"<>]/g, '_').trim().replace(/\.+$/, '');
    if (WINDOWS_RESERVED_NAME.test(safe.split('.')[0])) safe = `_${safe}`;
    return safe || `Comix_Chapter_${Date.now()}`;
  }

  function getTotalPages() {
    const pages = getChapterPages();
    if (pages?.length) return pages.length;

    let maxPageData = 0;
    document.querySelectorAll('[data-page]').forEach(el => {
      maxPageData = Math.max(maxPageData, parseInt(el.getAttribute('data-page'), 10) || 0);
    });
    const counterMatch = document.querySelector('.rpage-page__counter')?.textContent?.match(/\/\s*(\d+)/);
    return Math.max(
      document.querySelectorAll('.rpage-page, .swiper-slide, .rpage-slide').length,
      document.querySelectorAll('.rpage-progress__seg').length,
      maxPageData,
      counterMatch ? parseInt(counterMatch[1], 10) : 0
    );
  }

  function scanScriptsForPages() {
    if (getChapterPages()?.length) return;
    for (const s of document.querySelectorAll('script')) {
      if (s.textContent?.includes('"pages"')) {
        tryCaptureApiPages(s.textContent);
        if (getChapterPages()?.length) break;
      }
    }
  }

  // ── Initialization ─────────────────────────────────────────────────────
  function checkAndInit() {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      initialized = false;
      scrambleMap.clear();
      window.__cdlPages = chapterPagesMap.get(getCurrentChapterSlug()) || null;
      try { ImageDownloader?.reset?.(); } catch (_) {}
    }

    const isReaderPage = /\/title\/[^/]+\/[^/]+/.test(location.pathname) ||
      !!document.querySelector('.rpage-main, .rpage-page, .swiper-container, .swiper-wrapper');
    if (!isReaderPage || initialized) return;

    scanScriptsForPages();

    const totalPages = getTotalPages();
    if (totalPages === 0) return;
    initialized = true;

    const title = getTitle();
    console.log(`${TAG} Initialized. ${totalPages} pages found. Title: "${title}"`);

    ImageDownloader.init({
      maxImageAmount: totalPages,
      title,
      imageSuffix: 'png',
      getImagePromises: (startNum, endNum) => {
        const promises = [];
        for (let p = startNum; p <= endNum; p++) {
          promises.push(
            getPageImageData(p)
              .then(ImageDownloader.fulfillHandler)
              .catch(err => {
                console.error(`${TAG} Page ${p} failed:`, err);
                return ImageDownloader.rejectHandler(err);
              })
          );
        }
        return promises;
      }
    });
  }

  checkAndInit();
  setInterval(checkAndInit, 1200);

})(JSZip, saveAs, ImageDownloader);