// ==UserScript==
// @name         MangaFireDownloader
// @namespace    https://github.com/Timesient/manga-download-scripts
// @version      1.0
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
    const imgEls = Array.from(document.querySelectorAll('.reader-img, img.reader-swiper__img, .swiper-wrapper img'));
    if (imgEls.length > 0 && !initialized) {
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

      const urls = imgEls.map(img => img.src || img.getAttribute('data-src')).filter(src => src && src.startsWith('http'));
      const uniqueUrls = Array.from(new Set(urls));

      ImageDownloader.init({
        maxImageAmount: uniqueUrls.length,
        title: title,
        getImagePromises: (startNum, endNum) => {
          return uniqueUrls
            .slice(startNum - 1, endNum)
            .map(url => getImage(url));
        }
      });
    }
  };

  checkAndInit();
  setInterval(checkAndInit, 1000);
  window.addEventListener('popstate', () => { initialized = false; });

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
