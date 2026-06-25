/* ============================================================
   Good Old Journaling — app.js (core)
   Auth · Drive · Pages model · Editor wiring
   Other features live in: flip.js, draw.js, photo.js, search.js, idb.js
   ============================================================ */

(() => {
  "use strict";

  const CFG = window.GOJ_CONFIG;
  if (!CFG || CFG.API_KEY.startsWith("PASTE_") || CFG.CLIENT_ID.startsWith("PASTE_")) {
    document.addEventListener("DOMContentLoaded", () => {
      const w = document.getElementById("welcome");
      const m = document.getElementById("welcomeMsg");
      const s = document.getElementById("welcomeSub");
      const b = document.getElementById("welcomeBtn");
      if (m) m.textContent = "Add your keys to config.js";
      if (s) s.textContent = "Open config.js, paste your Google API key and OAuth client ID. Then refresh.";
      if (b) b.hidden = true;
      if (w) w.hidden = false;
    });
    return;
  }

  // -------------------- DOM --------------------
  const el = (id) => document.getElementById(id);
  const D = {
    welcome:        el("welcome"),
    welcomeMsg:     el("welcomeMsg"),
    welcomeSub:     el("welcomeSub"),
    welcomeBtn:     el("welcomeBtn"),
    workspace:      el("workspace"),
    workspaceGrid:  el("workspaceGrid"),
    status:         el("status"),
    statusText:     el("statusText"),
    signoutBtn:     el("signoutBtn"),
    newPageBtn:     el("newPageBtn"),
    sidebarToggle:  el("sidebarToggle"),
    themeToggle:    el("themeToggle"),
    searchInput:    el("searchInput"),
    pagesList:      el("pagesList"),
    pageStage:      el("pageStage"),
    pageEl:         el("pageEl"),
    pageDate:       el("pageDate"),
    pageDateLabel:  el("pageDateLabel"),
    titleInput:     el("titleInput"),
    tagsRow:        el("tagsRow"),
    tagInput:       el("tagInput"),
    editor:         el("editor"),
    drawingsArea:   el("drawingsArea"),
    photosArea:     el("photosArea"),
    pageFootSaved:  el("pageFootSaved"),
    pageFootCount:  el("pageFootCount"),
    toast:          el("toast"),
    drawBtn:        el("drawBtn"),
    photoBtn:       el("photoBtn"),
    photoInput:     el("photoInput"),
  };

  // -------------------- STATE --------------------
  const STATE = {
    gapiReady:  false,
    gisReady:   false,
    tokenClient:null,
    folderId:   null,
    pages:      [],
    currentId:  null,
    filter:     "",
    saveTimer:  null,
    refreshTimer: null,
    saving:     false,
    dirty:      false,
    flipping:   false,
  };

  // -------------------- AUTH --------------------
  const TOKEN_KEY = "goj.token.v1";
  const REFRESH_LEAD_MS = 5 * 60 * 1000;

  function loadStoredToken() {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); }
    catch { return null; }
  }
  function storeToken(t) { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); }
  function clearStoredToken() { localStorage.removeItem(TOKEN_KEY); }
  function tokenValid(t) { return t && t.access_token && t.expires_at && t.expires_at > Date.now() + 30_000; }

  function scheduleRefresh(t) {
    if (STATE.refreshTimer) clearTimeout(STATE.refreshTimer);
    const delay = Math.max(t.expires_at - REFRESH_LEAD_MS - Date.now(), 5000);
    STATE.refreshTimer = setTimeout(() => {
      silentRefresh().catch((e) => {
        console.warn("Silent refresh failed:", e);
        setStatus("Reconnect needed", "error");
      });
    }, delay);
  }

  function tokenFromResponse(resp) {
    return {
      access_token: resp.access_token,
      expires_at:   Date.now() + (resp.expires_in * 1000) - 30_000,
      scope:        resp.scope,
      token_type:   resp.token_type,
    };
  }

  function silentRefresh() {
    return new Promise((resolve, reject) => {
      if (!STATE.tokenClient) return reject(new Error("Token client not ready"));
      STATE.tokenClient.callback = (resp) => {
        if (resp.error) return reject(resp);
        const t = tokenFromResponse(resp);
        storeToken(t);
        gapi.client.setToken({ access_token: t.access_token });
        scheduleRefresh(t);
        setStatus("Connected", "online");
        resolve(t);
      };
      STATE.tokenClient.requestAccessToken({ prompt: "" });
    });
  }

  function interactiveSignIn() {
    return new Promise((resolve, reject) => {
      if (!STATE.tokenClient) return reject(new Error("Token client not ready"));
      STATE.tokenClient.callback = (resp) => {
        if (resp.error) return reject(resp);
        const t = tokenFromResponse(resp);
        storeToken(t);
        gapi.client.setToken({ access_token: t.access_token });
        scheduleRefresh(t);
        setStatus("Connected", "online");
        resolve(t);
      };
      STATE.tokenClient.requestAccessToken({ prompt: "consent" });
    });
  }

  async function tryResumeSession() {
    const stored = loadStoredToken();
    if (tokenValid(stored)) {
      gapi.client.setToken({ access_token: stored.access_token });
      scheduleRefresh(stored);
      setStatus("Connected", "online");
      return true;
    }
    try { await silentRefresh(); return true; }
    catch { return false; }
  }

  function signOut() {
    const stored = loadStoredToken();
    if (stored && window.google && google.accounts) {
      try { google.accounts.oauth2.revoke(stored.access_token); } catch {}
    }
    if (window.gapi && gapi.client) gapi.client.setToken(null);
    clearStoredToken();
    if (STATE.refreshTimer) clearTimeout(STATE.refreshTimer);
    STATE.pages = [];
    STATE.currentId = null;
    STATE.folderId = null;
    showWelcome();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const t = loadStoredToken();
    if (!t) return;
    if (t.expires_at - Date.now() < REFRESH_LEAD_MS) {
      silentRefresh().catch(() => {});
    }
  });

  // -------------------- GAPI / GIS LOAD --------------------
  window.gojGapiLoaded = function () {
    gapi.load("client", async () => {
      try {
        await gapi.client.init({
          apiKey: CFG.API_KEY,
          discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
        });
        STATE.gapiReady = true;
        bootIfReady();
      } catch (e) {
        console.error(e);
        showWelcomeError("Google client failed to load", e.message || "");
      }
    });
  };

  window.gojGisLoaded = function () {
    STATE.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID,
      scope: CFG.SCOPES,
      callback: () => {},
    });
    STATE.gisReady = true;
    bootIfReady();
  };

  async function bootIfReady() {
    if (!STATE.gapiReady || !STATE.gisReady) return;

    // Phase 6: try loading from IndexedDB first so we can render instantly
    if (window.GOJ_IDB) {
      try {
        const cached = await window.GOJ_IDB.loadAllPages();
        if (cached && cached.length) {
          STATE.pages = cached.map(normalizePage);
        }
      } catch (e) { console.warn("IDB load failed", e); }
    }

    const resumed = await tryResumeSession();
    if (resumed) {
      await enterApp();
    } else {
      showWelcome();
    }
  }

  // -------------------- DRIVE --------------------
  async function driveCall(fn) {
    try { return await fn(); }
    catch (err) {
      const status = err?.status || err?.result?.error?.code;
      if (status === 401) {
        try { await silentRefresh(); return await fn(); }
        catch (e2) { throw e2; }
      }
      throw err;
    }
  }

  async function ensureFolder() {
    if (STATE.folderId) return STATE.folderId;
    const cached = localStorage.getItem("goj.folderId");
    if (cached) {
      try {
        const r = await driveCall(() => gapi.client.drive.files.get({ fileId: cached, fields: "id,trashed" }));
        if (!r.result.trashed) { STATE.folderId = cached; return cached; }
      } catch {}
    }
    const list = await driveCall(() => gapi.client.drive.files.list({
      q: `name='${CFG.DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name)", pageSize: 1, spaces: "drive",
    }));
    if (list.result.files && list.result.files.length) {
      STATE.folderId = list.result.files[0].id;
    } else {
      const create = await driveCall(() => gapi.client.drive.files.create({
        resource: { name: CFG.DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" },
        fields: "id",
      }));
      STATE.folderId = create.result.id;
    }
    localStorage.setItem("goj.folderId", STATE.folderId);
    return STATE.folderId;
  }

  async function listPages() {
    await ensureFolder();
    const all = [];
    let pageToken = null;
    do {
      const r = await driveCall(() => gapi.client.drive.files.list({
        q: `'${STATE.folderId}' in parents and mimeType='application/json' and trashed=false`,
        fields: "nextPageToken, files(id,name,modifiedTime,appProperties)",
        pageSize: 100, pageToken, orderBy: "modifiedTime desc",
      }));
      (r.result.files || []).forEach((f) => all.push(f));
      pageToken = r.result.nextPageToken;
    } while (pageToken);
    return all;
  }

  async function downloadPageJson(fileId) {
    const r = await driveCall(() => gapi.client.request({
      path: `/drive/v3/files/${fileId}`, method: "GET", params: { alt: "media" },
    }));
    try { return JSON.parse(r.body); } catch { return null; }
  }

  async function uploadPage(page) {
    await ensureFolder();
    const isNew = !page.fileId;
    const name = pageFileName(page);
    const metadata = {
      name, mimeType: "application/json",
      appProperties: {
        date: page.date,
        tags: (page.tags || []).join(","),
        title: (page.title || "").slice(0, 100),
        schemaVersion: String(page.schemaVersion || 2),
      },
    };
    if (isNew) metadata.parents = [STATE.folderId];

    const boundary = "-------goj" + Math.random().toString(36).slice(2);
    const delim = `\r\n--${boundary}\r\n`;
    const close = `\r\n--${boundary}--`;
    const body =
      delim + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) +
      delim + "Content-Type: application/json\r\n\r\n" + JSON.stringify(page) + close;

    const path = isNew
      ? "/upload/drive/v3/files?uploadType=multipart&fields=id"
      : `/upload/drive/v3/files/${page.fileId}?uploadType=multipart&fields=id`;

    const r = await driveCall(() => gapi.client.request({
      path, method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }));
    return r.result.id;
  }

  // Upload a binary Blob (photo) using fetch — gapi.client.request doesn't handle binary well
  async function uploadBlob(blob, name, parentId) {
    await ensureFolder();
    const metadata = { name, mimeType: blob.type, parents: [parentId || STATE.folderId] };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", blob);
    const doFetch = (token) => fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }
    );
    let token = gapi.client.getToken().access_token;
    let resp = await doFetch(token);
    if (resp.status === 401) {
      await silentRefresh();
      token = gapi.client.getToken().access_token;
      resp = await doFetch(token);
    }
    if (!resp.ok) throw new Error("Upload failed: " + resp.status);
    return (await resp.json()).id;
  }

  async function downloadBlobUrl(fileId) {
    const doFetch = (token) => fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    let token = gapi.client.getToken().access_token;
    let resp = await doFetch(token);
    if (resp.status === 401) {
      await silentRefresh();
      token = gapi.client.getToken().access_token;
      resp = await doFetch(token);
    }
    if (!resp.ok) throw new Error("Download failed: " + resp.status);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  }

  async function deletePageFile(fileId) {
    if (!fileId) return;
    await driveCall(() => gapi.client.drive.files.delete({ fileId })).catch(() => {});
  }

  function pageFileName(p) {
    const safeTitle = (p.title || "untitled").replace(/[^\w\s-]/g, "").slice(0, 40).trim() || "untitled";
    return `page-${p.date}-${safeTitle.replace(/\s+/g, "_")}-${p.id.slice(0, 6)}.json`;
  }

  // -------------------- PAGE MODEL --------------------
  function newPage(date) {
    const now = new Date().toISOString();
    return {
      id: cryptoId(),
      fileId: null,
      date: date || toISODate(new Date()),
      title: "",
      tags: [],
      content: "",
      drawings: [],
      photos: [],
      schemaVersion: 2,
      createdAt: now,
      updatedAt: now,
    };
  }

  function normalizePage(p) {
    return {
      id: p.id,
      fileId: p.fileId || null,
      date: p.date || toISODate(new Date()),
      title: p.title || "",
      tags: Array.isArray(p.tags) ? p.tags : [],
      content: p.content || "",
      drawings: Array.isArray(p.drawings) ? p.drawings : [],
      photos: Array.isArray(p.photos) ? p.photos : [],
      schemaVersion: p.schemaVersion || 2,
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || new Date().toISOString(),
    };
  }

  function cryptoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  function formatDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
  }

  function isToday(iso) { return iso === toISODate(new Date()); }

  function plainText(html) {
    const div = document.createElement("div");
    div.innerHTML = html || "";
    return (div.innerText || "").replace(/\s+/g, " ").trim();
  }

  function searchableTextFor(p) {
    const ocr = (p.photos || []).map((ph) => ph.ocrText || "").join(" ");
    return [p.title, plainText(p.content), (p.tags || []).join(" "), p.date, ocr].join(" ");
  }

  // -------------------- BOOT / LOAD --------------------
  async function enterApp() {
    D.welcome.hidden = true;
    D.workspace.hidden = false;
    setStatus("Syncing…");
    try {
      const files = await listPages();
      const loaded = await Promise.all(files.map(async (f) => {
        const data = await downloadPageJson(f.id);
        if (!data) return null;
        return normalizePage({ ...data, fileId: f.id });
      }));
      const remotePages = loaded.filter(Boolean);

      const merged = mergePageSets(STATE.pages, remotePages);
      STATE.pages = merged;

      if (window.GOJ_IDB) {
        window.GOJ_IDB.saveAllPages(STATE.pages).catch(() => {});
      }

      const today = toISODate(new Date());
      const todaysPage = STATE.pages.find((p) => p.date === today);
      if (todaysPage) STATE.currentId = todaysPage.id;
      else if (STATE.pages.length) {
        const sorted = [...STATE.pages].sort((a, b) => b.date.localeCompare(a.date));
        STATE.currentId = sorted[0].id;
      } else {
        const fresh = newPage();
        STATE.pages.push(fresh);
        STATE.currentId = fresh.id;
      }
      renderAll();
      if (window.GOJ_SEARCH) window.GOJ_SEARCH.rebuild(STATE.pages);
      setStatus("Connected", "online");
    } catch (e) {
      console.error(e);
      setStatus("Couldn't load pages", "error");
    }
  }

  function mergePageSets(cached, remote) {
    const byId = new Map();
    [...cached, ...remote].forEach((p) => {
      const existing = byId.get(p.id);
      if (!existing) { byId.set(p.id, p); return; }
      const useRemote = p.updatedAt > existing.updatedAt;
      const merged = useRemote ? p : existing;
      if (!merged.fileId && (p.fileId || existing.fileId)) merged.fileId = p.fileId || existing.fileId;
      byId.set(p.id, merged);
    });
    return [...byId.values()];
  }

  // -------------------- RENDER --------------------
  function getCurrent() { return STATE.pages.find((p) => p.id === STATE.currentId) || null; }

  function renderAll() {
    renderPagesList();
    renderPageStrip();
    renderEditor();
  }

  function renderPagesList() {
    D.pagesList.innerHTML = "";
    const q = STATE.filter.trim();
    let listToShow;
    if (q) {
      if (window.GOJ_SEARCH && window.GOJ_SEARCH.ready) {
        const hits = window.GOJ_SEARCH.search(q);
        const ids = new Set(hits.map((h) => h.id));
        listToShow = STATE.pages.filter((p) => ids.has(p.id));
      } else {
        const ql = q.toLowerCase();
        listToShow = STATE.pages.filter((p) => searchableTextFor(p).toLowerCase().includes(ql));
      }
    } else {
      listToShow = [...STATE.pages];
    }
    listToShow.sort((a, b) => b.date.localeCompare(a.date));

    if (!listToShow.length) {
      const empty = document.createElement("div");
      empty.className = "empty-hint";
      empty.textContent = q ? "Nothing matches that." : "Your pages will live here.";
      D.pagesList.appendChild(empty);
      return;
    }

    listToShow.forEach((p) => {
      const row = document.createElement("button");
      row.className = "page-row" + (p.id === STATE.currentId ? " active" : "");
      const preview = plainText(p.content).slice(0, 90);
      const counts = [];
      if (p.drawings && p.drawings.length) counts.push(`${p.drawings.length} drawing${p.drawings.length === 1 ? "" : "s"}`);
      if (p.photos && p.photos.length) counts.push(`${p.photos.length} photo${p.photos.length === 1 ? "" : "s"}`);
      row.innerHTML = `
        <div class="page-row-date">${escapeHtml(p.date)}${isToday(p.date) ? " · today" : ""}</div>
        <div class="page-row-title">${escapeHtml(p.title || "Untitled")}</div>
        ${preview ? `<div class="page-row-preview">${escapeHtml(preview)}</div>` : ""}
        ${counts.length ? `<div class="page-row-meta">${counts.join(" · ")}</div>` : ""}
      `;
      row.addEventListener("click", () => {
        navigateTo(p.id);
        if (window.matchMedia("(max-width: 860px)").matches) {
          D.workspaceGrid.classList.remove("show-sidebar");
        }
      });
      D.pagesList.appendChild(row);
    });
  }

  function renderPageStrip() {
    // The bottom strip is replaced by the floating title scrubber (flip.js).
    if (window.GOJ_FLIP && window.GOJ_FLIP.render) {
      const ordered = [...STATE.pages].sort((a, b) => b.date.localeCompare(a.date)); // newest first (top)
      window.GOJ_FLIP.render(ordered, STATE.currentId);
    }
  }

  function renderEditor() {
    const p = getCurrent();
    if (!p) return;
    D.pageDate.textContent = formatDate(p.date);
    D.pageDateLabel.textContent = isToday(p.date) ? "today" : p.date;
    D.pageDateLabel.classList.toggle("today", isToday(p.date));
    D.titleInput.value = p.title || "";
    D.editor.innerHTML = p.content || "";
    renderTags();
    renderDrawings();
    renderPhotos();
    updateFootMeta();
  }

  function renderTags() {
    const p = getCurrent(); if (!p) return;
    [...D.tagsRow.querySelectorAll(".tag")].forEach((n) => n.remove());
    (p.tags || []).forEach((t) => {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.innerHTML = `${escapeHtml(t)} <span class="remove" aria-label="Remove tag">×</span>`;
      chip.querySelector(".remove").addEventListener("click", () => {
        p.tags = p.tags.filter((x) => x !== t);
        markDirty();
        renderTags();
      });
      D.tagsRow.insertBefore(chip, D.tagInput);
    });
  }

  function renderDrawings() {
    const p = getCurrent(); if (!p) return;
    D.drawingsArea.innerHTML = "";
    (p.drawings || []).forEach((dr, idx) => {
      const card = document.createElement("figure");
      card.className = "drawing-card";
      card.innerHTML = `
        <div class="drawing-svg-wrap"></div>
        <figcaption class="block-actions">
          <button class="textbtn delete-drawing" data-idx="${idx}">remove</button>
        </figcaption>
      `;
      const svg = window.GOJ_DRAW ? window.GOJ_DRAW.renderSvg(dr) : null;
      if (svg) card.querySelector(".drawing-svg-wrap").appendChild(svg);
      card.querySelector(".delete-drawing").addEventListener("click", () => {
        if (!confirm("Remove this drawing?")) return;
        p.drawings.splice(idx, 1);
        markDirty();
        renderDrawings();
      });
      D.drawingsArea.appendChild(card);
    });
  }

  function renderPhotos() {
    const p = getCurrent(); if (!p) return;
    D.photosArea.innerHTML = "";
    (p.photos || []).forEach((ph, idx) => {
      const card = document.createElement("figure");
      card.className = "photo-card";
      const imgSrc = ph.thumbnail || "";
      card.innerHTML = `
        <div class="photo-thumb">
          ${imgSrc ? `<img alt="" src="${imgSrc}" />` : `<div class="photo-placeholder">image</div>`}
          <button class="photo-view textbtn" data-idx="${idx}">view full</button>
        </div>
        ${ph.ocrText ? `<figcaption class="photo-ocr">${escapeHtml(ph.ocrText.slice(0, 240))}${ph.ocrText.length > 240 ? "…" : ""}</figcaption>` : ""}
        <div class="block-actions">
          <button class="textbtn delete-photo" data-idx="${idx}">remove</button>
        </div>
      `;
      card.querySelector(".photo-view").addEventListener("click", async () => {
        if (window.GOJ_PHOTO) await window.GOJ_PHOTO.openLightbox(ph);
      });
      card.querySelector(".delete-photo").addEventListener("click", async () => {
        if (!confirm("Remove this photo?")) return;
        if (ph.originalFileId) await deletePageFile(ph.originalFileId);
        if (ph.cleanedFileId) await deletePageFile(ph.cleanedFileId);
        p.photos.splice(idx, 1);
        markDirty();
        renderPhotos();
      });
      D.photosArea.appendChild(card);
    });
  }

  function updateFootMeta() {
    const p = getCurrent(); if (!p) return;
    const words = plainText(p.content).split(/\s+/).filter(Boolean).length;
    D.pageFootCount.textContent = `${words} word${words === 1 ? "" : "s"}`;
    const updated = new Date(p.updatedAt);
    D.pageFootSaved.textContent = STATE.saving
      ? "saving…"
      : `saved ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  // -------------------- NAVIGATION (with Phase 2 flip) --------------------
  async function navigateTo(id, opts = {}) {
    if (id === STATE.currentId) return;
    if (STATE.dirty) savePage();   // background save; don't block the turn

    const current = getCurrent();
    const next = STATE.pages.find((p) => p.id === id);
    if (!next) return;

    let direction = opts.direction;
    if (!direction) direction = current && next.date > current.date ? "right" : "left";

    const F = window.GOJ_FLIP;
    if (opts.flip !== false && F && F.leafTurn && !STATE.flipping) {
      STATE.flipping = true;
      try {
        await F.leafTurn(direction, () => { STATE.currentId = id; renderAll(); });
      } catch (e) {
        STATE.currentId = id; renderAll();
      }
      STATE.flipping = false;
    } else {
      STATE.currentId = id; renderAll();
    }
  }

  // Swap the visible page content instantly (no full rebuild of the scrubber),
  // used by the scrubber while it drives its own page-turn leaves.
  function showPageInstant(id) {
    STATE.currentId = id;
    renderEditor();
    // lightweight active-row highlight in the sidebar
    [...D.pagesList.querySelectorAll(".page-row")].forEach((r) => {
      r.classList.toggle("active", false);
    });
  }

  // After a scrub finishes, fully resync sidebar + scrubber + search.
  function syncAfterScrub() {
    renderAll();
  }

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, [contenteditable]")) return;
    const sorted = [...STATE.pages].sort((a, b) => a.date.localeCompare(b.date));
    const idx = sorted.findIndex((p) => p.id === STATE.currentId);
    if (idx < 0) return;
    if (e.key === "ArrowLeft" && idx > 0) navigateTo(sorted[idx - 1].id);
    if (e.key === "ArrowRight" && idx < sorted.length - 1) navigateTo(sorted[idx + 1].id);
  });

  // -------------------- EDITING / SAVE --------------------
  function markDirty() {
    STATE.dirty = true;
    const p = getCurrent();
    if (p && window.GOJ_IDB) window.GOJ_IDB.savePage(p).catch(() => {});
    saveSoon();
  }

  function saveSoon(immediate = false) {
    if (STATE.saveTimer) clearTimeout(STATE.saveTimer);
    if (immediate) return savePage();
    STATE.saveTimer = setTimeout(savePage, 1500);
  }

  async function savePage() {
    const p = getCurrent();
    if (!p) return;
    STATE.saving = true;
    p.updatedAt = new Date().toISOString();
    updateFootMeta();
    try {
      const id = await uploadPage(p);
      p.fileId = id;
      STATE.dirty = false;
      STATE.saving = false;
      updateFootMeta();
      renderPagesList();
      if (window.GOJ_IDB) window.GOJ_IDB.savePage(p).catch(() => {});
      if (window.GOJ_SEARCH && window.GOJ_SEARCH.ready) window.GOJ_SEARCH.update(p);
    } catch (e) {
      STATE.saving = false;
      console.error(e);
      setStatus("Save failed", "error");
      toast("Couldn't save — check connection");
    }
  }

  window.addEventListener("beforeunload", () => {
    if (STATE.dirty) {
      const p = getCurrent();
      if (p && window.GOJ_IDB) window.GOJ_IDB.savePage(p).catch(() => {});
    }
  });

  // -------------------- UI HELPERS --------------------
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function setStatus(text, mode) {
    D.statusText.textContent = text;
    D.status.classList.remove("online", "error");
    if (mode) D.status.classList.add(mode);
  }

  function toast(msg, ms = 2400) {
    D.toast.textContent = msg;
    D.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => D.toast.classList.remove("show"), ms);
  }

  function showWelcome() {
    D.welcomeMsg.textContent = "Good Old Journaling";
    D.welcomeSub.textContent = "a quiet place to write things down";
    D.welcomeBtn.hidden = false;
    D.welcomeBtn.textContent = "Connect Google Drive";
    D.welcome.hidden = false;
    D.workspace.hidden = true;
    setStatus("Offline");
  }

  function showWelcomeError(title, body) {
    D.welcomeMsg.textContent = title;
    D.welcomeSub.textContent = body;
    D.welcomeBtn.hidden = true;
    D.welcome.hidden = false;
  }

  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("goj.theme", theme);
  }
  applyTheme(localStorage.getItem("goj.theme") || "light");

  // -------------------- WIRING --------------------
  document.addEventListener("DOMContentLoaded", () => {
    D.welcomeBtn.addEventListener("click", async () => {
      try { await interactiveSignIn(); await enterApp(); }
      catch (e) { console.error(e); toast("Sign-in cancelled or blocked"); }
    });

    D.signoutBtn.addEventListener("click", signOut);

    D.newPageBtn.addEventListener("click", () => {
      if (STATE.dirty) savePage();
      const today = toISODate(new Date());
      const todays = STATE.pages.filter((p) => p.date === today);
      const emptyToday = todays.find((p) => !p.title && !plainText(p.content) && !p.drawings.length && !p.photos.length);
      if (emptyToday) { navigateTo(emptyToday.id); return; }
      const p = newPage(today);
      STATE.pages.push(p);
      STATE.currentId = p.id;
      renderAll();
      D.titleInput.focus();
    });

    const isMobile = () => window.matchMedia("(max-width: 860px)").matches;
    function closeSidebar() {
      D.workspaceGrid.classList.remove("show-sidebar");
    }
    D.sidebarToggle.addEventListener("click", () => {
      if (isMobile()) {
        D.workspaceGrid.classList.toggle("show-sidebar");
      } else {
        D.workspaceGrid.classList.toggle("no-sidebar");
      }
    });
    const backdrop = document.getElementById("sidebarBackdrop");
    if (backdrop) backdrop.addEventListener("click", closeSidebar);

    D.themeToggle.addEventListener("click", () => {
      const cur = document.body.getAttribute("data-theme") || "light";
      applyTheme(cur === "light" ? "dark" : "light");
    });

    D.searchInput.addEventListener("input", (e) => {
      STATE.filter = e.target.value;
      renderPagesList();
    });

    D.titleInput.addEventListener("input", (e) => {
      const p = getCurrent(); if (!p) return;
      p.title = e.target.value;
      markDirty();
    });

    D.editor.addEventListener("input", () => {
      const p = getCurrent(); if (!p) return;
      p.content = D.editor.innerHTML;
      markDirty();
      updateFootMeta();
    });

    D.tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const val = D.tagInput.value.trim().replace(/,$/, "");
        if (!val) return;
        const p = getCurrent(); if (!p) return;
        p.tags = p.tags || [];
        if (!p.tags.includes(val)) p.tags.push(val);
        D.tagInput.value = "";
        renderTags();
        markDirty();
      } else if (e.key === "Backspace" && !D.tagInput.value) {
        const p = getCurrent();
        if (p && p.tags && p.tags.length) { p.tags.pop(); renderTags(); markDirty(); }
      }
    });

    D.drawBtn.addEventListener("click", async () => {
      if (!window.GOJ_DRAW) { toast("Drawing module not loaded"); return; }
      const drawing = await window.GOJ_DRAW.openCanvas();
      if (drawing) {
        const p = getCurrent(); if (!p) return;
        p.drawings = p.drawings || [];
        p.drawings.push(drawing);
        markDirty();
        renderDrawings();
      }
    });

    D.photoBtn.addEventListener("click", () => D.photoInput.click());
    D.photoInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      D.photoInput.value = "";
      if (!file) return;
      if (!window.GOJ_PHOTO) { toast("Photo module not loaded"); return; }
      try {
        const photo = await window.GOJ_PHOTO.process(file);
        const p = getCurrent(); if (!p) return;
        p.photos = p.photos || [];
        p.photos.push(photo);
        markDirty();
        renderPhotos();
      } catch (err) {
        console.error(err);
        toast("Couldn't process that photo");
      }
    });

    document.addEventListener("keydown", (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "s") { e.preventDefault(); savePage(); toast("Saved"); }
      if (meta && e.key === "n") { e.preventDefault(); D.newPageBtn.click(); }
      if (meta && e.key === "k") {
        e.preventDefault();
        D.workspaceGrid.classList.add("show-sidebar");
        D.searchInput.focus();
      }
    });
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }

  window.GOJ = {
    STATE, CFG,
    getCurrent, markDirty, savePage, toast, setStatus,
    driveCall, uploadBlob, downloadBlobUrl, ensureFolder,
    navigateTo, newPage, cryptoId, escapeHtml,
    showPageInstant, syncAfterScrub,
    renderPagesList, renderPageStrip, renderEditor, renderAll,
    searchableTextFor, plainText, toISODate, formatDate, isToday,
    silentRefresh, signOut,
  };

})();
