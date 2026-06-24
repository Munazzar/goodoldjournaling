/* ============================================================
   idb.js — Phase 6: IndexedDB cache for offline-first reads
   ============================================================
   Stores a local copy of every page so the app renders instantly
   on load (before the Drive sync completes) and survives brief
   network drops. Drive remains the source of truth; this is a cache.

   API:
     GOJ_IDB.loadAllPages()       — Promise<page[]>
     GOJ_IDB.savePage(page)       — Promise<void>
     GOJ_IDB.saveAllPages(pages)  — Promise<void>
     GOJ_IDB.deletePage(id)       — Promise<void>
   ============================================================ */

(() => {
  "use strict";

  const IDB_URL = "https://cdn.jsdelivr.net/npm/idb@8/build/umd.js";
  const DB_NAME = "goj-db";
  const STORE = "pages";

  let dbPromise = null;

  function loadIdbLib() {
    if (window.idb) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = IDB_URL;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn't load idb"));
      document.head.appendChild(s);
    });
  }

  async function getDb() {
    if (dbPromise) return dbPromise;
    await loadIdbLib();
    dbPromise = window.idb.openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      },
    });
    return dbPromise;
  }

  async function loadAllPages() {
    try {
      const db = await getDb();
      return await db.getAll(STORE);
    } catch (e) {
      console.warn("IDB loadAllPages failed", e);
      return [];
    }
  }

  async function savePage(page) {
    try {
      const db = await getDb();
      // Strip transient/object-url fields before persisting
      await db.put(STORE, JSON.parse(JSON.stringify(page)));
    } catch (e) {
      console.warn("IDB savePage failed", e);
    }
  }

  async function saveAllPages(pages) {
    try {
      const db = await getDb();
      const tx = db.transaction(STORE, "readwrite");
      await Promise.all([
        ...pages.map((p) => tx.store.put(JSON.parse(JSON.stringify(p)))),
        tx.done,
      ]);
    } catch (e) {
      console.warn("IDB saveAllPages failed", e);
    }
  }

  async function deletePage(id) {
    try {
      const db = await getDb();
      await db.delete(STORE, id);
    } catch (e) {
      console.warn("IDB deletePage failed", e);
    }
  }

  window.GOJ_IDB = { loadAllPages, savePage, saveAllPages, deletePage };
})();
