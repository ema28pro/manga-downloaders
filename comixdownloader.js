// ==UserScript==
// @name         ComixDownloader
// @namespace    https://github.com/ema28pro/manga-downloaders
// @version      1.4
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
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(async function(axios, JSZip, saveAs, ImageDownloader) {
  'use strict';

  const VERSION = '1.4';
  let initialized = false;
  let navLock = Promise.resolve();

  // Sequential navigation lock to prevent concurrent Swiper click collisions
  function withNavLock(fn) {
    const next = navLock.then(() => fn());
    navLock = next.catch(() => {});
    return next;
  }

  const checkAndInit = () => {
    if (!document.body) return;

    // Detect total pages from progress bar buttons or DOM elements
    const progressSegs = Array.from(document.querySelectorAll('.rpage-progress__seg'));
    const pageEls = Array.from(document.querySelectorAll('.rpage-page'));

    let totalPages = progressSegs.length;

    // Fallback: check title or aria-label of the last progress segment button
    if (progressSegs.length > 0) {
      const lastSeg = progressSegs[progressSegs.length - 1];
      const match = (lastSeg.getAttribute('title') || lastSeg.getAttribute('aria-label') || '').match(/(\d+)/);
      if (match) {
        totalPages = Math.max(totalPages, parseInt(match[1], 10));
      }
    }

    if (totalPages === 0) {
      totalPages = pageEls.length;
    }

    if (totalPages > 0 && !initialized) {
      initialized = true;
      let title = document.title;
      const syncEl = document.getElementById('syncData');
      if (syncEl) {
        try {
          const sync = JSON.parse(syncEl.textContent);
          if (sync.name && sync.number) {
            title = `${sync.name} - Ch.${sync.number}`;
          }
        } catch (e) {}
      }

      console.log(`[ComixDownloader v${VERSION}] Initialized successfully. Total pages found: ${totalPages}`);

      ImageDownloader.init({
        maxImageAmount: totalPages,
        title: title,
        getImagePromises: (startNum, endNum) => {
          const promises = [];
          for (let i = startNum - 1; i < endNum; i++) {
            const pageNum = i + 1;
            promises.push(
              getPageImageData(pageNum)
                .then(res => {
                  console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}/${totalPages}: Successfully processed (${res.byteLength} bytes).`);
                  return ImageDownloader.fulfillHandler(res);
                })
                .catch(err => {
                  console.error(`[ComixDownloader v${VERSION}] Page ${pageNum}/${totalPages}: FAILED ->`, err);
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
  setInterval(checkAndInit, 1500);
  window.addEventListener('popstate', () => { initialized = false; });

  async function getPageImageData(pageNum) {
    console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Requesting page data...`);
    let imageUrl = null;
    let canvasData = null;

    // Use navLock to safely navigate Swiper without concurrent click collisions
    await withNavLock(async () => {
      let pageEl = document.querySelector(`.rpage-page[data-page="${pageNum}"]`);
      let img = pageEl ? (pageEl.tagName === 'IMG' ? pageEl : pageEl.querySelector('img')) : null;
      let canvas = pageEl ? (pageEl.tagName === 'CANVAS' ? pageEl : pageEl.querySelector('canvas')) : null;

      // If image or canvas is not ready yet, click progress seg button or scroll into view
      if ((!img || !img.src || !img.src.startsWith('http') || img.src.includes('data:image')) && !canvas) {
        const segBtn = document.querySelector(
          `.rpage-progress__seg[title="Page ${pageNum}"], .rpage-progress__seg[aria-label="Go to page ${pageNum}"], .rpage-progress .rpage-progress__seg:nth-child(${pageNum})`
        );

        if (segBtn) {
          console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Navigating via segment button...`);
          segBtn.click();
        } else if (pageEl && pageEl.scrollIntoView) {
          console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Scrolling into view...`);
          pageEl.scrollIntoView({ block: 'center', inline: 'center' });
        }

        // Wait up to 5 seconds for Swiper / DOM to mount the page image or canvas
        for (let attempt = 0; attempt < 50; attempt++) {
          await new Promise(r => setTimeout(r, 100));
          pageEl = document.querySelector(`.rpage-page[data-page="${pageNum}"]`);
          if (pageEl) {
            img = pageEl.tagName === 'IMG' ? pageEl : pageEl.querySelector('img');
            canvas = pageEl.tagName === 'CANVAS' ? pageEl : pageEl.querySelector('canvas');
            if ((img && img.src && img.src.startsWith('http') && !img.src.includes('data:image')) || canvas) {
              break;
            }
          }
          if (attempt === 25 && segBtn) {
            // Re-trigger click if taking longer
            console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Re-triggering segment click...`);
            segBtn.click();
          }
        }
      }

      if (img && img.src && img.src.startsWith('http') && !img.src.includes('data:image')) {
        imageUrl = img.src;
        console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Found image URL -> ${imageUrl}`);
      } else if (canvas) {
        console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Found canvas element.`);
        canvasData = canvas.toDataURL('image/png');
      }
    });

    // 1. Process canvas if present
    if (canvasData) {
      const base64Data = canvasData.replace(/^data:image\/\w+;base64,/, '');
      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      if (bytes.buffer.byteLength > 1000) {
        return bytes.buffer;
      }
    }

    // 2. Fetch image URL with retry logic
    if (imageUrl) {
      return fetchImageWithRetry(pageNum, imageUrl);
    }

    throw new Error(`Timeout waiting for DOM mount or image source for page ${pageNum}`);
  }

  async function fetchImageWithRetry(pageNum, url, retries = 4) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[ComixDownloader v${VERSION}] Page ${pageNum}: Downloading image binary (Attempt ${attempt}/${retries})...`);
        const data = await fetchImageBuffer(url);
        if (data && data.byteLength > 1000) {
          return data;
        }
        console.warn(`[ComixDownloader v${VERSION}] Page ${pageNum}: Received incomplete image payload (${data ? data.byteLength : 0} bytes). Retrying...`);
      } catch (e) {
        console.warn(`[ComixDownloader v${VERSION}] Page ${pageNum}: Attempt ${attempt} failed -> ${e.message}`);
        if (attempt === retries) throw e;
      }
      await new Promise(r => setTimeout(r, 600 * attempt));
    }
    throw new Error(`Failed to fetch valid image data for page ${pageNum}`);
  }

  function fetchImageBuffer(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        headers: {
          'Referer': window.location.href,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        },
        responseType: 'arraybuffer',
        onload: res => {
          if (res.status === 200 && res.response && res.response.byteLength > 1000) {
            resolve(res.response);
          } else {
            reject(new Error(`HTTP status ${res.status}, size ${res.response ? res.response.byteLength : 0}B`));
          }
        },
        onerror: err => reject(err)
      });
    });
  }

})(axios, JSZip, saveAs, ImageDownloader);
