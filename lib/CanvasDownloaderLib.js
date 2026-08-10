/*
 * CanvasDownloaderLib
 * Helper library for converting HTML5 Canvas elements to ArrayBuffer / Blob and preventing canvas tainting.
 */

;const CanvasDownloader = (() => {
  'use strict';

  /**
   * Safely converts an HTMLCanvasElement to an ArrayBuffer (PNG/JPEG)
   * @param {HTMLCanvasElement} canvas 
   * @param {string} mimeType 
   * @returns {Promise<ArrayBuffer|null>}
   */
  async function canvasToBuffer(canvas, mimeType = 'image/png') {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;

    // Attempt 1: canvas.toBlob
    if (canvas.toBlob) {
      try {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType));
        if (blob && blob.size > 500) {
          return await blob.arrayBuffer();
        }
      } catch (e) {
        console.warn('[CanvasDownloader] canvas.toBlob failed (canvas may be tainted):', e);
      }
    }

    // Attempt 2: canvas.toDataURL -> base64 decode
    try {
      const dataUrl = canvas.toDataURL(mimeType);
      return dataUrlToBuffer(dataUrl);
    } catch (e) {
      console.warn('[CanvasDownloader] canvas.toDataURL failed (canvas may be tainted):', e);
    }

    return null;
  }

  /**
   * Converts a base64 Data URL string to an ArrayBuffer
   * @param {string} dataUrl 
   * @returns {ArrayBuffer|null}
   */
  function dataUrlToBuffer(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    try {
      const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const bin = atob(b64);
      const len = bin.length;
      if (len < 100) return null;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return bytes.buffer;
    } catch (_) {
      return null;
    }
  }

  /**
   * Intercepts HTMLImageElement.src to enable CORS (crossOrigin = 'anonymous') on remote images
   */
  function enableImageCORS() {
    try {
      const origSrcSetter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      if (origSrcSetter && origSrcSetter.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
          get: function() { return origSrcSetter.get.call(this); },
          set: function(url) {
            if (url && typeof url === 'string' && url.startsWith('http') && !this.crossOrigin) {
              this.crossOrigin = 'anonymous';
            }
            return origSrcSetter.set.call(this, url);
          },
          configurable: true,
          enumerable: true
        });
      }
    } catch (_) {}
  }

  return {
    canvasToBuffer,
    dataUrlToBuffer,
    enableImageCORS
  };
})();
