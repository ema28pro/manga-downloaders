# Comix.to Canvas Unscrambling — Technical Documentation

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [How Comix.to Image Scrambling Works](#how-comixto-image-scrambling-works)
3. [The Canvas Taint Problem](#the-canvas-taint-problem)
4. [Approaches Tried & Why They Failed](#approaches-tried--why-they-failed)
5. [The Solution: Web Worker + OffscreenCanvas](#the-solution-web-worker--offscreencanvas)
6. [API Payload Interception](#api-payload-interception)
7. [Tile Permutation Algorithm](#tile-permutation-algorithm)
8. [Reference: Extension vs Userscript Contexts](#reference-extension-vs-userscript-contexts)

---

## Problem Statement

Comix.to serves manga page images with **tile scrambling**: the image is divided into a grid (e.g. 5×5) and the tiles are shuffled using a seeded pseudo-random permutation. The reader's JavaScript unscrambles them in the browser by drawing tiles to the correct positions on a `<canvas>`.

**Goal**: Build a Tampermonkey userscript that:
1. Intercepts the scrambled image URLs and scramble parameters from the API payload
2. Fetches the scrambled images via `GM_xmlhttpRequest` (bypassing CORS)
3. Unscrambles the tiles
4. Exports the clean PNG and packages all pages into a ZIP for download

**The blocker**: Every attempt to export the unscrambled canvas produced a **69-byte file** — a 1×1 transparent PNG stub — instead of the real ~280KB image.

---

## How Comix.to Image Scrambling Works

### Scramble Parameters

Each page in the API payload includes scramble metadata:

```json
{
  "url": "/i5/bEqPbYfoPT0Gm0nlHg6foApU1r0devKi3R0VvpbI6y4EiS5FIHyEz7PI11FmpSw",
  "scramble": {
    "seed": 687641706,
    "grid": "5x5",
    "hash": "03632"
  }
}
```

| Parameter | Description |
|-----------|-------------|
| `seed`    | Integer seed for the PRNG that generates the tile permutation |
| `grid`    | Tile grid dimensions (e.g. `5x5` = 25 tiles) |
| `hash`    | Identifies which initialization constant to use for the PRNG |

### Hash → Init Constant Mapping

The scramble hash determines the PRNG initialization constant:

```javascript
const SCRAMBLE_HASH_INIT_CONSTS = {
  '03632': [0xe42f],   // Most common
  '02900': [0x1cb1d],
  '09197': [0x1],
  'bca9b': [0x1],
  'e8a87': [0x1],
};
```

### Visual Representation

```
Original (clean):          Scrambled (served):
┌──┬──┬──┬──┬──┐          ┌──┬──┬──┬──┬──┐
│01│02│03│04│05│          │19│07│23│02│15│
├──┼──┼──┼──┼──┤          ├──┼──┼──┼──┼──┤
│06│07│08│09│10│          │04│21│11│18│09│
├──┼──┼──┼──┼──┤   ───►   ├──┼──┼──┼──┼──┤
│11│12│13│14│15│          │25│13│06│22│01│
├──┼──┼──┼──┼──┤          ├──┼──┼──┼──┼──┤
│16│17│18│19│20│          │16│10│03│14│24│
├──┼──┼──┼──┼──┤          ├──┼──┼──┼──┼──┤
│21│22│23│24│25│          │08│20│17│12│05│
└──┴──┴──┴──┴──┘          └──┴──┴──┴──┴──┘
```

The permutation array maps: `perm[scrambled_position] = clean_position`.

---

## The Canvas Taint Problem

### What is Canvas Tainting?

When a cross-origin image is drawn onto an HTML5 `<canvas>`, the browser marks the canvas as **"tainted"**. A tainted canvas:

- ✅ Can still **render/display** the image visually
- ❌ **Blocks ALL pixel readback**: `toDataURL()`, `toBlob()`, `getImageData()`

This is a security measure to prevent websites from reading pixel data of images from other origins (which could be used for tracking, fingerprinting, or data exfiltration).

### The 69-Byte Stub

When `canvas.toDataURL('image/png')` is called on a tainted canvas, it returns the minimal valid PNG — a 1×1 transparent pixel:

```
data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==
```

This base64 string is **114 characters**. When decoded to binary, it produces exactly **69 bytes** — the signature of the tainted canvas problem.

| Indicator | Value | Meaning |
|-----------|-------|---------|
| `toDataURL` length | 114 chars | Tainted canvas returning 1×1 PNG |
| `toBlob` result | `null` | Tainted canvas refusing blob export |
| `getImageData` pixels | All zeros | Tainted canvas returning blank data |
| Downloaded file size | 69 bytes | The decoded 1×1 transparent PNG |

### Why Our Canvas Was Tainted

The root cause is **Tampermonkey's sandbox isolation**. When a userscript uses `@grant` directives (like `GM_xmlhttpRequest`), Tampermonkey executes it in an **isolated content script sandbox**:

```
┌─────────────────────────────────────────────┐
│ Browser Tab (comix.to)                      │
│                                             │
│  ┌──────────────────┐  ┌─────────────────┐  │
│  │ Page Context      │  │ TM Sandbox      │  │
│  │ (MAIN world)      │  │ (ISOLATED world)│  │
│  │                   │  │                 │  │
│  │ • Page's JS       │  │ • Userscript    │  │
│  │ • Page's DOM      │  │ • GM_* APIs     │  │
│  │ • Origin:         │  │ • Origin:       │  │
│  │   comix.to        │  │   chrome-ext:// │  │
│  │                   │  │   (different!)  │  │
│  └──────────────────┘  └─────────────────┘  │
│           ▲ shared document ▲                │
└─────────────────────────────────────────────┘
```

Key facts:
- `document` is **shared** between both worlds
- `window`, `Image`, `Blob`, `FileReader`, `createImageBitmap` are **sandbox versions**
- Objects created by sandbox constructors have the **extension's origin**, not the page's origin

When our userscript did:
```javascript
const img = new Image();           // ← Sandbox's Image constructor
img.src = 'data:image/png;base64,...';  // ← Even data: URLs get extension origin
canvas.getContext('2d').drawImage(img, 0, 0);  // ← Taints the canvas!
```

The Image was created in the sandbox's scope. Its origin was `chrome-extension://...`, not `https://comix.to`. Drawing it to a canvas attached to `comix.to`'s document caused a cross-origin taint.

### This is NOT browser-specific

We confirmed this happens on:
- ✅ Brave (initially suspected Brave Shields, but that was wrong)
- ✅ Edge (no fingerprint protection)
- ✅ Chrome (standard Tampermonkey behavior)

The issue is 100% caused by **Tampermonkey's sandbox origin isolation**, not by any browser privacy feature.

---

## Approaches Tried & Why They Failed

### v1.0–v3.3: `createImageBitmap` + `canvas.toBlob`

```javascript
const blob = new Blob([arraybuffer]);
const bitmap = await createImageBitmap(blob);
canvas.getContext('2d').drawImage(bitmap, 0, 0);
// ... tile permutation ...
const outBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
```

**Result**: `toBlob` returned `null`. Canvas was tainted because `createImageBitmap` was called from the sandbox scope.

### v3.4: Export before `bitmap.close()`

We hypothesized that calling `bitmap.close()` before export was the issue. Fixed the ordering:

```javascript
const outBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
bitmap.close(); // After export
```

**Result**: Still `null`. The taint was on the canvas, not a timing issue.

### v4.0–v4.2: DataURL → `new Image()` → canvas

Converted raw bytes to a DataURL, loaded it into an `<img>` tag, then drew to canvas:

```javascript
const rawDataUrl = await blobToDataURL(arraybuffer);
const img = await loadImage(rawDataUrl);  // new Image()
canvas.getContext('2d').drawImage(img, 0, 0);
```

**Result**: `toDataURL` returned 114 chars. The `new Image()` was created in the sandbox scope — same taint issue.

### v5.0: Direct Blob in `GM_download`

Tried passing the Blob object directly to `GM_download({ url: blob })`:

```javascript
GM_download({ url: outBlob, name: 'page.png' });
```

**Result**: Still 69 bytes because `outBlob` was created from the tainted canvas output (which was already the 1×1 PNG).

### v6.0: Diagnostic — All 5 export methods

Tested every possible canvas readback method:

| Method | Result |
|--------|--------|
| `toDataURL('image/png')` | 114 chars (tainted) |
| `toDataURL('image/jpeg')` | 114 chars (tainted) |
| `toBlob('image/png')` | `null` (tainted) |
| `toBlob('image/jpeg')` | `null` (tainted) |
| `getImageData(0, 0, W, H)` | 11,796,480 bytes, all zeros (tainted) |

**Conclusion**: ALL canvas readback APIs are blocked. The canvas is tainted at the draw level, not the export level.

### Other approaches considered but not viable

| Approach | Why it doesn't work |
|----------|-------------------|
| `img.crossOrigin = 'anonymous'` | No effect on data: URLs; doesn't fix sandbox origin |
| `OffscreenCanvas` in main thread | Still tainted — same origin issue |
| `canvas.convertToBlob()` | Same as `toBlob()` — blocked on tainted canvas |
| BMP encoder via `getImageData` | `getImageData` returns all zeros on tainted canvas |
| Monkey-patch `Image` constructor | Only affects page's code, not our own sandbox constructors |

---

## The Solution: Web Worker + OffscreenCanvas

### Why Workers bypass the taint

Web Workers run in their **own global scope**, completely separate from both the page and the Tampermonkey sandbox:

```
┌─────────────────────────────────────────────────────┐
│ Browser Tab                                         │
│                                                     │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Page       │  │ TM Sandbox   │  │ Web Worker  │ │
│  │ Context    │  │              │  │             │ │
│  │            │  │ GM_*         │  │ NO document │ │
│  │ Origin:    │  │ Origin:      │  │ NO DOM      │ │
│  │ comix.to   │  │ chrome-ext:  │  │ NO origin   │ │
│  │            │  │              │  │ restrictions│ │
│  │ Canvas:    │  │ Canvas:      │  │             │ │
│  │ TAINTED    │  │ TAINTED      │  │ CLEAN ✅    │ │
│  └────────────┘  └──────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────┘
```

Inside a Worker:
- There is no `document`, no DOM, no page origin
- `createImageBitmap(blob)` decodes images without any origin tagging
- `OffscreenCanvas` has no taint mechanism — it's a pure pixel buffer
- `canvas.convertToBlob()` always produces a real PNG/JPEG

### Architecture

```
Step 1: GM_xmlhttpRequest fetches scrambled image
        → ArrayBuffer (278,374 bytes)

Step 2: ArrayBuffer transferred to Worker via postMessage
        → Zero-copy transfer (buffer is "neutered" in main thread)

Step 3: Inside Worker:
        blob = new Blob([buffer])
        bitmap = await createImageBitmap(blob)      // 1440×2048px
        canvas = new OffscreenCanvas(1440, 2048)
        ctx = canvas.getContext('2d')
        ctx.drawImage(bitmap, 0, 0)                 // Base image
        // ... tile permutation with drawImage ...
        outBlob = await canvas.convertToBlob({ type: 'image/png' })
        outBuffer = await outBlob.arrayBuffer()     // ~300KB real PNG

Step 4: outBuffer transferred back to main thread
        → new Blob([outBuffer], { type: 'image/png' })
        → saveAs() / GM_download() / <a>.click()
```

### Worker Creation

The Worker is created from an inline blob URL:

```javascript
const workerCode = `
  self.onmessage = async (e) => {
    const { buffer, seed, cols, rows } = e.data;
    const blob = new Blob([buffer]);
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    // ... unscramble ...
    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const outBuffer = await outBlob.arrayBuffer();
    self.postMessage({ buffer: outBuffer }, [outBuffer]);
  };
`;

const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(workerBlob);
const worker = new Worker(workerUrl);
```

### Fallback Strategy

If Workers are blocked by Content Security Policy (CSP):

1. **Try blob URL Worker**: `new Worker(URL.createObjectURL(blob))`
2. **Try unsafeWindow Worker**: `new unsafeWindow.Worker(url)` (page context)
3. **Try data URL Worker**: `new Worker('data:application/javascript,...')`
4. **Fallback to unsafeWindow.createImageBitmap**: Use page-context constructors
5. **Last resort**: Ask user to disable fingerprint/security features

---

## API Payload Interception

### How comix.to delivers page data

Comix.to encrypts its API responses. The page's JavaScript decrypts the payload, which contains all page URLs and scramble parameters. We intercept the decrypted output by patching `TextDecoder.prototype.decode`:

```javascript
const origDecode = TextDecoder.prototype.decode;
TextDecoder.prototype.decode = function(...args) {
  const result = origDecode.apply(this, args);
  tryCaptureApiPages(result);  // Check if it contains page data
  return result;
};
```

### Payload Structure

The decrypted payload contains:

```json
{
  "result": {
    "pages": {
      "baseUrl": "https://ek10.wowpic2.store",
      "items": [
        {
          "url": "/i5/bEqPbYfoPT0Gm...",
          "scramble": {
            "seed": 687641706,
            "grid": "5x5",
            "hash": "03632"
          }
        },
        ...
      ]
    }
  }
}
```

### Scramble parameter sources (priority order)

1. **API payload** (`window.__cdlPages[i].scramble`) — most reliable
2. **HTTP response headers** (`X-Scramble-Seed`, `X-Scramble-Grid`, `X-Scramble-Hash`)
3. **DOM inspection** (fallback for non-scrambled pages)

---

## Tile Permutation Algorithm

### PRNG: Xorshift32

The permutation is generated using a **Xorshift32** pseudo-random number generator:

```javascript
function makeScramblePermutation(seed, count, initConst = 0xe42f) {
  const order = Array.from({ length: count }, (_, i) => i);
  let state = (initConst ^ ((seed >>> 1) << 1)) >>> 0;

  for (let remaining = count; remaining >= 2; remaining--) {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    const swapWith = state % remaining;
    const last = remaining - 1;
    [order[last], order[swapWith]] = [order[swapWith], order[last]];
  }

  return order;
}
```

### How the permutation is applied

The reader (and our unscrambler) uses the permutation as a **forward destination mapping**:

```javascript
const perm = makeScramblePermutation(seed, count, initConst);

for (let i = 0; i < count; i++) {
  const srcX = (i % cols) * tileW;
  const srcY = Math.floor(i / cols) * tileH;
  const dstIndex = perm[i];
  const dstX = (dstIndex % cols) * tileW;
  const dstY = Math.floor(dstIndex / cols) * tileH;

  ctx.drawImage(bitmap, srcX, srcY, tileW, tileH, dstX, dstY, tileW, tileH);
}
```

**Important**: The base image is drawn first (`ctx.drawImage(bitmap, 0, 0)`) to preserve edge pixels that don't fit evenly into the tile grid. Then tiles are overwritten with the permuted positions.

---

## Reference: Extension vs Userscript Contexts

### Why the Chrome extension works

The official `comix_downloader` Chrome extension is a **Manifest V3 extension** with explicit host permissions (`*://*.wowpic2.store/*` and `*://*.comix.to/*`). It runs its image unscrambler inside a **background Service Worker**:

```
Extension Service Worker (Manifest V3)
  → Host Permissions (*://*.wowpic2.store/*)
  → fetch() directly from background context
  → createImageBitmap(blob)  ← Extension background context (privileged)
  → OffscreenCanvas          ← Zero DOM, zero document origin, zero taint
  → canvas.convertToBlob()   ← Always exports clean arrayBuffer
  → ArrayBuffer into JSZip
```

**Key differences between Extension and Userscript contexts**:
1. **Host Privileges**: Manifest V3 extensions declare `host_permissions` in `manifest.json`, granting background network and image access without CORS limitations.
2. **Background Execution Context**: Extension background Service Workers execute outside of any DOM `document` or web page origin.
3. **No Sandbox Tainting**: Because `OffscreenCanvas` in a Service Worker operates on pure memory without a document window or sandbox wrapper, `convertToBlob()` and `toBlob()` never encounter canvas taint or 69-byte stubs.
4. **Tampermonkey Sandbox Contrast**: Tampermonkey userscripts injected with `@grant GM_*` run in a proxy content-script sandbox inside the browser tab. Drawing sandbox-created images onto a tab DOM canvas flags the canvas as cross-origin tainted.

### Key file references in the extension

| File | Lines | Function |
|------|-------|----------|
| `background.js` | 3111-3157 | `unscrambleImageBlob()` — main unscrambler |
| `background.js` | 3192-3203 | `createZipCanvas()` — OffscreenCanvas factory |
| `background.js` | 3205-3218 | `canvasToBlob()` — convertToBlob/toBlob wrapper |
| `background.js` | 3220-3250 | `makeScramblePermutation()` — PRNG |
| `background.js` | 3100-3109 | `SCRAMBLE_HASH_INIT_CONSTS` — hash → initConst map |
| `content/extract-bridge.js` | 57-84 | `tryCapture()` — API payload interceptor |

### Tampermonkey sandbox behavior

| Feature | `@grant none` | `@grant GM_*` |
|---------|--------------|---------------|
| Script runs in | Page's MAIN world | Isolated sandbox |
| `window` | Real page window | Proxy/wrapper |
| `new Image()` | Page origin | Extension origin |
| `createImageBitmap` | Page's native | Sandbox version |
| Canvas taint on draw | ❌ No taint | ✅ TAINTED |
| `GM_xmlhttpRequest` | ❌ Not available | ✅ Available |

The dilemma: we NEED `@grant GM_xmlhttpRequest` to bypass CORS on image fetches, but this forces us into the sandbox, which taints any canvas we draw to.

**The Web Worker approach resolves this dilemma** — we use `GM_xmlhttpRequest` in the sandbox to fetch the image, then transfer the raw bytes to a Worker for taint-free processing.

---

## Version History

| Version | Approach | Result |
|---------|----------|--------|
| v1.0–v3.3 | `createImageBitmap` + `toBlob` | 69 bytes (tainted) |
| v3.4 | Fixed export-before-close ordering | `toBlob` → `null` |
| v4.0–v4.2 | DataURL → `new Image()` → canvas | 114 chars / 69 bytes |
| v5.0 | Direct Blob to `GM_download` | 69 bytes |
| v6.0 | Diagnostic (5 methods tested) | ALL FAILED (confirmed taint) |
| v7.0 | Web Worker + OffscreenCanvas | ✅ WORKED! Bypassed canvas taint completely |
| v7.1 | UI Reset on Chapter Navigation | Fixed `Processing (171/44)` counter bug |
| v7.2 | Next.js SPA Interception + Mutex | Fixed chapter navigation & DOM race conditions |
| v7.3 | Multi-Variant Auto Seam-Score | ✅ Perfect tile unscrambling per page |
| v7.5 | **Universal PNG Canvas Export** | **✅ FIXED! Converted WebP/AVIF to PNG for Photoshop compatibility** |
