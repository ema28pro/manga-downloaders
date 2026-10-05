/**
 * ComixDomHelper - DOM Fallback & Element Extraction Library
 * Proporciona rescate y extracción de imágenes del DOM para comix.to cuando
 * la intercepción directa de la API de Next.js no esté disponible.
 */
(function(global) {
  'use strict';

  async function fetchPageFromDOM(pageNum, scrambleInfo, fetchImageBufferFn, unscrambleImageBlobFn, version = '7.9') {
    const segBtns = document.querySelectorAll('.rpage-progress__seg');
    if (segBtns[pageNum - 1]) {
      try { segBtns[pageNum - 1].click(); } catch (_) {}
    } else {
      const segBtn = document.querySelector(`.rpage-progress__seg[title*="${pageNum}"], .rpage-progress__seg[aria-label*="${pageNum}"]`);
      if (segBtn) try { segBtn.click(); } catch (_) {}
    }

    for (let attempt = 0; attempt < 40; attempt++) {
      // 1. Selección amplia de elemento de página
      let pageEl = document.querySelector(`[data-page="${pageNum}"]`) ||
                   document.querySelector(`.rpage-page[data-page="${pageNum}"]`);

      if (!pageEl) {
        const allPages = document.querySelectorAll('.rpage-page, .swiper-slide, .rpage-slide');
        if (allPages[pageNum - 1]) pageEl = allPages[pageNum - 1];
      }

      if (pageEl && pageEl.scrollIntoView) {
        try { pageEl.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) {}
      }

      // 2. Extraer imagen del elemento
      let img = pageEl ? (pageEl.tagName === 'IMG' ? pageEl : pageEl.querySelector('img')) : null;

      if (!img || !img.src) {
        const allImgs = document.querySelectorAll('.rpage-page img, .swiper-slide img, .rpage-slide img, img[data-page]');
        for (const candidateImg of allImgs) {
          const parentPage = candidateImg.closest('[data-page]');
          if (parentPage && parseInt(parentPage.getAttribute('data-page'), 10) === pageNum) {
            img = candidateImg;
            break;
          }
        }
      }

      if (img?.src && img.src.startsWith('http') && !img.src.includes('data:image')) {
        console.log(`[ComixDomHelper v${version}] Page ${pageNum}: Found DOM <img> -> ${img.src}`);
        try {
          return await fetchImageBufferFn(pageNum, img.src, scrambleInfo);
        } catch (fetchErr) {
          // Fallback final: Canvas screenshot del <img> visible
          if (img.complete && img.naturalWidth > 0) {
            console.log(`[ComixDomHelper v${version}] Page ${pageNum}: Network fetch failed, capturing DOM <img> via canvas...`);
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
              if (blob && blob.size > 1000) {
                const rawBuf = await blob.arrayBuffer();
                const info = scrambleInfo || { seed: 0, cols: 5, rows: 5, hash: '' };
                return await unscrambleImageBlobFn(rawBuf, info);
              }
            } catch (canvasErr) {
              console.warn(`[ComixDomHelper v${version}] Page ${pageNum}: Canvas fallback failed:`, canvasErr);
            }
          }
          throw fetchErr;
        }
      }

      await new Promise(r => setTimeout(r, 150));
    }

    throw new Error(`Failed to locate image source for page ${pageNum} in DOM`);
  }

  global.ComixDomHelper = {
    fetchPageFromDOM
  };

})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
