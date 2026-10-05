// ==UserScript==
// @name         ComixDownloader
// @namespace    https://github.com/ema28pro/manga-downloaders
// @version      7.9
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
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function(JSZip, saveAs, ImageDownloader) {
  'use strict';

  const VERSION = '7.9';
  let initialized = false;
  let currentUrl = location.href;

  const targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const rawNativeFetch = targetWin.fetch ? targetWin.fetch.bind(targetWin) : window.fetch.bind(window);

  const scrambleMap = new Map();
  const chapterPagesMap = new Map();

  function getCurrentChapterSlug(url = location.href) {
    const m = url.match(/\/title\/([^/]+)\/([^/?#]+)/i);
    return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
  }

  // ── Encrypted API Payload Interceptor ─────────────────────────────────
  const tryCaptureApiPages = (str, reqUrl = '') => {
    if (!str || typeof str !== 'string' || str.length < 50 || !str.includes('"pages"')) return;
    try {
      let parsed = null;
      try {
        parsed = JSON.parse(str);
      } catch (_) {
        const idx = str.indexOf('"pages"');
        if (idx !== -1) {
          const start = str.lastIndexOf('{', idx);
          if (start !== -1) {
            let braceCount = 0;
            let end = -1;
            for (let i = start; i < str.length; i++) {
              if (str[i] === '{') braceCount++;
              else if (str[i] === '}') {
                braceCount--;
                if (braceCount === 0) { end = i + 1; break; }
              }
            }
            if (end !== -1) parsed = JSON.parse(str.substring(start, end));
          }
        }
      }

      if (!parsed) return;

      const res = parsed?.result || parsed?.data || parsed;
      const pagesObj = res?.pages;
      const items = Array.isArray(pagesObj?.items) ? pagesObj.items : (Array.isArray(pagesObj) ? pagesObj : null);
      if (!items || !items.length) return;

      const baseUrl = pagesObj?.baseUrl || '';
      const list = [];
      const currentSlug = getCurrentChapterSlug();
      const targetSlug = getCurrentChapterSlug(reqUrl) || currentSlug;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const u = item?.url || (typeof item === 'string' ? item : null);
        if (typeof u === 'string' && u) {
          const fullUrl = /^https?:/i.test(u) ? u : (baseUrl + u);
          let scramble = null;
          if (item && item.scramble) {
            const gridMatch = (item.scramble.grid || '5x5').match(/(\d+)x(\d+)/i);
            scramble = {
              seed: parseInt(item.scramble.seed, 10),
              cols: gridMatch ? parseInt(gridMatch[1], 10) : 5,
              rows: gridMatch ? parseInt(gridMatch[2], 10) : 5,
              hash: (item.scramble.hash || '').toLowerCase()
            };
            scrambleMap.set(fullUrl, scramble);
            scrambleMap.set(fullUrl.split('?')[0], scramble);
          }
          list.push({ src: fullUrl, index: i + 1, scramble });
        }
      }

      if (list.length > 0 && targetSlug) {
        chapterPagesMap.set(targetSlug, list);
        if (targetSlug === currentSlug) {
          window.__cdlPages = list;
          console.log(`[ComixDownloader v${VERSION}] Intercepted ${list.length} pages for [${targetSlug}] from API!`);
        }
      }
    } catch (_) {}
  };

  // ── Network & Decode Hooks (Installed on real page window via targetWin) ──
  if (targetWin.TextDecoder && targetWin.TextDecoder.prototype) {
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
      tryCaptureApiPages(res); // C3 Fixed: analyzes decoded output
      return res;
    };
  }

  // ── Network Interceptors (Next.js SPA data & X-Scramble headers) ──────
  function captureHeaders(url, seed, grid, hash) {
    if (seed && grid && url) {
      const m = grid.match(/(\d+)x(\d+)/i);
      if (m) {
        const scramble = {
          seed: parseInt(seed, 10),
          cols: parseInt(m[1], 10),
          rows: parseInt(m[2], 10),
          hash: (hash || '').toLowerCase()
        };
        scrambleMap.set(url, scramble);
        scrambleMap.set(url.split('?')[0], scramble);
      }
    }
  }

  if (targetWin.fetch) {
    const origFetch = targetWin.fetch;
    targetWin.fetch = async function(...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        const contentType = res.headers?.get('content-type') || '';
        const isMedia = url && (/\.(webp|png|jpe?g|gif|avif|mp4|webm)/i.test(url) || url.includes('/hi/'));

        // C2 Fixed: Only clone and parse text for JSON, text or components (NEVER images)
        if (!isMedia && (!contentType || contentType.includes('json') || contentType.includes('text') || contentType.includes('x-component'))) {
          if (url && (url.includes('wowpic') || url.includes('/i5/') || url.includes('/i4/'))) {
            captureHeaders(url, res.headers.get('x-scramble-seed'), res.headers.get('x-scramble-grid'), res.headers.get('x-scramble-hash'));
          }
          res.clone().text().then(text => tryCaptureApiPages(text, url)).catch(() => {});
        }
      } catch (_) {}
      return res;
    };
  }

  if (targetWin.XMLHttpRequest && targetWin.XMLHttpRequest.prototype) {
    const origOpen = targetWin.XMLHttpRequest.prototype.open;
    targetWin.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.addEventListener('load', function() {
        try {
          if (url && typeof url === 'string') {
            if (url.includes('wowpic') || url.includes('/i5/') || url.includes('/i4/')) {
              captureHeaders(url, this.getResponseHeader('x-scramble-seed'), this.getResponseHeader('x-scramble-grid'), this.getResponseHeader('x-scramble-hash'));
            }
            if (this.responseType === '' || this.responseType === 'text') {
              if (this.responseText) {
                tryCaptureApiPages(this.responseText, url);
              }
            }
          }
        } catch (_) {}
      });
      return origOpen.call(this, method, url, ...rest);
    };
  }

  // ── Permutation Generator & Cost Function (Shared by Main Thread & Worker) ──
  const SCRAMBLE_INIT_CONSTS = [0xe42f, 0x1, 0x1cb1d];
  const SCRAMBLE_HASH_INIT_CONSTS = {
    '03632': [0xe42f],
    '02900': [0x1cb1d],
    '09197': [0x1],
    bca9b: [0x1],
    e8a87: [0x1],
  };

  function getScrambleInitCandidates(hash) {
    const preferred = hash ? SCRAMBLE_HASH_INIT_CONSTS[hash] : null;
    const out = [];
    for (const initConst of [...(preferred || []), ...SCRAMBLE_INIT_CONSTS]) {
      if (!out.includes(initConst)) out.push(initConst);
    }
    return out;
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
    let s = 0;
    for (let c = 1; c < cols; c++) {
      const x = c * tileW;
      for (let y = 0; y < H; y += STEP) {
        const a = (y * W + x - 1) * 4, b = (y * W + x) * 4;
        s += Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]);
      }
    }
    for (let r = 1; r < rows; r++) {
      const y = r * tileH;
      for (let x = 0; x < W; x += STEP) {
        const a = ((y - 1) * W + x) * 4, b = (y * W + x) * 4;
        s += Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]);
      }
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
    if (seed <= 0) return { W, H, tileW, tileH, count };

    const perm = makeScramblePermutation(seed, count, initConst);
    for (let i = 0; i < count; i++) {
      const srcX = (i % cols) * tileW;
      const srcY = Math.floor(i / cols) * tileH;
      const dstIndex = perm[i];
      const dstX = (dstIndex % cols) * tileW;
      const dstY = Math.floor(dstIndex / cols) * tileH;
      ctx.drawImage(bitmap, srcX, srcY, tileW, tileH, dstX, dstY, tileW, tileH);
    }
    return { W, H, tileW, tileH, count };
  }

  // ── Web Worker + OffscreenCanvas Multi-Variant Auto Unscrambler ───────
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
        const blob = new Blob([buffer]);
        const bitmap = await createImageBitmap(blob);
        const W = bitmap.width;
        const H = bitmap.height;
        const candidates = seed > 0 ? getScrambleInitCandidates(hash) : [0xe42f];
        const multi = candidates.length > 1;

        let bestCanvas = null;
        let bestScore = Infinity;

        for (const initConst of candidates) {
          const canvas = new OffscreenCanvas(W, H);
          const ctx = canvas.getContext('2d');
          const meta = drawUnscrambledTiles(ctx, bitmap, seed, cols, rows, initConst);

          const score = multi ? scrambleSeamScore(ctx, meta.tileW * cols, meta.tileH * rows, meta.tileW, meta.tileH, cols, rows) : 0;
          if (!bestCanvas || score < bestScore) {
            bestCanvas = canvas;
            bestScore = score;
          }
          if (!multi) break;
        }

        bitmap.close();

        const outBlob = await bestCanvas.convertToBlob({ type: 'image/png' });
        const outBuffer = await outBlob.arrayBuffer();

        self.postMessage(
          { ok: true, buffer: outBuffer, width: W, height: H },
          [outBuffer]
        );
      } catch (err) {
        self.postMessage({ ok: false, error: err.message });
      }
    };
  `;

  function unscrambleInWorker(arrayBuffer, seed, cols, rows, hash) {
    return new Promise((resolve, reject) => {
      let worker = null;
      let workerUrl = null;

      try {
        const workerBlob = new Blob([WORKER_CODE], { type: 'application/javascript' });
        workerUrl = URL.createObjectURL(workerBlob);
        worker = new Worker(workerUrl);
      } catch (e1) {
        try {
          const workerBlob = new (unsafeWindow.Blob)([WORKER_CODE], { type: 'application/javascript' });
          workerUrl = unsafeWindow.URL.createObjectURL(workerBlob);
          worker = new (unsafeWindow.Worker)(workerUrl);
        } catch (e2) {
          try {
            worker = new Worker('data:application/javascript,' + encodeURIComponent(WORKER_CODE));
          } catch (e3) {
            return reject(new Error(`Worker creation failed: ${e3.message}`));
          }
        }
      }

      const cleanup = () => {
        if (workerUrl) {
          try { URL.revokeObjectURL(workerUrl); } catch(_) {}
          try { unsafeWindow.URL.revokeObjectURL(workerUrl); } catch(_) {}
        }
        worker.terminate();
      };

      worker.onmessage = (e) => {
        cleanup();
        if (e.data.ok) {
          resolve(e.data.buffer);
        } else {
          reject(new Error(e.data.error));
        }
      };

      worker.onerror = (err) => {
        cleanup();
        reject(new Error(`Worker error: ${err.message}`));
      };

      const bufferCopy = arrayBuffer.slice(0);
      worker.postMessage(
        { buffer: bufferCopy, seed, cols, rows, hash },
        [bufferCopy]
      );
    });
  }

  async function unscrambleViaUnsafeWindow(arrayBuffer, seed, cols, rows, hash) {
    const pageBlob = new (unsafeWindow.Blob)([arrayBuffer]);
    const bitmap = await unsafeWindow.createImageBitmap(pageBlob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');

    const candidates = seed > 0 ? getScrambleInitCandidates(hash) : [0xe42f];
    drawUnscrambledTiles(ctx, bitmap, seed, cols, rows, candidates[0]);
    bitmap.close();

    const outBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!outBlob || outBlob.size < 1000) {
      throw new Error('toBlob failed in unsafeWindow fallback');
    }

    return await outBlob.arrayBuffer();
  }

  async function unscrambleImageBlob(arrayBuffer, scrambleInfo) {
    const seed = scrambleInfo?.seed || 0;
    const cols = scrambleInfo?.cols || 5;
    const rows = scrambleInfo?.rows || 5;
    const hash = scrambleInfo?.hash || '';

    try {
      return await unscrambleInWorker(arrayBuffer, seed, cols, rows, hash);
    } catch (workerErr) {
      console.warn(`[ComixDownloader v${VERSION}] Worker unscramble failed, falling back to unsafeWindow:`, workerErr);
      try {
        return await unscrambleViaUnsafeWindow(arrayBuffer, seed, cols, rows, hash);
      } catch (unsafeErr) {
        console.warn(`[ComixDownloader v${VERSION}] unsafeWindow unscramble failed, returning raw ArrayBuffer:`, unsafeErr);
        return arrayBuffer;
      }
    }
  }

  function getHeaderValue(headers, headerName) {
    if (!headers) return null;
    if (typeof headers === 'string') {
      const match = headers.match(new RegExp(headerName + ':\\s*([^\\r\\n]+)', 'i'));
      return match ? match[1].trim() : null;
    }
    if (typeof headers === 'object') {
      if (typeof headers.get === 'function') {
        const val = headers.get(headerName);
        if (val) return val;
      }
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === headerName.toLowerCase()) return headers[key];
      }
    }
    return null;
  }

  // ── Magic-byte image format detection ───────────────────────────────────
  // Returns the real extension for the given buffer so saved files keep a
  // name that matches their content (PNG / JPG / WebP).
  function getImageExtension(buffer) {
    try {
      if (!buffer || !buffer.byteLength) return 'png';

      const bytes = new Uint8Array(buffer);

      // WebP: "RIFF" .... "WEBP"
      if (bytes.length >= 12 &&
          bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
          bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return 'webp';
      }

      // JPEG: FF D8 FF
      if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return 'jpg';
      }

      // PNG: 89 50 4E 47 0D 0A 1A 0A
      if (bytes.length >= 4 &&
          bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return 'png';
      }
    } catch (_) {}

    return 'png';
  }

  // ── Network Fetcher with Timeouts (A4 Fix: Prevents hanging promises) ──
  function requestImageBinary(pageNum, url) {
    return new Promise((resolve, reject) => {
      const fetchFn = rawNativeFetch || (typeof window.fetch === 'function' ? window.fetch : unsafeWindow?.fetch);

      // 1. Primary: Native fetch with CORS & no-referrer (Unwrapped, with 25s timeout)
      if (fetchFn) {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 25000) : null;

        fetchFn(url, {
          method: 'GET',
          referrerPolicy: 'no-referrer',
          credentials: 'omit',
          mode: 'cors',
          signal: controller?.signal
        })
          .then(async res => {
            if (timeoutId) clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            const buf = await res.arrayBuffer();
            if (!buf || buf.byteLength <= 1000) throw new Error(`Invalid/empty buffer (${buf?.byteLength || 0}B)`);
            resolve({
              buffer: buf,
              headers: res.headers
            });
          })
          .catch(fetchErr => {
            if (timeoutId) clearTimeout(timeoutId);
            console.warn(`[ComixDownloader v${VERSION}] Page ${pageNum}: Native fetch failed (${fetchErr.message}), trying GM_xmlhttpRequest fallback...`);
            tryGmFallback();
          });
      } else {
        tryGmFallback();
      }

      function tryGmFallback() {
        if (typeof GM_xmlhttpRequest !== 'function') {
          return reject(new Error(`Page ${pageNum}: fetch failed and GM_xmlhttpRequest unavailable`));
        }

        let completed = false;
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          anonymous: true,
          timeout: 25000,
          headers: {
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
          },
          responseType: 'arraybuffer',
          onload: r => {
            if (completed) return;
            completed = true;
            if (r.status === 200 && r.response?.byteLength > 1000) {
              return resolve({
                buffer: r.response,
                headers: r.responseHeaders
              });
            }
            reject(new Error(`GM_xmlhttpRequest HTTP ${r.status}, ${r.response?.byteLength || 0}B`));
          },
          ontimeout: () => {
            if (completed) return;
            completed = true;
            reject(new Error(`GM_xmlhttpRequest timed out after 25s for page ${pageNum}`));
          },
          onabort: () => {
            if (completed) return;
            completed = true;
            reject(new Error(`GM_xmlhttpRequest aborted for page ${pageNum}`));
          },
          onerror: err => {
            if (completed) return;
            completed = true;
            reject(new Error(`Both fetch and GM_xmlhttpRequest failed for page ${pageNum}: ${err?.message || 'Network error'}`));
          }
        });
      }
    });
  }

  // ── Image Fetcher & Unscrambler ────────────────────────────────────────
  async function fetchImageBuffer(pageNum, url, directScramble) {
    console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Fetching ${url}...`);
    const { buffer, headers } = await requestImageBinary(pageNum, url);

    let seedVal = getHeaderValue(headers, 'x-scramble-seed');
    let gridVal = getHeaderValue(headers, 'x-scramble-grid');
    let hashVal = getHeaderValue(headers, 'x-scramble-hash');

    let scrambleInfo = directScramble || scrambleMap.get(pageNum) || scrambleMap.get(url) || scrambleMap.get(url.split('?')[0]) || null;

    if (seedVal && gridVal) {
      const m = gridVal.match(/(\d+)x(\d+)/i);
      if (m) {
        scrambleInfo = {
          seed: parseInt(seedVal, 10),
          cols: parseInt(m[1], 10),
          rows: parseInt(m[2], 10),
          hash: hashVal || ''
        };
      }
    }

    const info = scrambleInfo || { seed: 0, cols: 5, rows: 5, hash: '' };

    // Fast path: image is NOT scrambled (seed === 0). No need to touch it at all:
    // skip the worker round-trip, the canvas re-encode and the PNG conversion,
    // returning the original bytes (WebP/JPG/PNG as served) untouched.
    if (!(Number(info.seed) > 0)) {
      console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Not scrambled (seed=${Number(info.seed) || 0}) — returning original buffer (${buffer.byteLength}B).`);
      return buffer;
    }

    console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Unscrambling image (seed=${info.seed}, ${info.cols}x${info.rows}, hash=${info.hash || 'default'})...`);

    try {
      const pngBuf = await unscrambleImageBlob(buffer, info);
      console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: PNG generated! Output size: ${pngBuf.byteLength}B`);
      return pngBuf;
    } catch (err) {
      console.warn(`[ComixDownloader v${VERSION}] Page ${pageNum}: PNG conversion fallback to raw:`, err);
      return buffer;
    }
  }

  // ── Serialized Mutex for DOM Strategy ──────────────────────────────────
  let domLockPromise = Promise.resolve();

  async function fetchPageFromDOM(pageNum, scrambleInfo) {
    const helper = (typeof unsafeWindow !== 'undefined' && unsafeWindow.ComixDomHelper) || (typeof window !== 'undefined' && window.ComixDomHelper);
    if (helper?.fetchPageFromDOM) {
      return helper.fetchPageFromDOM(pageNum, scrambleInfo, fetchImageBuffer, unscrambleImageBlob, VERSION);
    }

    // Fallback compacto directo al DOM si no está cargado ComixDomHelper
    for (let attempt = 0; attempt < 25; attempt++) {
      const img = document.querySelector(`[data-page="${pageNum}"] img, .rpage-page[data-page="${pageNum}"] img, img[data-page="${pageNum}"]`);
      if (img?.src && img.src.startsWith('http') && !img.src.includes('data:image')) {
        return await fetchImageBuffer(pageNum, img.src, scrambleInfo);
      }
      await new Promise(r => setTimeout(r, 180));
    }

    throw new Error(`Failed to locate image source for page ${pageNum}`);
  }

  // ── Media Extraction Strategy ──────────────────────────────────────────
  async function getPageImageData(pageNum) {
    // 1. Direct API Payload Strategy (A1/A2 Fixed: Chapter-scoped)
    const currentSlug = getCurrentChapterSlug();
    const chapterPages = (currentSlug && chapterPagesMap.get(currentSlug)) || window.__cdlPages;
    const pageInfo = Array.isArray(chapterPages) ? chapterPages[pageNum - 1] : null;
    const scrambleInfo = pageInfo?.scramble || scrambleMap.get(pageNum) || null;

    if (pageInfo?.src) {
      const apiUrl = pageInfo.src;
      console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Found API payload URL -> ${apiUrl}`);
      try {
        return await fetchImageBuffer(pageNum, apiUrl, scrambleInfo);
      } catch (err) {
        console.warn(`[ComixDownloader v${VERSION}] Page ${pageNum}: API fetch failed, falling back to DOM strategy:`, err);
      }
    }

    // 2. Multi-View DOM Strategy (A5 Fixed: Clean sequential mutex chain)
    const run = domLockPromise.then(
      () => fetchPageFromDOM(pageNum, scrambleInfo),
      () => fetchPageFromDOM(pageNum, scrambleInfo)
    );
    domLockPromise = run.catch(() => {});
    return run;
  }

  // Windows reserved device names. These are invalid as filenames even when an
  // extension is appended (CON.txt, NUL.zip, ...), and the match is case-insensitive.
  const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  function getTitle() {
    let title = '';
    const endingTitle = document.querySelector('.rpage-chap-ending__title');
    const endingMeta = document.querySelector('.rpage-chap-ending__meta');
    if (endingTitle && endingTitle.textContent) {
      title = endingTitle.textContent.trim();
      if (endingMeta && endingMeta.textContent) {
        const chMatch = endingMeta.textContent.match(/Ch\.\s*\d+/i);
        if (chMatch) title += ` ${chMatch[0]}`;
      }
    }
    if (!title) {
      title = document.title || '';
      title = title.replace(/-\s*Comix.*/i, '').replace(/\|.*/, '').trim();
    }
    // Strip characters Windows forbids, then trim leading/trailing whitespace
    // and any trailing dots (e.g. "Chapter 1..." -> "Chapter 1").
    let safe = title.replace(/[\/\\?%*:|"<>]/g, '_').trim().replace(/\.+$/, '');

    // Prefix reserved device names so the ZIP stays saveable on Windows.
    // Only the stem is tested, since "CON.txt" is reserved too.
    if (WINDOWS_RESERVED_NAME.test(safe.split('.')[0])) {
      safe = `_${safe}`;
    }

    return safe || `Comix_Chapter_${Date.now()}`;
  }

  function getTotalPages() {
    const currentSlug = getCurrentChapterSlug();
    const chapterPages = (currentSlug && chapterPagesMap.get(currentSlug)) || window.__cdlPages;
    if (Array.isArray(chapterPages) && chapterPages.length > 0) {
      return chapterPages.length;
    }
    const pageEls = document.querySelectorAll('.rpage-page, .swiper-slide, .rpage-slide');
    const segEls = document.querySelectorAll('.rpage-progress__seg');
    let maxPageData = 0;
    document.querySelectorAll('[data-page]').forEach(el => {
      const p = parseInt(el.getAttribute('data-page'), 10);
      if (p > maxPageData) maxPageData = p;
    });
    let counterMax = 0;
    const counterEl = document.querySelector('.rpage-page__counter');
    if (counterEl && counterEl.textContent) {
      const m = counterEl.textContent.match(/\/\s*(\d+)/);
      if (m) counterMax = parseInt(m[1], 10);
    }
    return Math.max(pageEls.length, segEls.length, maxPageData, counterMax);
  }

  function scanScriptsForPages() {
    const currentSlug = getCurrentChapterSlug();
    const chapterPages = (currentSlug && chapterPagesMap.get(currentSlug)) || window.__cdlPages;
    if (Array.isArray(chapterPages) && chapterPages.length > 0) return;
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      if (s.textContent && s.textContent.includes('"pages"')) {
        tryCaptureApiPages(s.textContent);
        if (Array.isArray(chapterPagesMap.get(currentSlug)) && chapterPagesMap.get(currentSlug).length > 0) break;
      }
    }
  }

  // ── Initialization ─────────────────────────────────────────────────────
  function checkAndInit() {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      initialized = false;
      scrambleMap.clear(); // A3 Fixed: prevent scramble seed cross-contamination between chapters
      const currentSlug = getCurrentChapterSlug();
      window.__cdlPages = currentSlug && chapterPagesMap.has(currentSlug) ? chapterPagesMap.get(currentSlug) : null;
      if (typeof ImageDownloader?.reset === 'function') {
        try { ImageDownloader.reset(); } catch (_) {}
      }
    }

    const isReaderPage = /\/title\/[^\/]+\/[^\/]+/.test(location.pathname) || !!document.querySelector('.rpage-main, .rpage-page, .swiper-container, .swiper-wrapper');
    if (!isReaderPage || initialized) return;

    scanScriptsForPages();

    const totalPages = getTotalPages();
    if (totalPages === 0) return;
    initialized = true;

    const title = getTitle();
    console.log(`[ComixDownloader v${VERSION}] Initialized. ${totalPages} pages found. Title: "${title}"`);

    ImageDownloader.init({
      maxImageAmount: totalPages,
      title: title,
      imageSuffix: 'png',
      getImagePromises: (startNum, endNum) => {
        const promises = [];
        for (let p = startNum; p <= endNum; p++) {
          promises.push(
            getPageImageData(p)
              .then(ImageDownloader.fulfillHandler)
              .catch(err => {
                console.error(`[ComixDownloader v${VERSION}] Page ${p} failed:`, err);
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
