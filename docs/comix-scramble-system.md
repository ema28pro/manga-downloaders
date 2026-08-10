# Comix.to Scramble System — Technical Reference

## Overview

Comix.to uses a tile-based image scrambling system to prevent direct downloading of manga pages. Each page image is divided into a grid of tiles (typically 5×5 = 25 tiles) and the tiles are shuffled using a seeded pseudo-random permutation. The browser-side reader JavaScript unscrambles the image in real-time on a `<canvas>`.

---

## Scramble Parameters

### Source: Encrypted API Payload

The page data is delivered as an encrypted API response. After decryption (handled by the site's own JavaScript), the payload contains:

```json
{
  "result": {
    "pages": {
      "baseUrl": "https://ek10.wowpic2.store",
      "items": [
        {
          "url": "/i5/bEqPbYfoPT0Gm0nlHg6foApU1r0devKi3R0VvpbI6y4EiS5FIHyEz7PI11FmpSw",
          "scramble": {
            "seed": 687641706,
            "grid": "5x5",
            "hash": "03632"
          }
        }
      ]
    }
  }
}
```

### Source: HTTP Response Headers

When fetching the image, the CDN may also return scramble parameters as HTTP headers:

```
X-Scramble-Seed: 687641706
X-Scramble-Grid: 5x5
X-Scramble-Hash: 03632
```

### Parameter Details

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `seed` | `integer` | PRNG seed for permutation generation | `687641706` |
| `grid` | `string` | Tile grid as `COLSxROWS` | `5x5` |
| `hash` | `string` | Identifies the PRNG init constant variant | `03632` |

### URL Convention

Scrambled image URLs end with `?8` (the query parameter `8` is a marker):
```
https://ek10.wowpic2.store/i5/bEqPbYfoPT0Gm...?8
```

Non-scrambled images have no `?8` suffix.

---

## Permutation Algorithm

### PRNG: Xorshift32

The tile permutation uses a modified **Xorshift32** pseudo-random number generator with a configurable initialization constant.

```javascript
function makeScramblePermutation(seed, count, initConst) {
  // Initialize with identity permutation [0, 1, 2, ..., count-1]
  const order = Array.from({ length: count }, (_, i) => i);
  
  // Combine init constant with seed
  let state = (initConst ^ ((seed >>> 1) << 1)) >>> 0;

  // Fisher-Yates shuffle from end to start
  for (let remaining = count; remaining >= 2; remaining--) {
    // Xorshift32 step
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    
    // Swap the last unplaced element with a random earlier element
    const swapWith = state % remaining;
    const last = remaining - 1;
    const tmp = order[last];
    order[last] = order[swapWith];
    order[swapWith] = tmp;
  }

  return order; // perm[src_tile_index] = dst_tile_index
}
```

### Initialization Constants

The `hash` field maps to different PRNG initialization constants:

```javascript
const SCRAMBLE_HASH_INIT_CONSTS = {
  '03632': [0xe42f],    // 58415 — most common
  '02900': [0x1cb1d],   // 117533
  '09197': [0x1],       // 1
  'bca9b': [0x1],       // 1
  'e8a87': [0x1],       // 1
};

// Fallback order when hash is unknown
const SCRAMBLE_INIT_CONSTS = [0xe42f, 0x1, 0x1cb1d];
```

When the hash is unknown, the system tries all known constants and uses the one that produces the cleanest tile seams (lowest discontinuity score).

### Applying the Permutation (Unscrambling)

```javascript
// Forward destination mapping: perm[i] tells you WHERE tile i should go
const perm = makeScramblePermutation(seed, count, initConst);

// Step 1: Draw the full scrambled image (preserves edge remainders)
ctx.drawImage(sourceImage, 0, 0);

// Step 2: Overwrite each tile at its correct destination
for (let i = 0; i < count; i++) {
  const srcX = (i % cols) * tileW;
  const srcY = Math.floor(i / cols) * tileH;
  const dstIndex = perm[i];
  const dstX = (dstIndex % cols) * tileW;
  const dstY = Math.floor(dstIndex / cols) * tileH;
  ctx.drawImage(sourceImage, srcX, srcY, tileW, tileH, dstX, dstY, tileW, tileH);
}
```

**Why draw the base image first?** The image dimensions may not be exactly divisible by the grid. For example, a 1440×2048 image with a 5×5 grid has tiles of 288×409 pixels, but `288 * 5 = 1440` and `409 * 5 = 2045`, leaving 3 pixels of remainder at the bottom. Drawing the full image first preserves these edge pixels.

---

## Seam Score Validation

When multiple init constants are candidates, the system evaluates which permutation produces the correct unscrambling by measuring **color discontinuity at tile seams**:

```javascript
function scrambleSeamScore(ctx, W, H, tileW, tileH, cols, rows) {
  const data = ctx.getImageData(0, 0, W, H).data;
  const STEP = 3; // Sample every 3rd pixel for speed
  let score = 0;
  
  // Vertical seams
  for (let c = 1; c < cols; c++) {
    const x = c * tileW;
    for (let y = 0; y < H; y += STEP) {
      const leftIdx  = (y * W + x - 1) * 4;
      const rightIdx = (y * W + x) * 4;
      score += Math.abs(data[leftIdx]     - data[rightIdx])
             + Math.abs(data[leftIdx + 1] - data[rightIdx + 1])
             + Math.abs(data[leftIdx + 2] - data[rightIdx + 2]);
    }
  }
  
  // Horizontal seams
  for (let r = 1; r < rows; r++) {
    const y = r * tileH;
    for (let x = 0; x < W; x += STEP) {
      const topIdx    = ((y - 1) * W + x) * 4;
      const bottomIdx = (y * W + x) * 4;
      score += Math.abs(data[topIdx]     - data[bottomIdx])
             + Math.abs(data[topIdx + 1] - data[bottomIdx + 1])
             + Math.abs(data[topIdx + 2] - data[bottomIdx + 2]);
    }
  }
  
  return score; // Lower = better (tiles line up correctly)
}
```

---

## API Payload Interception Methods

### Method 1: `TextDecoder.prototype.decode` patch

The site decrypts API responses using `TextDecoder`. We intercept the decoded text:

```javascript
const origDecode = TextDecoder.prototype.decode;
TextDecoder.prototype.decode = function(...args) {
  const result = origDecode.apply(this, args);
  tryCapture(result); // Check for page data
  return result;
};
```

### Method 2: `window.atob` patch

Some payloads pass through Base64 decoding:

```javascript
const origAtob = window.atob;
window.atob = function(str) {
  const result = origAtob.call(window, str);
  tryCapture(str);
  return result;
};
```

### Method 3: `fetch` / `XMLHttpRequest` response capture

For direct API calls, we clone the response and parse JSON:

```javascript
const origFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await origFetch.apply(this, args);
  const clone = response.clone();
  clone.text().then(text => tryCapture(text));
  return response;
};
```

### Next.js SPA Transition Interception

Comix.to uses Next.js SPA routing. When a user navigates between chapters, Next.js fetches JSON data from `/_next/data/.../chapter-xxx.json`. The `fetch` interceptor parses ALL JSON network responses (including `/_next/data/` paths) to ensure `window.__cdlPages` is populated immediately upon chapter transition.

### Serialized Mutex for DOM Strategy

If `window.__cdlPages` is ever unavailable, the script falls back to fetching images via DOM navigation. Because `ImageDownloaderLib` runs 4 image download promises concurrently, clicking progress bar DOM buttons simultaneously causes race conditions in Swiper reader mode. To prevent this, DOM page navigation is serialized using a `Promise` mutex lock (`domLockPromise`), ensuring DOM page requests execute sequentially one page at a time.

### Data stored in `window.__cdlPages`

After interception, pages are stored globally:

```javascript
window.__cdlPages = [
  {
    src: 'https://ek10.wowpic2.store/i5/bEqPbY...',
    index: 1,
    scramble: { seed: 687641706, cols: 5, rows: 5, hash: '03632' }
  },
  // ... more pages
];
```

---

## Image CDN Details

### CDN Domains

Images are served from `wowpic2.store` subdomains:
- `https://ek10.wowpic2.store/i5/...`
- `https://ek10.wowpic2.store/i4/...`

### CORS Policy

The CDN **does not** send `Access-Control-Allow-Origin` headers, which means:
- Browser `fetch()` from `comix.to` is blocked by CORS
- `GM_xmlhttpRequest` (Tampermonkey) bypasses CORS
- Extension `fetch()` with host permissions bypasses CORS

### Universal PNG Conversion & Photoshop Magic Bytes

Images served by `wowpic2.store` are natively encoded as **WebP** or **AVIF** (`RIFF...WEBP`). When saving images directly with a `.png` filename extension without format conversion, software like Adobe Photoshop rejects the files with the error `"Not a valid PNG file"` because the byte header (`RIFF`) does not match the PNG specification (`\x89PNG`).

To solve this, `comixdownloader.js` passes **ALL images** (both scrambled and clean WebP/AVIF) through the Worker `OffscreenCanvas` rendering pipeline. `canvas.convertToBlob({ type: 'image/png' })` encodes valid PNG magic bytes (`89 50 4E 47 0D 0A 1A 0A`) for every file in the ZIP, ensuring 100% Photoshop and image viewer compatibility.

### Required Request Headers

```
Referer: https://comix.to/
Accept: image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8
```

The `Referer` header is **required** — without it, the CDN returns 403 or a 5KB error page.

---

## Page Detection

### Reader page URL pattern

```
https://comix.to/title/{slug}/{id}-chapter-{number}
```

Example: `https://comix.to/title/9l36-the-ramparts-of-ice/10095034-chapter-114`

### DOM Selectors

| Element | Selector | Purpose |
|---------|----------|---------|
| Page container | `.rpage-page[data-page="N"]` | Individual page wrapper |
| Page image | `.rpage-page img` | The `<img>` or `<canvas>` element |
| Progress bar segment | `.rpage-progress__seg[title="Page N"]` | Click to navigate/load a page |
| Page counter | `.rpage-page__counter` | Shows "N / Total" |
| Chapter title | `.rpage-chap-ending__title` | Title at chapter end screen |

### Total page count detection

```javascript
function getTotalPages() {
  // Priority 1: Intercepted API data
  if (window.__cdlPages?.length > 0) return window.__cdlPages.length;
  
  // Priority 2: DOM elements
  const pageEls = document.querySelectorAll('.rpage-page');
  const segEls = document.querySelectorAll('.rpage-progress__seg');
  
  // Priority 3: data-page attributes
  let maxPage = 0;
  document.querySelectorAll('.rpage-page[data-page]').forEach(el => {
    const p = parseInt(el.getAttribute('data-page'), 10);
    if (p > maxPage) maxPage = p;
  });
  
  return Math.max(pageEls.length, segEls.length, maxPage);
}
```

---

## Credits & Acknowledgments

The scramble constants (`0xe42f`, `0x1`, `0x1cb1d`), hash mappings, and seam score algorithms documented here and used in `comixdownloader.js` are based on the reverse-engineering research from the extension project [N3uralCreativity/comix-downloader](https://github.com/N3uralCreativity/comix-downloader).

