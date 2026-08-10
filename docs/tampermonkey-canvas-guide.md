# Tampermonkey Sandbox & Canvas — Developer Guide

## The Problem

When a Tampermonkey userscript uses `@grant` directives (e.g., `GM_xmlhttpRequest`, `GM_download`), the script runs in an **isolated content script sandbox**. This sandbox has a different origin than the web page, which causes **canvas tainting** when drawing images created in the sandbox scope onto a page-context canvas.

This document explains the problem, its symptoms, and proven solutions.

---

## Quick Reference: Symptoms

| Symptom | Value | Meaning |
|---------|-------|---------|
| `canvas.toDataURL()` returns | 114 characters | Tainted → 1×1 transparent PNG stub |
| `canvas.toBlob()` callback receives | `null` | Tainted → export refused |
| `ctx.getImageData()` returns | All zero pixels | Tainted → blank readback |
| Downloaded file size | **69 bytes** | The decoded 1×1 PNG stub |
| Downloaded file size | **29 bytes** | Alternate minimal PNG encoding |
| Canvas visual display | **Correct** | Tainting only blocks readback, not rendering |

**Key diagnostic**: If the canvas DISPLAYS correctly but exports blank/empty data, it's a taint issue.

---

## Understanding Tampermonkey Worlds

### With `@grant none`

```javascript
// ==UserScript==
// @grant        none
// ==/UserScript==
```

- Script runs in the **page's MAIN world**
- `window` = real page window
- `new Image()` = page-origin Image
- Canvas drawing = **NOT tainted** ✅
- But: `GM_xmlhttpRequest` is **NOT available** ❌

### With `@grant GM_*`

```javascript
// ==UserScript==
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// ==/UserScript==
```

- Script runs in an **isolated sandbox world**
- `window` = proxy/wrapper (not the real page window)
- `new Image()` = sandbox-origin Image (extension origin)
- Canvas drawing = **TAINTED** ❌
- `GM_xmlhttpRequest` = **available** ✅

### The Dilemma

You need `GM_xmlhttpRequest` to bypass CORS for image fetching, but using it forces you into the sandbox, which taints any canvas you draw images onto.

### Comparison: Manifest V3 Browser Extensions vs Userscript Sandbox

Why native Manifest V3 extensions (like the official Comix Downloader extension) do NOT suffer from Canvas Tainting:

1. **Manifest V3 Host Permissions**: Extension `manifest.json` specifies `host_permissions: ["*://*.wowpic2.store/*", "*://*.comix.to/*"]`. This grants background network and image access without CORS restrictions.
2. **Service Worker Context**: The extension processes images inside a **background Service Worker**.
3. **No Document Origin**: Service Workers operate on pure memory via `OffscreenCanvas` without a DOM `document` or page window origin. Because there is no web page document in the background worker, `canvas.convertToBlob()` and `createImageBitmap()` run with zero origin taint restrictions.
4. **Userscripts in Contrast**: A Tampermonkey userscript injected with `@grant GM_*` operates inside an isolated content-script proxy sandbox within the browser tab context. Any image created by the sandbox's `createImageBitmap` or `Image` constructor carries an extension proxy origin, causing Chrome to mark the tab's DOM `<canvas>` as cross-origin tainted upon drawing.

---

## Solutions

### Solution 1: Web Worker + OffscreenCanvas (Recommended) ✅

**Best for**: Image processing that needs to produce downloadable files

Web Workers run in their own global scope with **no canvas taint restrictions**:

```javascript
const WORKER_CODE = `
  self.onmessage = async (e) => {
    const { buffer } = e.data;
    const blob = new Blob([buffer]);
    const bitmap = await createImageBitmap(blob);
    
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    
    // This ALWAYS works in a Worker — no taint!
    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const outBuffer = await outBlob.arrayBuffer();
    
    self.postMessage({ buffer: outBuffer }, [outBuffer]);
  };
`;

// Create and run the Worker
const workerBlob = new Blob([WORKER_CODE], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(workerBlob);
const worker = new Worker(workerUrl);

worker.onmessage = (e) => {
  const pngBlob = new Blob([e.data.buffer], { type: 'image/png' });
  saveAs(pngBlob, 'output.png'); // Works!
  worker.terminate();
  URL.revokeObjectURL(workerUrl);
};

// Transfer the raw image bytes to the Worker
const buffer = rawArrayBuffer.slice(0); // Clone before transfer
worker.postMessage({ buffer }, [buffer]);
```

**Why it works**: Workers have no document, no DOM, and no origin-based security on canvas operations. `createImageBitmap` in a Worker produces origin-clean bitmaps, and `OffscreenCanvas.convertToBlob()` always exports real image data.

**Potential issue**: Content Security Policy (CSP) may block `blob:` Worker URLs. Fallbacks:

```javascript
// Fallback 1: unsafeWindow Worker
const worker = new unsafeWindow.Worker(workerUrl);

// Fallback 2: data: URL Worker
const worker = new Worker('data:application/javascript,' + encodeURIComponent(WORKER_CODE));
```

---

### Solution 2: `unsafeWindow` Constructors

**Best for**: Simple image loading where Worker overhead isn't justified

Use the page's native constructors instead of the sandbox's:

```javascript
// @grant unsafeWindow

// Create image in page context (not sandbox)
const pageBlob = new unsafeWindow.Blob([arrayBuffer]);
const bitmap = await unsafeWindow.createImageBitmap(pageBlob);

const canvas = document.createElement('canvas');
canvas.width = bitmap.width;
canvas.height = bitmap.height;
const ctx = canvas.getContext('2d');
ctx.drawImage(bitmap, 0, 0);
bitmap.close();

// Should work because bitmap was created in page context
const dataUrl = canvas.toDataURL('image/png');
```

**Caveat**: This approach may not work in all environments. The cross-context Blob transfer between sandbox and page window can be unreliable.

---

### Solution 3: `@sandbox MAIN_WORLD` (Tampermonkey 5.x)

**Best for**: Scripts that can work without sandbox isolation

```javascript
// ==UserScript==
// @sandbox      MAIN_WORLD
// @grant        GM_xmlhttpRequest
// ==/UserScript==
```

This runs the script in the page's main world while still providing GM_* APIs. However:
- Not all Tampermonkey versions support this
- Security implications (script is exposed to the page)
- May not work with all GM_* APIs

---

### Solution 4: Separate Fetch + Render Scripts

**Best for**: Complex architectures

Split the userscript into two:

**Script A** (`@grant GM_xmlhttpRequest`): Fetches images and stores raw bytes in `unsafeWindow`:
```javascript
unsafeWindow.__rawImageBuffers = unsafeWindow.__rawImageBuffers || {};
unsafeWindow.__rawImageBuffers[pageNum] = arrayBuffer;
```

**Script B** (`@grant none`): Reads raw bytes and processes on canvas:
```javascript
const buffer = window.__rawImageBuffers[pageNum];
const blob = new Blob([buffer]);
const bitmap = await createImageBitmap(blob);
// Canvas operations work because we're in the page's main world
```

---

## Anti-Pattern: Things That DON'T Fix Canvas Taint

| Approach | Why it fails |
|----------|-------------|
| `img.crossOrigin = 'anonymous'` | Only works for HTTP URLs with CORS headers; doesn't fix sandbox origin |
| Using `data:` URLs instead of `blob:` | The Image created in sandbox still has extension origin |
| `document.createElement('img')` vs `new Image()` | In sandbox, both create sandbox-origin elements |
| Calling `toBlob` before `bitmap.close()` | Taint happens at draw time, not export time |
| Using `OffscreenCanvas` in main thread | Still in sandbox scope, still tainted |
| `canvas.convertToBlob()` instead of `toBlob()` | Same restriction — both blocked on tainted canvas |
| Using JPEG instead of PNG | Both `toDataURL('image/jpeg')` and `toBlob('image/jpeg')` are blocked |
| `ctx.getImageData()` + manual BMP encoding | `getImageData` returns all zeros on tainted canvas |

---

## Diagnostic Script Template

Use this to quickly diagnose canvas taint issues:

```javascript
// After drawing an image to canvas:
async function diagnoseCanvasTaint(canvas, ctx, W, H) {
  console.log('=== CANVAS TAINT DIAGNOSTIC ===');
  
  // Test 1: toDataURL
  try {
    const du = canvas.toDataURL('image/png');
    console.log(`toDataURL: ${du.length} chars ${du.length < 500 ? '❌ TAINTED' : '✅ OK'}`);
  } catch (e) {
    console.log(`toDataURL EXCEPTION: ${e.message} ❌`);
  }
  
  // Test 2: toBlob
  try {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    console.log(`toBlob: ${blob ? blob.size + ' bytes' : 'NULL'} ${!blob || blob.size < 1000 ? '❌ TAINTED' : '✅ OK'}`);
  } catch (e) {
    console.log(`toBlob EXCEPTION: ${e.message} ❌`);
  }
  
  // Test 3: getImageData
  try {
    const imgData = ctx.getImageData(0, 0, Math.min(W, 100), Math.min(H, 100));
    let nonZero = 0;
    for (let i = 0; i < imgData.data.length; i += 4) {
      if (imgData.data[i] || imgData.data[i+1] || imgData.data[i+2]) nonZero++;
    }
    console.log(`getImageData: ${nonZero} non-zero pixels ${nonZero === 0 ? '❌ TAINTED' : '✅ OK'}`);
  } catch (e) {
    console.log(`getImageData EXCEPTION: ${e.message} ❌`);
  }
}
```

---

## Browser-Specific Notes

### Brave

Brave has **Shields fingerprint protection** that independently blocks canvas readback. This is separate from the Tampermonkey sandbox issue. Even with `@grant none`, Brave may block canvas export on "Aggressive" fingerprint blocking mode.

**Fix**: Click the Brave Shields lion icon → Fingerprinting → "Allow" for the specific site.

### Edge / Chrome

No built-in canvas fingerprint protection. Canvas taint in Edge/Chrome with Tampermonkey is **100% caused by the sandbox isolation**, not browser privacy features.

### Firefox + Greasemonkey/Violentmonkey

Firefox's userscript managers may have different sandbox models. Canvas taint behavior may differ. The Web Worker solution should work universally.
