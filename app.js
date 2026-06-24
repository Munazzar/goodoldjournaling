/* ============================================================
   Good Old Journaling — app.js
   Phase 1 foundation: auth · Drive · pages · editor · search
   ============================================================ */

(() => {
  "use strict";

  const CFG = window.GOJ_CONFIG;
  if (!CFG || CFG.API_KEY.startsWith("PASTE_") || CFG.CLIENT_ID.startsWith("PASTE_")) {
    showWelcomeError(
      "Add your keys to config.js",
      "Open config.js in your editor and paste in your Google API key and OAuth client ID. Then refresh."
    );
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
    status:         el("status"),
    statusText:     el("statusText"),
    signoutBtn:     el("signoutBtn"),
    newPageBtn:     el("newPageBtn"),
    sidebarToggle:  el("sidebarToggle"),
    themeToggle:    el("themeToggle"),
    searchInput:    el("searchInput"),
    pagesList:      el("pagesList"),
    pagestrip:      el("pagestrip"),
    pageDate:       el("pageDate"),
    pageDateLabel:  el("pageDateLabel"),
    titleInput:     el("titleInput"),
    tagsRow:        el("tagsRow"),
    tagInput:       el("tagInput"),
    editor:         el("editor"),
    pageFootSaved:  el("pageFootSaved"),
    pageFootCount:  el("pageFootCount"),
    toast:          el("toast"),
  };

  // -------------------- STATE --------------------
  const STATE = {
    gapiReady:  false,
    gisReady:   false,
    tokenClient:null,
    folderId:   null,
    pages:      [],          // [{id, fileId, date, title, tags[], content, createdAt, updatedAt}]
    currentId:  null,
    filter:     "",
    saveTimer:  null,
    refreshTimer: null,
    saving:     false,
    dirty:      false,
  };

  // -------------------- AUTH (the part that was broken) --------------------
  // Why login kept repeating:
  //  1. Tokens expire after 1 hour and there's no refresh token in browser OAuth.
  //  2. The old code only attempted silent re-auth once at page load.
  //  3. There was no refresh-before-expiry scheduling.
  // Fixes here:
  //  - schedule silent refresh ~5 min before expiry
  //  - silent refresh again on tab focus if token is close to expiring
  //  - on Drive 401, attempt one silent refresh and retry the call
  //  - drive.file scope (instead of full drive) gives Google fewer reasons to re-prompt

  const TOKEN_KEY = "goj.token.v1";
  const REFRESH_LEAD_MS = 5 * 60 * 1000;

  function loadStoredToken() {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); }
    catch { return null; }
  }

  function storeToken(t) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
  }

  function clearStoredToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function tokenValid(t) {
    return t && t.access_token && t.expires_at && t.expires_at > Date.now() + 30_000;
  }

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
      // expires_in is seconds; subtract a small buffer
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
    // Try silent refresh — works if the user's Google session is still alive.
    try {
      await silentRefresh();
      return true;
    } catch {
      return false;
    }
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

  // Refresh on tab focus if we're getting close to expiry
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const t = loadStoredToken();
    if (!t) return;
    const msLeft = t.expires_at - Date.now();
    if (msLeft < REFRESH_LEAD_MS) {
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
      callback: () => {}, // set per request
    });
    STATE.gisReady = true;
    bootIfReady();
  };

  async function bootIfReady() {
    if (!STATE.gapiReady || !STATE.gisReady) return;

    const resumed = await tryResumeSession();
    if (resumed) {
      await enterApp();
    } else {
      showWelcome();
    }
  }

  // -------------------- DRIVE --------------------
  // With drive.file scope, our app only sees files it created.
  // Strategy: one folder + one file per page + appProperties for indexable metadata.

  async function driveCall(fn) {
    // Wraps a Drive API call with automatic refresh-on-401 retry.
    try {
      return await fn();
    } catch (err) {
      const status = err?.status || err?.result?.error?.code;
      if (status === 401) {
        try {
          await silentRefresh();
          return await fn();
        } catch (e2) {
          throw e2;
        }
      }
      throw err;
    }
  }

  async function ensureFolder() {
    if (STATE.folderId) return STATE.folderId;
    const cached = localStorage.getItem("goj.folderId");
    if (cached) {
      try {
        const r = await driveCall(() => gapi.client.drive.files.get({
          fileId: cached,
          fields: "id,trashed",
        }));
        if (!r.result.trashed) {
          STATE.folderId = cached;
          return cached;
        }
      } catch {}
    }
    // Search by name within the user's drive scope visible to this app
    const list = await driveCall(() => gapi.client.drive.files.list({
      q: `name='${CFG.DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name)",
      pageSize: 1,
      spaces: "drive",
    }));
    if (list.result.files && list.result.files.length) {
      STATE.folderId = list.result.files[0].id;
    } else {
      const create = await driveCall(() => gapi.client.drive.files.create({
        resource: {
          name: CFG.DRIVE_FOLDER_NAME,
          mimeType: "application/vnd.google-apps.folder",
        },
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
        pageSize: 100,
        pageToken,
        orderBy: "modifiedTime desc",
      }));
      (r.result.files || []).forEach((f) => all.push(f));
      pageToken = r.result.nextPageToken;
    } while (pageToken);
    return all;
  }

  async function downloadPageJson(fileId) {
    const r = await driveCall(() => gapi.client.request({
      path: `/drive/v3/files/${fileId}`,
      method: "GET",
      params: { alt: "media" },
    }));
    try { return JSON.parse(r.body); } catch { return null; }
  }

  async function uploadPage(page) {
    await ensureFolder();
    const isNew = !page.fileId;
    const name = pageFileName(page);
    const metadata = {
      name,
      mimeType: "application/json",
      appProperties: {
        date: page.date,
        tags: (page.tags || []).join(","),
        title: (page.title || "").slice(0, 100),
      },
    };
    if (isNew) metadata.parents = [STATE.folderId];

    // Multipart upload (metadata + content in one request)
    const boundary = "-------goj" + Math.random().toString(36).slice(2);
    const delim = `\r\n--${boundary}\r\n`;
    const close = `\r\n--${boundary}--`;
    const body =
      delim +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delim +
      "Content-Type: application/json\r\n\r\n" +
      JSON.stringify(page) +
      close;

    const path = isNew
      ? "/upload/drive/v3/files?uploadType=multipart&fields=id"
      : `/upload/drive/v3/files/${page.fileId}?uploadType=multipart&fields=id`;

    const r = await driveCall(() => gapi.client.request({
      path,
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }));
    return r.result.id;
  }

  async function deletePageFile(fileId) {
    await driveCall(() => gapi.client.drive.files.delete({ fileId }));
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
      content: "",        // HTML for now; future: blocks[]
      createdAt: now,
      updatedAt: now,
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
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  function isToday(iso) {
    return iso === toISODate(new Date());
  }

  function plainText(html) {
    const div = document.createElement("div");
    div.innerHTML = html || "";
    return (div.innerText || "").replace(/\s+/g, " ").trim();
  }

  // -------------------- BOOT / LOAD --------------------
  async function enterApp() {
    D.welcome.hidden = true;
    D.workspace.hidden = false;
    setStatus("Loading…");
    try {
      const files = await listPages();
      const loaded = await Promise.all(files.map(async (f) => {
        const data = await downloadPageJson(f.id);
        if (!data) return null;
        return { ...data, fileId: f.id };
      }));
      STATE.pages = loaded.filter(Boolean);
      // Default to today's page if exists, else newest, else new
      const today = toISODate(new Date());
      const todaysPage = STATE.pages.find((p) => p.date === today);
      if (todaysPage) {
        STATE.currentId = todaysPage.id;
      } else if (STATE.pages.length) {
        STATE.currentId = STATE.pages[0].id;
      } else {
        const fresh = newPage();
        STATE.pages.push(fresh);
        STATE.currentId = fresh.id;
      }
      renderAll();
      setStatus("Connected", "online");
    } catch (e) {
      console.error(e);
      setStatus("Couldn't load pages", "error");
    }
  }

  // -------------------- RENDER --------------------
  function getCurrent() {
    return STATE.pages.find((p) => p.id === STATE.currentId) || null;
  }

  function renderAll() {
    renderPagesList();
    renderPageStrip();
    renderEditor();
  }

  function renderPagesList() {
    D.pagesList.innerHTML = "";
    const q = STATE.filter.trim().toLowerCase();

    const sorted = [...STATE.pages].sort((a, b) => b.date.localeCompare(a.date));
    const filtered = q
      ? sorted.filter((p) => {
          const hay = (
            (p.title || "") + " " +
            plainText(p.content) + " " +
            (p.tags || []).join(" ") + " " +
            p.date
          ).toLowerCase();
          return hay.includes(q);
        })
      : sorted;

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-hint";
      empty.textContent = q ? "Nothing matches that." : "Your pages will live here.";
      D.pagesList.appendChild(empty);
      return;
    }

    filtered.forEach((p) => {
      const row = document.createElement("button");
      row.className = "page-row" + (p.id === STATE.currentId ? " active" : "");
      const preview = plainText(p.content).slice(0, 90);
      row.innerHTML = `
        <div class="page-row-date">${escapeHtml(p.date)}${isToday(p.date) ? " · today" : ""}</div>
        <div class="page-row-title">${escapeHtml(p.title || "Untitled")}</div>
        ${preview ? `<div class="page-row-preview">${escapeHtml(preview)}</div>` : ""}
      `;
      row.addEventListener("click", () => switchTo(p.id));
      D.pagesList.appendChild(row);
    });
  }

  function renderPageStrip() {
    D.pagestrip.innerHTML = "";
    const sorted = [...STATE.pages].sort((a, b) => a.date.localeCompare(b.date));
    sorted.forEach((p) => {
      const tick = document.createElement("button");
      tick.className = "pagestrip-tick" + (p.id === STATE.currentId ? " active" : "");
      tick.textContent = p.date;
      tick.addEventListener("click", () => switchTo(p.id));
      D.pagestrip.appendChild(tick);
    });
    // Scroll the active one into view
    requestAnimationFrame(() => {
      const active = D.pagestrip.querySelector(".active");
      if (active) active.scrollIntoView({ inline: "center", block: "nearest" });
    });
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
    updateFootMeta();
  }

  function renderTags() {
    const p = getCurrent();
    if (!p) return;
    // Remove existing tag chips (keep the input)
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

  function updateFootMeta() {
    const p = getCurrent();
    if (!p) return;
    const words = plainText(p.content).split(/\s+/).filter(Boolean).length;
    D.pageFootCount.textContent = `${words} word${words === 1 ? "" : "s"}`;
    const updated = new Date(p.updatedAt);
    D.pageFootSaved.textContent = STATE.saving
      ? "saving…"
      : `saved ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  function switchTo(id) {
    if (STATE.dirty) saveSoon(true); // flush
    STATE.currentId = id;
    renderAll();
  }

  // -------------------- EDITING --------------------
  function markDirty() {
    STATE.dirty = true;
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
    } catch (e) {
      STATE.saving = false;
      console.error(e);
      setStatus("Save failed", "error");
      toast("Couldn't save — check connection");
    }
  }

  // Flush on tab hide (in case the autosave timer hasn't fired)
  window.addEventListener("pagehide", () => {
    if (STATE.dirty) {
      // Synchronous best-effort: localStorage backup
      localStorage.setItem("goj.unsaved", JSON.stringify(getCurrent()));
    }
  });
  window.addEventListener("beforeunload", () => {
    if (STATE.dirty) {
      localStorage.setItem("goj.unsaved", JSON.stringify(getCurrent()));
    }
  });

  // -------------------- UI WIRING --------------------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  // Theme
  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("goj.theme", theme);
  }
  applyTheme(localStorage.getItem("goj.theme") || "light");

  // Event wiring on DOM ready
  document.addEventListener("DOMContentLoaded", () => {
    D.welcomeBtn.addEventListener("click", async () => {
      try {
        await interactiveSignIn();
        await enterApp();
      } catch (e) {
        console.error(e);
        toast("Sign-in cancelled or blocked");
      }
    });

    D.signoutBtn.addEventListener("click", signOut);

    D.newPageBtn.addEventListener("click", () => {
      if (STATE.dirty) savePage();
      const today = toISODate(new Date());
      // If we already have a page for today and it's empty, just switch to it
      const todays = STATE.pages.filter((p) => p.date === today);
      const emptyToday = todays.find((p) => !p.title && !plainText(p.content));
      if (emptyToday) {
        switchTo(emptyToday.id);
        return;
      }
      const p = newPage(today);
      STATE.pages.push(p);
      STATE.currentId = p.id;
      renderAll();
      D.titleInput.focus();
    });

    D.sidebarToggle.addEventListener("click", () => {
      D.workspace.classList.toggle("show-sidebar");
      D.workspace.classList.toggle("no-sidebar");
    });

    D.themeToggle.addEventListener("click", () => {
      const cur = document.body.getAttribute("data-theme") || "light";
      applyTheme(cur === "light" ? "dark" : "light");
    });

    D.searchInput.addEventListener("input", (e) => {
      STATE.filter = e.target.value;
      renderPagesList();
    });

    D.titleInput.addEventListener("input", (e) => {
      const p = getCurrent();
      if (!p) return;
      p.title = e.target.value;
      markDirty();
    });

    D.editor.addEventListener("input", () => {
      const p = getCurrent();
      if (!p) return;
      p.content = D.editor.innerHTML;
      markDirty();
      updateFootMeta();
    });

    // Tag input — comma or Enter commits
    D.tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const val = D.tagInput.value.trim().replace(/,$/, "");
        if (!val) return;
        const p = getCurrent();
        if (!p) return;
        p.tags = p.tags || [];
        if (!p.tags.includes(val)) p.tags.push(val);
        D.tagInput.value = "";
        renderTags();
        markDirty();
      } else if (e.key === "Backspace" && !D.tagInput.value) {
        const p = getCurrent();
        if (p && p.tags && p.tags.length) {
          p.tags.pop();
          renderTags();
          markDirty();
        }
      }
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "s") {
        e.preventDefault();
        savePage();
        toast("Saved");
      }
      if (meta && e.key === "n") {
        e.preventDefault();
        D.newPageBtn.click();
      }
      if (meta && e.key === "k") {
        e.preventDefault();
        D.workspace.classList.add("show-sidebar");
        D.searchInput.focus();
      }
    });
  });

  // PWA service worker
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }

  // Expose a tiny debug surface (no secrets)
  window.GOJ = {
    state: STATE,
    signOut,
    refresh: silentRefresh,
  };
})();
