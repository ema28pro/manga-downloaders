// ==UserScript==
// @name         WelomaDownloader
// @namespace    https://github.com/ema28pro/manga-downloaders
// @version      1.0
// @license      GPL-3.0
// @author       ema28pro
// @description  Manga downloader for weloma.net
// @icon         https://weloma.net/favicon.ico
// @homepageURL  https://github.com/ema28pro/manga-downloaders
// @supportURL   https://github.com/ema28pro/manga-downloaders/issues
// @downloadURL  https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/welomadownloader.js
// @updateURL    https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/welomadownloader.js
// @match        https://weloma.net/*
// @match        https://*.weloma.net/*
// @match        https://weloma.art/*
// @match        https://*.weloma.art/*
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
    let pageEls = Array.from(document.querySelectorAll('#chapter-images img.chapter-img, .chapter-content img.chapter-img, #chapter-images img'));

    if (pageEls.length > 0 && !initialized) {
      initialized = true;

      const title = getTitle();

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

  function getTitle() {
    let rawTitle = document.title || '';
    rawTitle = rawTitle.replace(/-\s*weloma.*/i, '').replace(/\|.*/, '').trim();
    if (!rawTitle) {
      const breadcrumbLast = document.querySelector('.breadcrumb li:last-child span');
      if (breadcrumbLast) {
        rawTitle = breadcrumbLast.textContent.trim();
      }
    }
    return rawTitle || 'Weloma Manga';
  }

  checkAndInit();
  setInterval(checkAndInit, 1500);
  window.addEventListener('popstate', () => { initialized = false; });

  async function getPageImage(pageEl) {
    if (!pageEl) throw new Error('Page element not found');

    let imageUrl = getSrcFromElement(pageEl);

    if (!imageUrl && pageEl.scrollIntoView) {
      pageEl.scrollIntoView({ block: 'center' });
    }

    for (let attempt = 0; attempt < 30; attempt++) {
      imageUrl = getSrcFromElement(pageEl);
      if (imageUrl && imageUrl.startsWith('http')) {
        return fetchImageData(imageUrl);
      }
      await new Promise(r => setTimeout(r, 200));
    }

    throw new Error('Timeout waiting for page image content');
  }

  function getSrcFromElement(el) {
    if (!el) return null;
    const imgTag = el.tagName === 'IMG' ? el : el.querySelector('img');
    if (!imgTag) return null;

    const dataImg = imgTag.getAttribute('data-img');
    if (dataImg) {
      try {
        const decoded = atob(dataImg);
        if (decoded.startsWith('http')) return decoded;
      } catch (e) {}
    }

    if (imgTag.src && imgTag.src.startsWith('http') && !imgTag.src.startsWith('data:image/gif')) {
      return imgTag.src;
    }

    return null;
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
