// ==UserScript==
// @name         MangaPlazaDownloader
// @namespace    https://github.com/ema28pro/manga-downloaders
// @version      1.1
// @license      GPL-3.0
// @author       ema28pro
// @description  Manga downloader for mangaplaza.com
// @icon         https://mangaplaza.com/favicon.ico
// @homepageURL  https://github.com/ema28pro/manga-downloaders
// @supportURL   https://github.com/ema28pro/manga-downloaders/issues
// @downloadURL  https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangaplazadownloader.js
// @updateURL    https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangaplazadownloader.js
// @match        https://mangaplaza.com/*
// @match        https://*.mangaplaza.com/*
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
    const pageEls = Array.from(document.querySelectorAll('.viewer-page, [class*="viewer-page"], .page-img'));
    if (pageEls.length > 0 && !initialized) {
      initialized = true;
      ImageDownloader.init({
        maxImageAmount: pageEls.length,
        title: document.title.replace(/\|.*/, '').trim() || 'MangaPlaza',
        getImagePromises: (startNum, endNum) => {
          const promises = [];
          for (let i = startNum - 1; i < endNum; i++) {
            promises.push(getPageImageData(pageEls[i])
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
  setInterval(checkAndInit, 1000);
  window.addEventListener('popstate', () => { initialized = false; });

  async function getPageImageData(el) {
    if (!el) throw new Error('Page element not found');

    if (el.tagName === 'IMG' && el.src && el.src.startsWith('http')) {
      return getImage(el.src);
    }

    if (el.scrollIntoView) {
      el.scrollIntoView({ block: 'center' });
    }

    for (let attempt = 0; attempt < 30; attempt++) {
      const img = el.tagName === 'IMG' ? el : el.querySelector('img');
      if (img && img.src && img.src.startsWith('http')) {
        return getImage(img.src);
      }
      const canvas = el.tagName === 'CANVAS' ? el : el.querySelector('canvas');
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const binaryStr = atob(base64Data);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        return bytes.buffer;
      }
      await new Promise(r => setTimeout(r, 200));
    }

    throw new Error('Timeout waiting for page image content');
  }

  function getImage(url) {
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
            reject(new Error(`Failed to fetch image (status ${res.status})`));
          }
        },
        onerror: err => reject(err)
      });
    });
  }

})(axios, JSZip, saveAs, ImageDownloader);
