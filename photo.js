/* ============================================================
   photo.js — Phase 4: photo → cleaned digital page + OCR
   ============================================================
   - process(file) returns a photo object after running the
     image through OpenCV.js (adaptive threshold to separate
     text from background) and Tesseract.js (OCR).
   - Both libraries load lazily on first use (combined ~20MB
     including Tesseract language data). Subsequent photos reuse
     the loaded modules.

   Photo object shape:
   {
     id, originalFileId, cleanedFileId, thumbnail (base64 data URL),
     ocrText, width, height, createdAt
   }

   Honest limitations:
   - Tesseract handwriting OCR is mediocre. Printed text is great,
     cursive is hit-or-miss. For better handwriting recognition,
     Google Cloud Vision (free tier) is a future option.
   - Photos taken at an angle won't be auto-perspective-corrected
     in this version — the adaptive threshold still produces a
     usable cleaned page, and OCR is reasonably angle-tolerant.
   ============================================================ */

(() => {
  "use strict";

  const OPENCV_URL    = "https://docs.opencv.org/4.10.0/opencv.js";
  const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const MAX_PROCESS_DIM = 2000; // downscale very large images

  // -------- Lazy loaders --------
  let cvLoading = null;
  function loadOpenCV() {
    if (cvLoading) return cvLoading;
    cvLoading = new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
      const hardTimeout = setTimeout(() => done(reject, new Error("OpenCV load timed out")), 25000);
      const ready = () => {
        if (window.cv && cv.Mat) { clearTimeout(hardTimeout); done(resolve); return; }
        const interval = setInterval(() => {
          if (window.cv && cv.Mat) { clearInterval(interval); clearTimeout(hardTimeout); done(resolve); }
        }, 50);
      };
      const script = document.createElement("script");
      script.src = OPENCV_URL;
      script.async = true;
      script.onload = ready;
      script.onerror = () => { clearTimeout(hardTimeout); done(reject, new Error("Couldn't load OpenCV.js")); };
      document.head.appendChild(script);
    });
    // If it fails, allow a future retry
    cvLoading.catch(() => { cvLoading = null; });
    return cvLoading;
  }

  let tessLoading = null;
  function loadTesseract() {
    if (tessLoading) return tessLoading;
    tessLoading = new Promise((resolve, reject) => {
      if (window.Tesseract) { resolve(); return; }
      const s = document.createElement("script");
      s.src = TESSERACT_URL;
      s.async = true;
      const to = setTimeout(() => reject(new Error("Tesseract load timed out")), 25000);
      s.onload = () => { clearTimeout(to); resolve(); };
      s.onerror = () => { clearTimeout(to); reject(new Error("Couldn't load Tesseract.js")); };
      document.head.appendChild(s);
    });
    tessLoading.catch(() => { tessLoading = null; });
    return tessLoading;
  }

  // -------- Progress modal --------
  function openProgress() {
    const el = document.createElement("div");
    el.className = "progress-overlay";
    el.innerHTML = `
      <div class="progress-card">
        <div class="progress-mark">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
        <p class="progress-step">Preparing…</p>
        <div class="progress-bar"><div class="progress-fill"></div></div>
        <p class="progress-hint">First time? Loading image-processing libraries. Subsequent photos will be much faster.</p>
      </div>
    `;
    document.body.appendChild(el);
    const stepEl = el.querySelector(".progress-step");
    const fill   = el.querySelector(".progress-fill");
    return {
      setStep(text, pct) {
        stepEl.textContent = text;
        if (typeof pct === "number") fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      },
      close() { el.remove(); },
    };
  }

  // -------- Helpers --------
  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve({ img, url }); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function downsize(w, h, maxDim) {
    if (w <= maxDim && h <= maxDim) return { width: w, height: h };
    const r = Math.min(maxDim / w, maxDim / h);
    return { width: Math.round(w * r), height: Math.round(h * r) };
  }

  function canvasToBlob(canvas, type = "image/png", quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  function canvasToDataUrl(canvas, type = "image/jpeg", quality = 0.78) {
    return canvas.toDataURL(type, quality);
  }

  function makeThumbnail(srcCanvas, maxDim = 280) {
    const { width, height } = downsize(srcCanvas.width, srcCanvas.height, maxDim);
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const ctx = c.getContext("2d");
    ctx.drawImage(srcCanvas, 0, 0, width, height);
    return canvasToDataUrl(c);
  }

  // -------- OpenCV: adaptive threshold to clean the page --------
  function cleanWithOpenCV(srcCanvas) {
    const src = cv.imread(srcCanvas);
    const gray = new cv.Mat();
    const blur = new cv.Mat();
    const thresh = new cv.Mat();
    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0);
      // Adaptive Gaussian threshold — block size 25, C=12 are reasonable defaults.
      cv.adaptiveThreshold(blur, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 25, 12);

      // Composite onto a clean paper background for the saved "cleaned" image:
      // white where threshold is white, ink color where threshold is black
      const outCanvas = document.createElement("canvas");
      outCanvas.width = srcCanvas.width;
      outCanvas.height = srcCanvas.height;
      cv.imshow(outCanvas, thresh);

      // Tint the output: white→paper, black→ink, instead of pure black/white
      const ctx = outCanvas.getContext("2d");
      const imgData = ctx.getImageData(0, 0, outCanvas.width, outCanvas.height);
      const d = imgData.data;
      // paper #F4EFE5 = 244 239 229
      // ink   #1B1816 = 27 24 22
      for (let i = 0; i < d.length; i += 4) {
        const v = d[i]; // grayscale after threshold; r=g=b
        if (v > 128) {
          d[i] = 244; d[i+1] = 239; d[i+2] = 229;
        } else {
          d[i] = 27;  d[i+1] = 24;  d[i+2] = 22;
        }
        d[i+3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);

      return outCanvas;
    } finally {
      src.delete(); gray.delete(); blur.delete(); thresh.delete();
    }
  }

  // -------- Tesseract OCR --------
  async function runOCR(canvasOrBlob, onProgress) {
    const worker = await Tesseract.createWorker("eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text" && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      },
    });
    try {
      const { data } = await worker.recognize(canvasOrBlob);
      return (data && data.text ? data.text : "").trim();
    } finally {
      try { await worker.terminate(); } catch {}
    }
  }

  // -------- The pipeline --------
  async function process(file) {
    const progress = openProgress();
    const photoId = (window.GOJ && window.GOJ.cryptoId) ? window.GOJ.cryptoId() : Math.random().toString(36).slice(2);

    // Read + downscale the image. This must succeed for us to add anything.
    progress.setStep("Reading image…", 5);
    const { img, url } = await loadImageFromFile(file);
    const { width, height } = downsize(img.naturalWidth, img.naturalHeight, MAX_PROCESS_DIM);
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = width;
    srcCanvas.height = height;
    srcCanvas.getContext("2d").drawImage(img, 0, 0, width, height);

    // Thumbnail from the ORIGINAL — never depends on OpenCV.
    const thumbnail = makeThumbnail(srcCanvas, 320);
    const dateStr = (window.GOJ && window.GOJ.toISODate) ? window.GOJ.toISODate(new Date()) : new Date().toISOString().slice(0,10);
    const base = `photo-${dateStr}-${photoId.slice(0, 6)}`;

    // STEP 1 — upload the original. This is the "at least add the image" guarantee.
    progress.setStep("Saving image…", 20);
    let originalFileId = null;
    try {
      const originalBlob = await canvasToBlob(srcCanvas, "image/jpeg", 0.85);
      originalFileId = await window.GOJ.uploadBlob(originalBlob, `${base}-original.jpg`);
    } catch (e) {
      // If even the original upload fails, we can't store it — surface the error.
      URL.revokeObjectURL(url);
      progress.close();
      throw e;
    }

    // STEP 2 — best-effort cleaning (OpenCV). Failure is fine.
    let cleanedFileId = null;
    let cleanedCanvas = null;
    try {
      progress.setStep("Cleaning the page (first time loads tools)…", 40);
      await loadOpenCV();
      cleanedCanvas = cleanWithOpenCV(srcCanvas);
      const cleanedBlob = await canvasToBlob(cleanedCanvas, "image/png");
      cleanedFileId = await window.GOJ.uploadBlob(cleanedBlob, `${base}-cleaned.png`);
    } catch (e) {
      console.warn("Cleaning skipped:", e);
      cleanedFileId = null; // lightbox will just show the original
    }

    // STEP 3 — best-effort OCR (Tesseract). Failure is fine.
    let ocrText = "";
    try {
      progress.setStep("Reading text (first time loads tools)…", 70);
      await loadTesseract();
      ocrText = await runOCR(cleanedCanvas || srcCanvas, (pct) => {
        progress.setStep("Reading text…", 70 + Math.round(pct * 0.25));
      });
    } catch (e) {
      console.warn("OCR skipped:", e);
      ocrText = "";
    }

    progress.setStep("Done", 100);
    URL.revokeObjectURL(url);
    setTimeout(() => progress.close(), 200);

    if (window.GOJ && window.GOJ.toast) {
      if (!cleanedFileId && !ocrText) window.GOJ.toast("Image added (auto-processing unavailable)");
      else if (!ocrText) window.GOJ.toast("Image added (no text detected)");
    }

    return {
      id: photoId,
      originalFileId,
      cleanedFileId,   // may be null
      thumbnail,
      ocrText,
      width, height,
      createdAt: new Date().toISOString(),
    };
  }

  // -------- Lightbox --------
  async function openLightbox(photo) {
    const hasCleaned = !!photo.cleanedFileId;
    const defaultMode = hasCleaned ? "cleaned" : "original";
    const tabs = [];
    if (hasCleaned) tabs.push(`<button class="lightbox-tab active" data-mode="cleaned">cleaned</button>`);
    tabs.push(`<button class="lightbox-tab${hasCleaned ? "" : " active"}" data-mode="original">original</button>`);

    const overlay = document.createElement("div");
    overlay.className = "lightbox-overlay";
    overlay.innerHTML = `
      <div class="lightbox-topbar">
        <div class="lightbox-tabs">${tabs.join("")}</div>
        <button class="btn" id="lbClose">Close</button>
      </div>
      <div class="lightbox-body">
        <div class="lightbox-image-wrap"><div class="lightbox-loading">loading…</div></div>
        <aside class="lightbox-text">
          <p class="lightbox-text-label">Extracted text</p>
          <pre class="lightbox-text-content">${(photo.ocrText || "(no text detected)").replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"})[c])}</pre>
        </aside>
      </div>
    `;
    document.body.appendChild(overlay);

    const wrap = overlay.querySelector(".lightbox-image-wrap");
    let cleanedUrl = null, originalUrl = null;

    async function showMode(mode) {
      wrap.innerHTML = `<div class="lightbox-loading">loading…</div>`;
      try {
        let url;
        if (mode === "cleaned" && photo.cleanedFileId) {
          if (!cleanedUrl) cleanedUrl = await window.GOJ.downloadBlobUrl(photo.cleanedFileId);
          url = cleanedUrl;
        } else {
          if (!originalUrl) originalUrl = await window.GOJ.downloadBlobUrl(photo.originalFileId);
          url = originalUrl;
        }
        wrap.innerHTML = `<img alt="" src="${url}" />`;
      } catch (e) {
        wrap.innerHTML = `<div class="lightbox-loading">couldn't load image</div>`;
      }
    }

    overlay.querySelectorAll(".lightbox-tab").forEach((b) => {
      b.addEventListener("click", () => {
        overlay.querySelectorAll(".lightbox-tab").forEach((x) => x.classList.toggle("active", x === b));
        showMode(b.dataset.mode);
      });
    });

    function close() {
      if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    overlay.querySelector("#lbClose").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    showMode(defaultMode);
  }

  window.GOJ_PHOTO = { process, openLightbox };
})();
