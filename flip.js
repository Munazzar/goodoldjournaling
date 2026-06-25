/* ============================================================
   flip.js — floating title scrubber + real book-page turns
   ============================================================
   At rest the scrubber shows ONLY the current title, pinned to the
   bottom of the screen. Drag it (or focus + wheel) to scrub titles
   with momentum. Every title you cross turns a real page: a leaf
   anchored at the spine rotates away to reveal the next page.

       scroll up   → pages turn LEFT  (forward)
       scroll down → pages turn RIGHT (back)

   Exposes:
     GOJ_FLIP.render(orderedPages, currentId)
     GOJ_FLIP.leafTurn(direction, swapFn) → Promise  (one page turn)
     GOJ_FLIP.currentFlipDuration()
   ============================================================ */

(() => {
  "use strict";

  const ROW_H = 40;
  const MOMENTUM_DECAY = 0.93;
  const MOMENTUM_MIN = 0.02;
  const VEL_ALPHA = 0.4;
  const SLOW_VEL = 1.1;          // below this → rich (cloned) leaf; above → blank leaf
  const TURN_SLOW_MS = 360;
  const TURN_FAST_MS = 150;

  let scrubber, viewport, listEl, stageEl, pageEl;
  let pages = [];
  let currentId = null;

  let scrollPx = 0;
  let activeIndex = 0;
  let dragging = false;
  let lastY = 0, lastT = 0;
  let velocity = 0;
  let momentumRaf = null;
  let lastDir = "left";

  let activeLeaf = null;
  let activeAnim = null;

  function init() {
    scrubber = document.getElementById("scrubber");
    viewport = document.getElementById("scrubberViewport");
    listEl   = document.getElementById("scrubberList");
    stageEl  = document.getElementById("pageStage");
    pageEl   = document.getElementById("pageEl");
    if (!scrubber) return;

    scrubber.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    scrubber.addEventListener("wheel", onWheel, { passive: false });

    scrubber.setAttribute("tabindex", "0");
    scrubber.addEventListener("focus", expand);
    scrubber.addEventListener("blur", () => { if (!dragging) collapse(); });
  }

  // -------- Render the title list --------
  function render(orderedPages, curId) {
    pages = orderedPages || [];
    currentId = curId;
    if (!listEl) return;
    listEl.innerHTML = "";
    pages.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "scrubber-row" + (p.id === currentId ? " current" : "");
      li.dataset.id = p.id;
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
    if (!listEl || !viewport) return;
    listEl.style.transition = animated ? "transform 0.26s cubic-bezier(.22,.61,.36,1)" : "none";
    const centerY = (viewport.clientHeight / 2) - (ROW_H / 2);
    listEl.style.transform = `translateY(${centerY - scrollPx}px)`;
  }

  function setActiveRow() {
    const rows = listEl.children;
    for (let i = 0; i < rows.length; i++) rows[i].classList.toggle("active", i === activeIndex);
  }

  function expand() { scrubber.dataset.state = "active"; }
  function collapse() { scrubber.dataset.state = "collapsed"; }

  // -------- Interaction --------
  function onDown(e) {
    if (!pages.length) return;
    stopMomentum();
    dragging = true;
    velocity = 0;
    lastY = e.clientY;
    lastT = performance.now();
    try { scrubber.setPointerCapture(e.pointerId); } catch {}
    expand();
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const now = performance.now();
    const dy = e.clientY - lastY;
    const dt = Math.max(1, now - lastT);
    velocity = velocity * (1 - VEL_ALPHA) + (dy / dt) * VEL_ALPHA;

    scrollPx -= dy;
    clampScroll();
    applyTransform(false);
    handleIndexChange();
    lastY = e.clientY;
    lastT = now;
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    startMomentum();
  }

  function onWheel(e) {
    if (!pages.length) return;
    e.preventDefault();
    stopMomentum();
    expand();
    velocity = -e.deltaY / 16;
    scrollPx += e.deltaY;
    clampScroll();
    applyTransform(false);
    handleIndexChange();
    clearTimeout(onWheel._t);
    onWheel._t = setTimeout(settle, 220);
  }

  function clampScroll() {
    const max = (pages.length - 1) * ROW_H;
    if (scrollPx < 0) scrollPx = 0;
    if (scrollPx > max) scrollPx = max;
  }

  function handleIndexChange() {
    const ni = Math.round(scrollPx / ROW_H);
    if (ni === activeIndex) return;
    const dir = ni > activeIndex ? "left" : "right";   // forward=left, back=right
    lastDir = dir;
    activeIndex = ni;                                   // jump (don't turn every intermediate)
    const target = pages[activeIndex];
    if (target) turnTo(target.id, dir);
    setActiveRow();
    haptic();
  }

  function startMomentum() {
    let v = -velocity;
    const step = () => {
      v *= MOMENTUM_DECAY;
      if (Math.abs(v) < MOMENTUM_MIN) { momentumRaf = null; settle(); return; }
      velocity = v;
      scrollPx += v * 16;
      clampScroll();
      applyTransform(false);
      handleIndexChange();
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
    activeIndex = Math.max(0, Math.min(pages.length - 1, Math.round(scrollPx / ROW_H)));
    scrollPx = activeIndex * ROW_H;
    applyTransform(true);
    setActiveRow();
    finishLeaf();
    const target = pages[activeIndex];
    if (target && target.id !== currentId) {
      currentId = target.id;
      if (window.GOJ && window.GOJ.showPageInstant) window.GOJ.showPageInstant(target.id);
    }
    if (window.GOJ && window.GOJ.syncAfterScrub) window.GOJ.syncAfterScrub();
    clearTimeout(settle._t);
    settle._t = setTimeout(() => { if (!dragging) collapse(); }, 900);
  }

  function commitIndex(i, dir) {
    activeIndex = i;
    scrollPx = i * ROW_H;
    applyTransform(true);
    setActiveRow();
    const target = pages[i];
    if (target && target.id !== currentId) {
      currentId = target.id;
      if (window.GOJ && window.GOJ.navigateTo) window.GOJ.navigateTo(target.id, { direction: dir });
    }
  }

  function haptic() { if (navigator.vibrate) { try { navigator.vibrate(3); } catch {} } }

  function currentFlipDuration() { return TURN_SLOW_MS; }

  // -------- The page turn (a real leaf) --------
  function finishLeaf() {
    if (activeAnim) { try { activeAnim.finish(); } catch {} }
    if (activeLeaf && activeLeaf.parentNode) activeLeaf.remove();
    activeLeaf = null; activeAnim = null;
  }

  function makeLeaf(rich, dir) {
    const el = pageEl || document.getElementById("pageEl");
    const stage = stageEl || document.getElementById("pageStage");
    if (!el || !stage) return null;
    const rect = el.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();

    let leaf;
    if (rich) {
      leaf = el.cloneNode(true);
      leaf.removeAttribute("id");
      leaf.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      leaf.querySelectorAll("input,[contenteditable]").forEach((n) => {
        n.setAttribute("readonly", "");
        n.removeAttribute("contenteditable");
      });
    } else {
      leaf = document.createElement("div");
      leaf.className = "page";
    }
    leaf.classList.add("flip-leaf");
    leaf.classList.add(dir === "left" ? "spine-left" : "spine-right");
    Object.assign(leaf.style, {
      position: "absolute",
      left: (rect.left - stageRect.left) + "px",
      top: (rect.top - stageRect.top) + "px",
      width: rect.width + "px",
      height: rect.height + "px",
      margin: "0",
      zIndex: "30",
      pointerEvents: "none",
      backfaceVisibility: "hidden",
      transformOrigin: dir === "left" ? "left center" : "right center",
    });
    stage.appendChild(leaf);
    return leaf;
  }

  // Turn to a page during scrubbing (internal): clone current, swap content, flip leaf away.
  function turnTo(newId, dir) {
    finishLeaf();
    const rich = Math.abs(velocity) < SLOW_VEL;
    const leaf = makeLeaf(rich, dir);
    // reveal the new page underneath immediately
    if (window.GOJ && window.GOJ.showPageInstant) window.GOJ.showPageInstant(newId);
    currentId = newId;
    if (!leaf) return;
    const dur = rich ? TURN_SLOW_MS : Math.max(TURN_FAST_MS, TURN_SLOW_MS - Math.abs(velocity) * 90);
    const to = dir === "left" ? -180 : 180;
    activeLeaf = leaf;
    activeAnim = leaf.animate(
      [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${to}deg)` }],
      { duration: dur, easing: "cubic-bezier(.4,.06,.34,1)", fill: "forwards" }
    );
    activeAnim.onfinish = () => { if (leaf.parentNode) leaf.remove(); if (activeLeaf === leaf) { activeLeaf = null; activeAnim = null; } };
    activeAnim.oncancel = activeAnim.onfinish;
  }

  // Public: one deliberate page turn with a content swap in the middle (used for taps/keys)
  function leafTurn(dir = "left", swapFn) {
    return new Promise((resolve) => {
      finishLeaf();
      const leaf = makeLeaf(true, dir);
      if (typeof swapFn === "function") swapFn();   // underlying page becomes the new one
      if (!leaf) { resolve(); return; }
      const to = dir === "left" ? -180 : 180;
      activeLeaf = leaf;
      activeAnim = leaf.animate(
        [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${to}deg)` }],
        { duration: TURN_SLOW_MS, easing: "cubic-bezier(.4,.06,.34,1)", fill: "forwards" }
      );
      const done = () => { if (leaf.parentNode) leaf.remove(); if (activeLeaf === leaf) { activeLeaf = null; activeAnim = null; } resolve(); };
      activeAnim.onfinish = done;
      activeAnim.oncancel = done;
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.GOJ_FLIP = { render, leafTurn, currentFlipDuration };
})();
