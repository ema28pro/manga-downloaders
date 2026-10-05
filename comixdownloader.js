// ==UserScript==
// @name         ComixDownloader
// @namespace    https://github.com/ema28pro/manga-downloaders
// @version      7.8
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

  const VERSION = '7.8';
  let initialized = false;
  let currentUrl = location.href;

  const scrambleMap = new Map();

  // ── Encrypted API Payload Interceptor ─────────────────────────────────
  const tryCaptureApiPages = (str) => {
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
            scrambleMap.set(i + 1, scramble);
          }
          list.push({ src: fullUrl, index: i + 1, scramble });
        }
      }

      if (list.length > 0) {
        window.__cdlPages = list;
        console.log(`[ComixDownloader v${VERSION}] Intercepted ${list.length} pages directly from API payload!`);
      }
    } catch (_) {}
  };

  if (window.TextDecoder && window.TextDecoder.prototype) {
    const origDecode = window.TextDecoder.prototype.decode;
    window.TextDecoder.prototype.decode = function(...args) {
      const res = origDecode.apply(this, args);
      tryCaptureApiPages(res);
      return res;
    };
  }

  const origAtob = window.atob;
  window.atob = function(str) {
    const res = origAtob.call(window, str);
    tryCaptureApiPages(str);
    return res;
  };

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

  if (window.fetch) {
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const res = await origFetch.apply(this, args);
      try {
        const clone = res.clone();
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        if (url && (url.includes('wowpic') || url.includes('/i5/') || url.includes('/i4/'))) {
          captureHeaders(url, res.headers.get('x-scramble-seed'), res.headers.get('x-scramble-grid'), res.headers.get('x-scramble-hash'));
        }
        clone.text().then(text => tryCaptureApiPages(text)).catch(() => {});
      } catch (_) {}
      return res;
    };
  }

  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    const origOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.addEventListener('load', function() {
        try {
          if (url && typeof url === 'string') {
            if (url.includes('wowpic') || url.includes('/i5/') || url.includes('/i4/')) {
              captureHeaders(url, this.getResponseHeader('x-scramble-seed'), this.getResponseHeader('x-scramble-grid'), this.getResponseHeader('x-scramble-hash'));
            }
            if (this.responseText) {
              tryCaptureApiPages(this.responseText);
            }
          }
        } catch (_) {}
      });
      return origOpen.call(this, method, url, ...rest);
    };
  }

  // ── Permutation Generator (Main Thread & Fallbacks) ────────────────────
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

  // ── Web Worker + OffscreenCanvas Multi-Variant Auto Unscrambler ───────
  const WORKER_CODE = `
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

    function makeScramblePermutation(seed, count, initConst) {
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

    self.onmessage = async (e) => {
      try {
        const { buffer, seed, cols, rows, hash } = e.data;
        const blob = new Blob([buffer]);
        const bitmap = await createImageBitmap(blob);
        const W = bitmap.width;
        const H = bitmap.height;

        const tileW = Math.floor(W / cols);
        const tileH = Math.floor(H / rows);
        const count = cols * rows;

        const candidates = seed > 0 ? getScrambleInitCandidates(hash) : [0xe42f];
        const multi = count > 1 && candidates.length > 1;

        let bestCanvas = null;
        let bestScore = Infinity;

        for (const initConst of candidates) {
          const canvas = new OffscreenCanvas(W, H);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bitmap, 0, 0);

          if (seed > 0) {
            const perm = makeScramblePermutation(seed, count, initConst);
            for (let i = 0; i < count; i++) {
              const srcX = (i % cols) * tileW;
              const srcY = Math.floor(i / cols) * tileH;
              const dstIndex = perm[i];
              const dstX = (dstIndex % cols) * tileW;
              const dstY = Math.floor(dstIndex / cols) * tileH;
              ctx.drawImage(bitmap, srcX, srcY, tileW, tileH, dstX, dstY, tileW, tileH);
            }
          }

          const score = multi ? scrambleSeamScore(ctx, tileW * cols, tileH * rows, tileW, tileH, cols, rows) : 0;
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

    const W = bitmap.width;
    const H = bitmap.height;
    const tileW = Math.floor(W / cols);
    const tileH = Math.floor(H / rows);
    const count = cols * rows;

    const candidates = seed > 0 ? getScrambleInitCandidates(hash) : [0xe42f];
    const initConst = candidates[0] || 0xe42f;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(bitmap, 0, 0);

    if (seed > 0) {
      const perm = makeScramblePermutation(seed, count, initConst);
      for (let i = 0; i < count; i++) {
        const srcX = (i % cols) * tileW;
        const srcY = Math.floor(i / cols) * tileH;
        const dstIndex = perm[i];
        const dstX = (dstIndex % cols) * tileW;
        const dstY = Math.floor(dstIndex / cols) * tileH;
        ctx.drawImage(bitmap, srcX, srcY, tileW, tileH, dstX, dstY, tileW, tileH);
      }
    }

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

  // ── Network Fetcher (Cloudflare Anti-403 Multi-Tier Bypass) ─────────────
  function requestImageBinary(pageNum, url) {
    return new Promise((resolve, reject) => {
      const fetchFn = typeof window.fetch === 'function' ? window.fetch : unsafeWindow?.fetch;

      // 1. Primary: Native fetch with CORS & no-referrer (Runs purely in page context without Tampermonkey @connect popups)
      if (fetchFn) {
        fetchFn(url, {
          method: 'GET',
          referrerPolicy: 'no-referrer',
          credentials: 'omit',
          mode: 'cors'
        })
          .then(async res => {
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            const buf = await res.arrayBuffer();
            if (!buf || buf.byteLength <= 1000) throw new Error(`Invalid/empty buffer (${buf?.byteLength || 0}B)`);
            resolve({
              buffer: buf,
              headers: res.headers
            });
          })
          .catch(fetchErr => {
            console.warn(`[ComixDownloader v${VERSION}] Page ${pageNum}: Native fetch failed, trying GM_xmlhttpRequest fallback...`, fetchErr);
            tryGmFallback();
          });
      } else {
        tryGmFallback();
      }

      function tryGmFallback() {
        if (typeof GM_xmlhttpRequest !== 'function') {
          return reject(new Error(`Page ${pageNum}: fetch failed and GM_xmlhttpRequest unavailable`));
        }

        GM_xmlhttpRequest({
          method: 'GET',
          url,
          anonymous: true,
          headers: {
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
          },
          responseType: 'arraybuffer',
          onload: r => {
            if (r.status === 200 && r.response?.byteLength > 1000) {
              return resolve({
                buffer: r.response,
                headers: r.responseHeaders
              });
            }
            reject(new Error(`GM_xmlhttpRequest HTTP ${r.status}, ${r.response?.byteLength || 0}B`));
          },
          onerror: err => {
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
    if (info.seed > 0) {
      console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Unscrambling image (seed=${info.seed}, ${info.cols}x${info.rows}, hash=${info.hash || 'default'})...`);
    } else {
      console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Processing image to guaranteed PNG format...`);
    }

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
    const segBtns = document.querySelectorAll('.rpage-progress__seg');
    if (segBtns[pageNum - 1]) {
      try { segBtns[pageNum - 1].click(); } catch (_) {}
    } else {
      const segBtn = document.querySelector(`.rpage-progress__seg[title*="${pageNum}"], .rpage-progress__seg[aria-label*="${pageNum}"]`);
      if (segBtn) try { segBtn.click(); } catch (_) {}
    }

    for (let attempt = 0; attempt < 45; attempt++) {
      // 1. Broad element selection matching pageNum attribute or index
      let pageEl = document.querySelector(`[data-page="${pageNum}"]`) ||
                   document.querySelector(`.rpage-page[data-page="${pageNum}"]`);

      if (!pageEl) {
        const allPages = document.querySelectorAll('.rpage-page, .swiper-slide, .rpage-slide');
        if (allPages[pageNum - 1]) pageEl = allPages[pageNum - 1];
      }

      if (pageEl && pageEl.scrollIntoView) {
        try { pageEl.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) {}
      }

      // 2. Extract image from page element or fallback to global image query matching pageNum
      let img = pageEl ? (pageEl.tagName === 'IMG' ? pageEl : pageEl.querySelector('img')) : null;

      if (!img || !img.src) {
        const allImgs = document.querySelectorAll('.rpage-page img, .swiper-slide img, .rpage-slide img, img[data-page]');
        for (const candidateImg of allImgs) {
          const parentPage = candidateImg.closest('[data-page]');
          if (parentPage && parseInt(parentPage.getAttribute('data-page'), 10) === pageNum) {
            img = candidateImg;
            break;
          }
        }
      }

      if (img?.src && img.src.startsWith('http') && !img.src.includes('data:image')) {
        console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Found DOM <img> -> ${img.src}`);
        try {
          return await fetchImageBuffer(pageNum, img.src, scrambleInfo);
        } catch (fetchErr) {
          // Extra Fallback: Draw loaded DOM image to canvas if network fetch fails
          if (img.complete && img.naturalWidth > 0) {
            console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Network fetch failed, capturing DOM <img> via canvas...`);
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
              if (blob && blob.size > 1000) {
                const rawBuf = await blob.arrayBuffer();
                const info = scrambleInfo || { seed: 0, cols: 5, rows: 5, hash: '' };
                return await unscrambleImageBlob(rawBuf, info);
              }
            } catch (canvasErr) {
              console.warn(`[ComixDownloader v${VERSION}] Page ${pageNum}: DOM canvas capture failed:`, canvasErr);
            }
          }
          throw fetchErr;
        }
      }

      await new Promise(r => setTimeout(r, 150));
    }

    throw new Error(`Failed to locate image source for page ${pageNum}`);
  }

  // ── Media Extraction Strategy ──────────────────────────────────────────
  async function getPageImageData(pageNum) {
    // 1. Direct API Payload Strategy
    const pageInfo = Array.isArray(window.__cdlPages) ? window.__cdlPages[pageNum - 1] : null;
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

    // 2. Multi-View DOM Strategy (Serialized via Mutex to prevent race conditions when 4 promises run concurrently)
    domLockPromise = domLockPromise.then(() => fetchPageFromDOM(pageNum, scrambleInfo)).catch(() => fetchPageFromDOM(pageNum, scrambleInfo));
    return domLockPromise;
  }

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
    return title.replace(/[\/\\?%*:|"<>]/g, '_').trim() || `Comix_Chapter_${Date.now()}`;
  }

  function getTotalPages() {
    if (Array.isArray(window.__cdlPages) && window.__cdlPages.length > 0) {
      return window.__cdlPages.length;
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
    if (Array.isArray(window.__cdlPages) && window.__cdlPages.length > 0) return;
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      if (s.textContent && s.textContent.includes('"pages"')) {
        tryCaptureApiPages(s.textContent);
        if (Array.isArray(window.__cdlPages) && window.__cdlPages.length > 0) break;
      }
    }
  }

  // ── Initialization ─────────────────────────────────────────────────────
  function checkAndInit() {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      initialized = false;
      window.__cdlPages = null; // Clear pages from previous chapter
      if (typeof ImageDownloader?.reset === 'function') {
        ImageDownloader.reset();
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
