// ==UserScript==
// @name         ComixDownloader
// @namespace    https://github.com/ema28pro/manga-downloaders
// @version      1.2
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

  let initialized = false;

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

      console.log(`[ComixDownloader] Initialized with ${totalPages} total pages.`);

      ImageDownloader.init({
        maxImageAmount: totalPages,
        title: title,
        getImagePromises: (startNum, endNum) => {
          const promises = [];
          for (let i = startNum - 1; i < endNum; i++) {
            const pageNum = i + 1;
            promises.push(
              getPageImageData(pageNum)
                .then(ImageDownloader.fulfillHandler)
                .catch(ImageDownloader.rejectHandler)
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
    // 1. Try to find the page element by data-page="X" attribute
    let pageEl = document.querySelector(`.rpage-page[data-page="${pageNum}"]`);

    // 2. Find progress segment button (by title, aria-label, or nth-child index)
    const segBtn = document.querySelector(`.rpage-progress__seg[title="Page ${pageNum}"], .rpage-progress__seg[aria-label="Go to page ${pageNum}"], .rpage-progress .rpage-progress__seg:nth-child(${pageNum})`);

    if (segBtn && !pageEl) {
      segBtn.click();
      await new Promise(r => setTimeout(r, 150));
      pageEl = document.querySelector(`.rpage-page[data-page="${pageNum}"]`);
    }

    if (pageEl && pageEl.scrollIntoView) {
      pageEl.scrollIntoView({ block: 'center', inline: 'center' });
    }

    // 3. Poll up to 40 attempts (8 seconds total) for img tag or canvas
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!pageEl) {
        pageEl = document.querySelector(`.rpage-page[data-page="${pageNum}"]`);
      }

      if (pageEl) {
        const img = pageEl.tagName === 'IMG' ? pageEl : pageEl.querySelector('img');
        if (img && img.src && img.src.startsWith('http') && !img.src.includes('data:image')) {
          return fetchImageWithRetry(img.src);
        }

        const canvas = pageEl.tagName === 'CANVAS' ? pageEl : pageEl.querySelector('canvas');
        if (canvas) {
          const dataUrl = canvas.toDataURL('image/png');
          const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
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
      }

      // If page is still unmounted or loading, click progress seg every 5 attempts to trigger Swiper/virtual mount
      if (attempt % 5 === 0 && segBtn) {
        segBtn.click();
        if (pageEl && pageEl.scrollIntoView) {
          pageEl.scrollIntoView({ block: 'center', inline: 'center' });
        }
      }

      await new Promise(r => setTimeout(r, 200));
    }

    throw new Error(`Timeout loading image for page ${pageNum}`);
  }

  async function fetchImageWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const data = await fetchImageBuffer(url);
        if (data && data.byteLength > 1000) {
          return data;
        }
      } catch (e) {
        if (i === retries - 1) throw e;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Failed to fetch image data for ${url}`);
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
