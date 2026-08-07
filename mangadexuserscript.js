// ==UserScript==
// @name         MangaDexUserScript
// @namespace    https://github.com/Timesient/manga-download-scripts
// @version      2.1
// @license      GPL-3.0
// @author       ema28pro
// @description  Standalone Manga Downloader for MangaDex using official API
// @icon         https://mangadex.org/favicon.ico
// @homepageURL  https://github.com/ema28pro/manga-downloaders
// @supportURL   https://github.com/ema28pro/manga-downloaders/issues
// @downloadURL  https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangadexuserscript.js
// @updateURL    https://raw.githubusercontent.com/ema28pro/manga-downloaders/main/mangadexuserscript.js
// @match        https://mangadex.org/chapter/*
// @match        https://*.mangadex.org/chapter/*
// @require      https://unpkg.com/axios@0.27.2/dist/axios.min.js
// @require      https://unpkg.com/jszip@3.7.1/dist/jszip.min.js
// @require      https://unpkg.com/file-saver@2.0.5/dist/FileSaver.min.js
// @require      https://update.greasyfork.org/scripts/451810/ImageDownloaderLib.js
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(async function(axios, JSZip, saveAs, ImageDownloader) {
  'use strict';

  // Bypass TrustedTypes TrustedHTML restriction on MangaDex
  if (typeof window !== 'undefined' && window.trustedTypes) {
    try {
      if (!window.trustedTypes.defaultPolicy) {
        window.trustedTypes.createPolicy('default', {
          createHTML: string => string,
          createScript: string => string,
          createScriptURL: url => url
        });
      }
    } catch (e) {
      // If default policy exists or creation blocked, patch innerHTML setter safely
      try {
        const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        if (desc && desc.set) {
          const origSet = desc.set;
          const policy = window.trustedTypes.createPolicy('mdInnerHtmlPolicy', { createHTML: s => s });
          Object.defineProperty(Element.prototype, 'innerHTML', {
            set: function(val) {
              return origSet.call(this, typeof val === 'string' && policy ? policy.createHTML(val) : val);
            },
            get: desc.get,
            configurable: true,
            enumerable: true
          });
        }
      } catch (err) {}
    }
  }

  let currentChapterId = '';

  async function initMangaDex() {
    const match = window.location.pathname.match(/\/chapter\/([a-f0-9-]+)/i);
    if (!match) return;

    const chapterId = match[1];
    if (chapterId === currentChapterId) return;
    currentChapterId = chapterId;

    try {
      // 1. Fetch chapter At-Home server data from official API
      const atHomeRes = await axios.get(`https://api.mangadex.org/at-home/server/${chapterId}`);
      const baseUrl = atHomeRes.data.baseUrl;
      const hash = atHomeRes.data.chapter.hash;
      const files = atHomeRes.data.chapter.data;

      if (!files || files.length === 0) return;

      const imageUrls = files.map(filename => `${baseUrl}/data/${hash}/${filename}`);

      // 2. Fetch chapter metadata (manga title, chapter number)
      let title = document.title.replace(/\|.*/, '').trim() || 'MangaDex Chapter';
      try {
        const metaRes = await axios.get(`https://api.mangadex.org/chapter/${chapterId}?includes[]=manga`);
        const chData = metaRes.data.data.attributes;
        const mangaRel = metaRes.data.data.relationships.find(r => r.type === 'manga');
        const mangaTitle = mangaRel?.attributes?.title?.en || Object.values(mangaRel?.attributes?.title || {})[0] || 'Manga';
        const chNum = chData.chapter ? `Ch.${chData.chapter}` : '';
        const chTitle = chData.title ? `- ${chData.title}` : '';
        title = `${mangaTitle} ${chNum} ${chTitle}`.trim();
      } catch (e) {}

      // 3. Setup ImageDownloader UI
      ImageDownloader.init({
        maxImageAmount: imageUrls.length,
        title: title,
        getImagePromises: (startNum, endNum) => {
          return imageUrls
            .slice(startNum - 1, endNum)
            .map(url => fetchImage(url));
        }
      });
    } catch (err) {
      console.error('MangaDexUserScript error:', err);
    }
  }

  function fetchImage(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        headers: {
          'Referer': 'https://mangadex.org/'
        },
        responseType: 'arraybuffer',
        onload: res => {
          if (res.status === 200 && res.response && res.response.byteLength > 1000) {
            resolve(res.response);
          } else {
            reject(new Error(`Failed to fetch image: status ${res.status}`));
          }
        },
        onerror: err => reject(err)
      });
    });
  }

  initMangaDex();
  setInterval(initMangaDex, 2000);
  window.addEventListener('popstate', () => { currentChapterId = ''; initMangaDex(); });

})(axios, JSZip, saveAs, ImageDownloader);
