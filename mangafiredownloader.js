// ==UserScript==
// @name         MangaFireDownloader
// @namespace    https://github.com/Timesient/manga-download-scripts
// @version      1.1
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

  const checkAndInit = async () => {
    let imgEls = document.querySelectorAll('.reader-img, img.reader-swiper__img, .swiper-wrapper img');
    if (imgEls.length > 0 && !initialized) {
      initialized = true;

      // Force Swiper to load all lazy-loaded page images
      const segs = document.querySelectorAll('.reader-progress__seg');
      if (segs.length > 0) {
        for (let i = 0; i < segs.length; i++) {
          segs[i].click();
          await new Promise(r => setTimeout(r, 40));
        }
        segs[0]?.click();
      }

      // Collect all loaded image URLs
      imgEls = document.querySelectorAll('.reader-img, img.reader-swiper__img, .swiper-wrapper img');
      const urls = Array.from(imgEls)
        .map(img => img.src || img.getAttribute('data-src'))
        .filter(src => src && src.startsWith('http'));
      const uniqueUrls = Array.from(new Set(urls));

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
        maxImageAmount: uniqueUrls.length,
        title: title,
        getImagePromises: (startNum, endNum) => {
          return uniqueUrls
            .slice(startNum - 1, endNum)
            .map(url => getImage(url)
              .then(ImageDownloader.fulfillHandler)
              .catch(ImageDownloader.rejectHandler)
            );
        }
      });
    }
  };

  checkAndInit();
  setInterval(checkAndInit, 1500);
  window.addEventListener('popstate', () => { initialized = false; });

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
