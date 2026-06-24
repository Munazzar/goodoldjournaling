/* ============================================================
   search.js — Phase 5: full-text search over pages
   ============================================================
   Indexes title + content + OCR text + tags + date.
   Falls back gracefully to substring search (in app.js) if the
   library can't load.

   API:
     GOJ_SEARCH.rebuild(pages)  — build the index from scratch
     GOJ_SEARCH.update(page)    — add/replace one page
     GOJ_SEARCH.remove(id)      — drop one page
     GOJ_SEARCH.search(query)   — returns [{id}] ranked
     GOJ_SEARCH.ready           — boolean
   ============================================================ */

(() => {
  "use strict";

  const FLEXSEARCH_URL = "https://cdn.jsdelivr.net/npm/flexsearch@0.7.43/dist/flexsearch.bundle.min.js";

  const API = {
    ready: false,
    rebuild,
    update,
    remove,
    search,
  };

  let index = null;
  let pending = null; // pages waiting for the library to finish loading

  function plainText(html) {
    if (window.GOJ && window.GOJ.plainText) return window.GOJ.plainText(html);
    const div = document.createElement("div");
    div.innerHTML = html || "";
    return (div.innerText || "").replace(/\s+/g, " ").trim();
  }

  function docFor(p) {
    const ocr = (p.photos || []).map((ph) => ph.ocrText || "").join(" ");
    return {
      id: p.id,
      title: p.title || "",
      content: plainText(p.content),
      ocr,
      tags: (p.tags || []).join(" "),
      date: p.date || "",
    };
  }

  function buildIndex() {
    // Document index across multiple fields
    index = new FlexSearch.Document({
      tokenize: "forward",
      document: {
        id: "id",
        index: [
          { field: "title",   tokenize: "forward" },
          { field: "content", tokenize: "forward" },
          { field: "ocr",     tokenize: "forward" },
          { field: "tags",    tokenize: "strict"  },
          { field: "date",    tokenize: "strict"  },
        ],
      },
    });
  }

  let loadStarted = false;
  function ensureLoaded() {
    if (window.FlexSearch) return Promise.resolve();
    if (loadStarted) return waitForGlobal();
    loadStarted = true;
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = FLEXSEARCH_URL;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn't load FlexSearch"));
      document.head.appendChild(s);
    });
  }

  function waitForGlobal() {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const iv = setInterval(() => {
        if (window.FlexSearch) { clearInterval(iv); resolve(); }
        else if (++tries > 100) { clearInterval(iv); reject(new Error("FlexSearch load timeout")); }
      }, 50);
    });
  }

  async function rebuild(pages) {
    pending = pages;
    try {
      await ensureLoaded();
    } catch (e) {
      console.warn(e);
      API.ready = false;
      return; // app.js falls back to substring search
    }
    buildIndex();
    (pending || []).forEach((p) => index.add(docFor(p)));
    pending = null;
    API.ready = true;
  }

  function update(page) {
    if (!API.ready || !index) return;
    try { index.update(docFor(page)); }
    catch { try { index.add(docFor(page)); } catch {} }
  }

  function remove(id) {
    if (!API.ready || !index) return;
    try { index.remove(id); } catch {}
  }

  function search(query) {
    if (!API.ready || !index || !query) return [];
    // Search across all fields, merge unique ids preserving rank order
    const results = index.search(query, { limit: 100, enrich: false });
    const seen = new Set();
    const ids = [];
    results.forEach((fieldResult) => {
      (fieldResult.result || []).forEach((id) => {
        if (!seen.has(id)) { seen.add(id); ids.push(id); }
      });
    });
    return ids.map((id) => ({ id }));
  }

  window.GOJ_SEARCH = API;
})();
