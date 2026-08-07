// ==UserScript==
// @name         LMTOSDownloader
// @namespace    https://github.com/Timesient/manga-download-scripts
// @version      1.0
// @license      GPL-3.0
// @author       Timesient
// @description  Manga downloader for lmtos.net
// @icon         https://lmtos.net/favicon.ico
// @match        https://lmtos.net/*
// @match        https://*.lmtos.net/*
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
    let pageEls = Array.from(document.querySelectorAll('.reader-page-frame, [id^="reader-page-"]'));
    if (pageEls.length === 0) {
      pageEls = Array.from(document.querySelectorAll('.reader-page-frame img, img[src*="img.lmtos.net"]'));
    }

    if (pageEls.length > 0 && !initialized) {
      initialized = true;

      const title = document.title.replace(/\|.*/, '').trim() || 'LMTOS';

      ImageDownloader.init({
        maxImageAmount: pageEls.length,
        title: title,
        getImagePromises: (startNum, endNum) => {
          const promises = [];
          for (let i = startNum - 1; i < endNum; i++) {
            promises.push(
              getPageImage(pageEls[i])
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

  async function getPageImage(pageEl) {
    if (!pageEl) throw new Error('Page element not found');

    if (pageEl.tagName === 'IMG' && pageEl.src && pageEl.src.startsWith('http')) {
      return fetchImageData(pageEl.src);
    }

    if (pageEl.scrollIntoView) {
      pageEl.scrollIntoView({ block: 'center' });
    }

    for (let attempt = 0; attempt < 30; attempt++) {
      const img = pageEl.tagName === 'IMG' ? pageEl : pageEl.querySelector('img');
      if (img && img.src && img.src.startsWith('http')) {
        return fetchImageData(img.src);
      }
      await new Promise(r => setTimeout(r, 200));
    }

    throw new Error('Timeout waiting for page image content');
  }

  function fetchImageData(url) {
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
