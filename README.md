# Good Old Journaling

A quiet, paper-feeling journaling app. Static site + Google Drive — no server, no database to pay for. Deployable to GitHub Pages.

All six phases are now in. Each feature is its own module so you can read, debug, or replace one without touching the rest.

## Features

**Core (auth + storage)**
- Google sign-in that *stays put* — silent refresh ~5 min before expiry, refresh on tab focus, automatic retry on Drive 401s. No more hourly re-prompts.
- `drive.file` scope — the app only sees files it created, never the rest of your Drive.
- One JSON file per page in a `Good Old Journaling` folder, plus separate binary files for photos.
- Autosave (1.5s debounce + `⌘/Ctrl-S` + on tab hide).

**Phase 2 — Page flip**
- Navigating between pages plays a 3D flip (a snapshot of the old page peels away).
- The bottom **page strip is a freewheel**: scroll it fast and the journal zooms out and flips faster; let go and it eases back. Velocity-driven, with decay.

**Phase 3 — Drawing**
- Full-screen drawing canvas with pressure-sensitive strokes (`perfect-freehand`), works with finger, mouse, or stylus/Apple Pencil.
- Pen + eraser, four sizes, five inks. Undo / clear.
- Saved as **vector** JSON (not a flat image) and rendered back as crisp SVG.

**Phase 4 — Photo → digital page + OCR**
- Snap or upload a photo of a written page.
- OpenCV.js cleans it (adaptive threshold → text separated from background, re-tinted to paper/ink).
- Tesseract.js extracts the text so it becomes **searchable**.
- Both original and cleaned versions stored; lightbox to compare + read extracted text.

**Phase 5 — Search**
- FlexSearch index across title, body, **photo OCR text**, tags, and date.
- Falls back to substring search automatically if the library can't load.

**Phase 6 — Offline-first + polish**
- IndexedDB cache: pages render instantly on load, before Drive sync finishes, and survive brief network drops.
- View Transitions API for a soft cross-fade on page changes (where supported).
- Installable PWA, dark mode, keyboard shortcuts, reduced-motion respected.

**Shortcuts:** `⌘/Ctrl + N` new · `⌘/Ctrl + S` save · `⌘/Ctrl + K` search · `←/→` flip pages.

## First-time setup

### 1. Keys → `config.js`
Open `config.js` and paste your existing API key + OAuth client ID over the `PASTE_…` placeholders. `config.js` is gitignored, so it won't be pushed.

### 2. Lock the keys down in Google Cloud Console
Browser keys are visible in page source — that's unavoidable for a static site. The real protection is restricting *where* they work:

- **API key** → Credentials → your key → Application restrictions: **HTTP referrers**
  - `https://YOUR-USERNAME.github.io/*` and `http://localhost:*/*`
- **OAuth client ID** → your client → Authorized JavaScript origins
  - `https://YOUR-USERNAME.github.io` and `http://localhost:8000`

With these set, copied keys are useless from any other origin.

### 3. Scope changed → fresh consent
This app uses `drive.file` (not full `drive`). You'll see a new consent screen on first sign-in. Expected.

### 4. Run it
```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```
Or push to GitHub Pages.

> **Note on first photo:** the very first time you add a photo, the browser downloads OpenCV + Tesseract (~20MB including the English language data). That import is slow once; every photo after is fast. Nothing is sent anywhere — all processing is in your browser.

## File map

```
index.html         # shell + DOM
styles.css         # design tokens, layout, every component
config.js          # YOUR keys (gitignored)
config.example.js  # template (committed)

app.js             # core: auth · Drive · page model · editor · wiring
idb.js             # Phase 6 — IndexedDB cache
search.js          # Phase 5 — FlexSearch
flip.js            # Phase 2 — page-flip + velocity freewheel
draw.js            # Phase 3 — drawing canvas + SVG render
photo.js           # Phase 4 — OpenCV clean + Tesseract OCR + lightbox

logo.svg           # the three-dot stitch
manifest.json      # PWA
service-worker.js  # offline shell cache (never caches Google traffic)
```

## How the modules talk to each other

`app.js` owns state and exposes a small surface on `window.GOJ` (e.g. `uploadBlob`, `downloadBlobUrl`, `cryptoId`, `navigateTo`, `plainText`, `toISODate`). Each feature module attaches itself to its own global — `window.GOJ_FLIP`, `GOJ_DRAW`, `GOJ_PHOTO`, `GOJ_SEARCH`, `GOJ_IDB` — and `app.js` calls them only if present. So if a module fails to load, the rest of the app keeps working.

## Data model

```jsonc
// one page file (application/json) in the Drive folder
{
  "id": "…", "fileId": "…",
  "date": "2026-06-24", "title": "…", "tags": ["…"],
  "content": "<p>rich text html</p>",
  "drawings": [
    { "id": "…", "width": 800, "height": 600, "createdAt": "…",
      "strokes": [ { "id": "…", "points": [[x,y,pressure]], "size": 6, "color": "#1B1816", "eraser": false } ] }
  ],
  "photos": [
    { "id": "…", "originalFileId": "…", "cleanedFileId": "…",
      "thumbnail": "data:image/jpeg;base64,…", "ocrText": "…",
      "width": 1500, "height": 2000, "createdAt": "…" }
  ],
  "schemaVersion": 2,
  "createdAt": "…", "updatedAt": "…"
}
```
Phase 1 pages (no `drawings`/`photos`) load fine — they're normalized to empty arrays on read.

## Honest limitations

- **Handwriting OCR is mediocre.** Tesseract is excellent on printed text, unreliable on cursive. If you want strong handwriting recognition later, Google Cloud Vision's free tier is the upgrade path — it'd be a small change in `photo.js`.
- **No auto perspective-correction** on angled photos yet. The adaptive threshold still yields a clean, readable page, and OCR tolerates moderate angles. Auto-deskew (detect page corners, warp) is a sensible next addition to `photo.js`.
- **Conflict handling is last-write-wins.** Fine for a single user across devices; not built for simultaneous editing.

## Migration from "My Quiet Space"

Not automatic — the old app kept everything in one `journal.json` under the full-drive scope. This one stores one file per page under `drive.file` in a new folder. A one-shot import script can be written when you want it.
