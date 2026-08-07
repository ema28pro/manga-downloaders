// ==UserScript==
// @name         MangaFireDownloader
// @namespace    https://github.com/Timesient/manga-download-scripts
// @version      1.2
// @license      GPL-3.0
// @author       Timesient
// @description  Manga downloader for mangafire.to
// @icon         https://mangafire.to/favicon.ico
// @match        https://mangafire.to/*
// @match        https://*.mangafire.to/*
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
    let pageEls = Array.from(document.querySelectorAll('.reader__page'));
    if (pageEls.length === 0) {
      pageEls = Array.from(document.querySelectorAll('.reader-swiper__slide, .swiper-slide'));
    }

    if (pageEls.length > 0 && !initialized) {
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

    // 1. Scroll page container into view to trigger MangaFire lazy mounting
    pageEl.scrollIntoView({ block: 'center' });

    // 2. Wait up to 6 seconds for <img> tag to appear inside pageEl
    for (let attempt = 0; attempt < 30; attempt++) {
      const img = pageEl.querySelector('img.reader-img, img.reader-swiper__img, img');
      if (img && img.src && img.src.startsWith('http')) {
        return fetchImageData(img.src);
      }
      await new Promise(r => setTimeout(r, 200));
    }

    throw new Error(`Timeout loading image for page element`);
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
