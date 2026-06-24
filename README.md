# Good Old Journaling

A quiet, paper-feeling journaling app. Static site + Google Drive — no server, no database to pay for. Personal use first; deployable to GitHub Pages.

## What's in Phase 1 (this checkpoint)

- ✅ Sign-in with Google (no more re-prompting every hour — auto silent refresh ~5 min before expiry, refresh on tab focus, 401-retry on Drive calls)
- ✅ Drive storage with `drive.file` scope (only this app can see its own files — much safer than the full `drive` scope used previously)
- ✅ Pages model (id, date, title, tags, content, timestamps)
- ✅ Multi-page index in the sidebar with live search
- ✅ Tag chips + per-page tagging
- ✅ Autosave (1.5s debounce + on Cmd/Ctrl-S + on tab hide)
- ✅ Page strip at the bottom — the foundation for the freewheel page-flip in Phase 2
- ✅ Dark mode
- ✅ PWA (installable, offline shell)
- ✅ Keyboard shortcuts: `⌘/Ctrl + N` (new), `⌘/Ctrl + S` (save), `⌘/Ctrl + K` (search)

## What's coming

| Phase | Feature |
| ----- | ------- |
| 2 | **Page-flip animation** — `StPageFlip` integrated with the bottom page strip, velocity-driven flip speed, zoom-out on fast scroll |
| 3 | **Drawing canvas** — vector strokes via `perfect-freehand`, Apple Pencil pressure/tilt |
| 4 | **Photo capture → digital page** — OpenCV.js deskew + adaptive threshold + Tesseract.js OCR + SVG trace |
| 5 | **Polished search** — FlexSearch over text + OCR + tags, with date-range filters |
| 6 | **Polish** — better typography work, view-transitions, offline-first IndexedDB cache |

## First-time setup

### 1. Drop your keys into `config.js`

Open `config.js` and paste in your existing API key + OAuth client ID (the same ones from your previous app). Replace the `PASTE_…` placeholders.

`config.js` is in `.gitignore` so it won't be pushed.

### 2. Lock your keys down in Google Cloud Console

This is the only real protection for browser-side keys — visible in source view is fine *as long as* they can't be used from anywhere else:

- **API key** → APIs & Services → Credentials → click your key
  - Application restrictions: **HTTP referrers**
  - Add: `https://YOUR-USERNAME.github.io/*` and `http://localhost:*/*`
- **OAuth client ID** → same place, click your OAuth 2.0 Client ID
  - Authorized JavaScript origins: `https://YOUR-USERNAME.github.io` and `http://localhost:8000`
  - (No redirect URIs needed — this is the token-client flow.)

### 3. Drive scope is now narrower

The previous app used `https://www.googleapis.com/auth/drive` (read/write *all* of your Drive). This one uses `https://www.googleapis.com/auth/drive.file` — only files this app created. You'll see a fresh consent screen the first time you sign in.

### 4. Run it

```sh
# any static server works
python3 -m http.server 8000
# then visit http://localhost:8000
```

Or just push to GitHub Pages.

## File map

```
index.html         # the shell
styles.css         # design tokens + layout
app.js             # auth · drive · pages · editor · search
config.js          # YOUR keys (gitignored)
config.example.js  # template (committed)
logo.svg           # the three-dot stitch
manifest.json      # PWA
service-worker.js  # offline shell cache
```

## Migration from "My Quiet Space"

Not automatic. The old app stored everything in one `journal.json` blob with the full-drive scope. New app stores one file per page with the safer `drive.file` scope, in a fresh folder. If you want to bring old entries over later, that can be a one-shot import script — let me know when you want it.

## Design notes

- **Palette**: paper #F4EFE5, ink #1B1816, vermillion #B33A1A (single accent, used sparingly), binding #2A2521.
- **Type**: Fraunces (display, "soft" axis up) · Newsreader (body) · IBM Plex Mono (meta) · Caveat (handwritten placeholders only).
- **Signature**: three vermillion stitch dots on the left edge of every page — the only loud thing on the surface.
