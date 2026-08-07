// ==UserScript==
// @name         MangaDexDownloader
// @namespace    https://github.com/Timesient/manga-download-scripts
// @version      1.1
// @license      GPL-3.0
// @author       Timesient
// @description  Manga downloader for mangadex.org
// @icon         https://mangadex.org/favicon.ico
// @match        https://mangadex.org/*
// @match        https://*.mangadex.org/*
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
    let pageEls = Array.from(document.querySelectorAll('.md--page, [class*="md--page"]'));
    if (pageEls.length === 0) {
      pageEls = Array.from(document.querySelectorAll('.reader img, img[src*="blob:"], img.img'));
    }

    if (pageEls.length > 0 && !initialized) {
      initialized = true;

      const title = document.title.replace(/\|.*/, '').trim() || 'MangaDex';

      ImageDownloader.init({
        maxImageAmount: pageEls.length,
        title: title,
        getImagePromises: (startNum, endNum) => {
          const promises = [];
          for (let i = startNum - 1; i < endNum; i++) {
            promises.push(
              getPageImage(pageEls[i])
                .then(data => typeof ImageDownloader.fulfillHandler === 'function' ? ImageDownloader.fulfillHandler(data) : data)
                .catch(err => typeof ImageDownloader.rejectHandler === 'function' ? ImageDownloader.rejectHandler(err) : Promise.reject(err))
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

    if (pageEl.scrollIntoView) {
      pageEl.scrollIntoView({ block: 'center' });
    }

    for (let attempt = 0; attempt < 30; attempt++) {
      const img = pageEl.tagName === 'IMG' ? pageEl : pageEl.querySelector('img');
      if (img && img.src) {
        if (img.src.startsWith('blob:')) {
          const res = await fetch(img.src);
          return await res.arrayBuffer();
        } else if (img.src.startsWith('http')) {
          return fetchImageData(img.src);
        }
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
