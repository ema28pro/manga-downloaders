// ==UserScript==
// @name         MangaPlazaDownloader
// @namespace    https://github.com/Timesient/manga-download-scripts
// @version      1.0
// @license      GPL-3.0
// @author       Timesient
// @description  Manga downloader for mangaplaza.com
// @icon         https://mangaplaza.com/favicon.ico
// @match        https://mangaplaza.com/*
// @match        https://*.mangaplaza.com/*
// @require      https://unpkg.com/axios@0.27.2/dist/axios.min.js
// @require      https://unpkg.com/jszip@3.7.1/dist/jszip.min.js
// @require      https://unpkg.com/file-saver@2.0.5/dist/FileSaver.min.js
// @require      https://update.greasyfork.org/scripts/451810/1398192/ImageDownloaderLib.js
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(async function(axios, JSZip, saveAs, ImageDownloader) {
  'use strict';

  let initialized = false;
  const checkAndInit = () => {
    let pageEls = Array.from(document.querySelectorAll('.rpage-page, .page-container, .reader-page, [data-page], .viewer-page'));
    if (pageEls.length === 0) {
      pageEls = Array.from(document.querySelectorAll('main img, #reader img, .reader img'));
    }
    if (pageEls.length > 0 && !initialized) {
      initialized = true;
      const title = document.title.replace(/\|.*/, '').trim() || 'MangaPlaza';

      ImageDownloader.init({
        maxImageAmount: pageEls.length,
        title: title,
        getImagePromises: (startNum, endNum) => {
          const promises = [];
          for (let i = startNum - 1; i < endNum; i++) {
            promises.push(getPageImageData(pageEls[i]));
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
        responseType: 'arraybuffer',
        onload: res => resolve(res.response),
        onerror: err => reject(err)
      });
    });
  }

})(axios, JSZip, saveAs, ImageDownloader);
