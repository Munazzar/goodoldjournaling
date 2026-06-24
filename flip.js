/* ============================================================
   flip.js — navigation: floating title scrubber + page flips
   ============================================================
   The scrubber is a floating control. Collapsed, it shows ONLY the
   current page's title. Press and hold, then drag vertically to
   scrub through titles with momentum (flick like a phone feed).
   As the centered title changes, the page flips in the direction
   of the drag:
       drag finger UP   → flip LEFT
       drag finger DOWN → flip RIGHT
   On release, momentum carries on, then snaps to the nearest title
   and commits that page.

   Exposes:
     GOJ_FLIP.render(orderedPages, currentId)  — (re)build the list
     GOJ_FLIP.flip({direction, durationMs})     — content-snapshot flip
     GOJ_FLIP.flipSheet(direction, durationMs)  — light blank-sheet flip
     GOJ_FLIP.currentFlipDuration()
   ============================================================ */

(() => {
  "use strict";

  const ROW_H = 44;          // px per title row
  const FLIP_MIN_MS = 110;
  const FLIP_BASE_MS = 560;
  const MOMENTUM_DECAY = 0.94;
  const MOMENTUM_MIN = 0.02; // px/ms below which momentum stops
  const VEL_ALPHA = 0.35;

  let scrubber, viewport, listEl, hintEl;
  let pages = [];            // ordered (newest first, index 0 = top)
  let currentId = null;

  // scrub position in px (0 = first row centered). Higher = later rows.
  let scrollPx = 0;
  let activeIndex = 0;
  let dragging = false;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;          // px/ms, smoothed
  let momentumRaf = null;
  let sheetBusy = false;
  let lastFlipDir = "right";

  function init() {
    scrubber = document.getElementById("scrubber");
    viewport = document.getElementById("scrubberViewport");
    listEl   = document.getElementById("scrubberList");
    hintEl   = document.getElementById("scrubberHint");
    if (!scrubber) return;

    // Pointer interaction
    scrubber.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    // Wheel support on desktop (hold not required — wheel implies intent)
    scrubber.addEventListener("wheel", onWheel, { passive: false });
  }

  // -------- Rendering the list --------
  function render(orderedPages, curId) {
    pages = orderedPages || [];
    currentId = curId;
    if (!listEl) return;

    listEl.innerHTML = "";
    pages.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "scrubber-row" + (p.id === currentId ? " current" : "");
      li.dataset.id = p.id;
      li.dataset.index = i;
      li.innerHTML =
        `<span class="row-title">${esc(p.title || "Untitled")}</span>` +
        `<span class="row-date">${esc(p.date)}</span>`;
      li.addEventListener("click", () => {
        if (dragging) return;
        commitIndex(i, i < activeIndex ? "left" : "right");
      });
      listEl.appendChild(li);
    });

    activeIndex = Math.max(0, pages.findIndex((p) => p.id === currentId));
    scrollPx = activeIndex * ROW_H;
    applyTransform(false);
    setActiveRow();
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function applyTransform(animated) {
    if (!listEl) return;
    listEl.style.transition = animated ? "transform 0.28s cubic-bezier(.22,.61,.36,1)" : "none";
    // center the active row inside the viewport
    const centerY = (viewport.clientHeight / 2) - (ROW_H / 2);
    listEl.style.transform = `translateY(${centerY - scrollPx}px)`;
  }

  function setActiveRow() {
    const rows = listEl.children;
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle("active", i === activeIndex);
    }
  }

  // -------- Interaction --------
  function expand() {
    scrubber.dataset.state = "active";
  }
  function collapse() {
    scrubber.dataset.state = "collapsed";
  }

  function onDown(e) {
    if (!pages.length) return;
    // Ignore clicks on a row when collapsed (let click handler nav) unless we start dragging
    stopMomentum();
    dragging = true;
    velocity = 0;
    lastY = e.clientY;
    lastT = performance.now();
    scrubber.setPointerCapture && scrubber.setPointerCapture(e.pointerId);
    expand();
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const now = performance.now();
    const dy = e.clientY - lastY;
    const dt = Math.max(1, now - lastT);
    // instantaneous velocity, smoothed
    const v = dy / dt;
    velocity = velocity * (1 - VEL_ALPHA) + v * VEL_ALPHA;

    // dragging finger DOWN (dy>0) should move toward earlier rows (scrollPx decreases)
    // and flip RIGHT; finger UP (dy<0) -> later rows, flip LEFT.
    scrollPx -= dy;
    clampScroll();
    applyTransform(false);

    const newIndex = Math.round(scrollPx / ROW_H);
    if (newIndex !== activeIndex) {
      const dir = newIndex > activeIndex ? "left" : "right"; // advancing(down list)=left
      activeIndex = newIndex;
      setActiveRow();
      flipSheet(dir, scrubFlipDuration());
      lastFlipDir = dir;
      haptic();
    }

    lastY = e.clientY;
    lastT = now;
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    startMomentum();
  }

  function onWheel(e) {
    if (!pages.length) return;
    e.preventDefault();
    stopMomentum();
    expand();
    scrollPx += e.deltaY;
    clampScroll();
    applyTransform(false);
    const newIndex = Math.round(scrollPx / ROW_H);
    if (newIndex !== activeIndex) {
      const dir = newIndex > activeIndex ? "left" : "right";
      activeIndex = newIndex;
      setActiveRow();
      flipSheet(dir, scrubFlipDuration());
      lastFlipDir = dir;
    }
    clearTimeout(onWheel._t);
    onWheel._t = setTimeout(settle, 220);
  }

  function clampScroll() {
    const max = (pages.length - 1) * ROW_H;
    if (scrollPx < 0) scrollPx = 0;
    if (scrollPx > max) scrollPx = max;
  }

  function startMomentum() {
    // velocity is px/ms of finger; list moved opposite, so invert
    let v = -velocity;
    const step = () => {
      v *= MOMENTUM_DECAY;
      if (Math.abs(v) < MOMENTUM_MIN) { momentumRaf = null; settle(); return; }
      scrollPx += v * 16;  // ~16ms frame
      clampScroll();
      applyTransform(false);
      const newIndex = Math.round(scrollPx / ROW_H);
      if (newIndex !== activeIndex) {
        const dir = newIndex > activeIndex ? "left" : "right";
        activeIndex = newIndex;
        setActiveRow();
        flipSheet(dir, scrubFlipDuration());
        lastFlipDir = dir;
      }
      // stop if we hit an edge
      const max = (pages.length - 1) * ROW_H;
      if (scrollPx <= 0 || scrollPx >= max) { momentumRaf = null; settle(); return; }
      momentumRaf = requestAnimationFrame(step);
    };
    momentumRaf = requestAnimationFrame(step);
  }

  function stopMomentum() {
    if (momentumRaf) { cancelAnimationFrame(momentumRaf); momentumRaf = null; }
  }

  function settle() {
    // snap to nearest row
    activeIndex = Math.max(0, Math.min(pages.length - 1, Math.round(scrollPx / ROW_H)));
    scrollPx = activeIndex * ROW_H;
    applyTransform(true);
    setActiveRow();
    const target = pages[activeIndex];
    if (target && target.id !== currentId) {
      currentId = target.id;
      // commit without a second flip (we've been flipping sheets during scrub)
      if (window.GOJ && window.GOJ.navigateTo) {
        window.GOJ.navigateTo(target.id, { flip: false, direction: lastFlipDir });
      }
    }
    // collapse shortly after settling
    clearTimeout(settle._t);
    settle._t = setTimeout(() => { if (!dragging) collapse(); }, 650);
  }

  function commitIndex(i, dir) {
    activeIndex = i;
    scrollPx = i * ROW_H;
    applyTransform(true);
    setActiveRow();
    const target = pages[i];
    if (target && target.id !== currentId) {
      currentId = target.id;
      if (window.GOJ && window.GOJ.navigateTo) {
        window.GOJ.navigateTo(target.id, { flip: true, direction: dir });
      }
    }
  }

  function haptic() {
    if (navigator.vibrate) { try { navigator.vibrate(4); } catch {} }
  }

  function scrubFlipDuration() {
    // faster scrub → faster sheet flips
    const speed = Math.abs(velocity); // px/ms
    return Math.max(FLIP_MIN_MS, 320 - speed * 120);
  }

  function currentFlipDuration() {
    return FLIP_BASE_MS;
  }

  // -------- Flip animations --------
  // Light blank-sheet flip used during rapid scrubbing (cheap; no DOM clone).
  function flipSheet(direction = "right", durationMs = 240) {
    if (sheetBusy) return;             // avoid pile-ups during fast flicks
    const stage = document.getElementById("pageStage");
    const pageEl = document.getElementById("pageEl");
    if (!stage || !pageEl) return;

    const rect = pageEl.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const sheet = document.createElement("div");
    sheet.className = "flip-sheet";
    sheet.style.left = (rect.left - stageRect.left) + "px";
    sheet.style.top = (rect.top - stageRect.top) + "px";
    sheet.style.width = rect.width + "px";
    sheet.style.height = rect.height + "px";
    sheet.style.transformOrigin = direction === "left" ? "left center" : "right center";
    stage.appendChild(sheet);

    const target = direction === "left" ? -168 : 168;
    sheetBusy = true;
    const anim = sheet.animate(
      [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${target}deg)` }],
      { duration: durationMs, easing: "cubic-bezier(.5,.05,.5,.95)", fill: "forwards" }
    );
    anim.onfinish = () => { sheet.remove(); sheetBusy = false; };
    anim.oncancel = () => { sheet.remove(); sheetBusy = false; };
  }

  // Deliberate flip with a snapshot of the real page (used for single nav).
  async function flip({ direction = "right", durationMs = FLIP_BASE_MS } = {}) {
    const stage = document.getElementById("pageStage");
    const pageEl = document.getElementById("pageEl");
    if (!stage || !pageEl) return;

    const rect = pageEl.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const snap = pageEl.cloneNode(true);
    snap.classList.add("page-snapshot");
    snap.removeAttribute("id");
    snap.querySelectorAll("input,[contenteditable]").forEach((n) => {
      n.setAttribute("readonly", "");
      n.removeAttribute("contenteditable");
    });
    Object.assign(snap.style, {
      position: "absolute",
      left: (rect.left - stageRect.left) + "px",
      top: (rect.top - stageRect.top) + "px",
      width: rect.width + "px",
      height: rect.height + "px",
      margin: "0",
      pointerEvents: "none",
      willChange: "transform",
      transformOrigin: direction === "left" ? "left center" : "right center",
      backfaceVisibility: "hidden",
      zIndex: "5",
      boxShadow: direction === "left"
        ? "-10px 0 28px -10px rgba(0,0,0,0.35)"
        : "10px 0 28px -10px rgba(0,0,0,0.35)",
    });
    stage.appendChild(snap);

    const targetRot = direction === "left" ? -178 : 178;
    const anim = snap.animate(
      [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${targetRot}deg)` }],
      { duration: durationMs, easing: "cubic-bezier(.55,.05,.45,.95)", fill: "forwards" }
    );
    try { await anim.finished; } catch {}
    snap.remove();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }

  window.GOJ_FLIP = { render, flip, flipSheet, currentFlipDuration };
})();
