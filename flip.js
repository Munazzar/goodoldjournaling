/* ============================================================
   flip.js — navigation: floating title scrubber + page flips
   ============================================================
   The scrubber has no box. At rest it shows ONLY the current
   title. Press/hold-drag (or focus + wheel) reveals the
   neighbouring titles and scrolls with momentum. While you
   scroll, the page LEANS in the scroll direction; when you land
   on a title, the page does a single smooth two-phase flip
   (rotate out → swap content edge-on → rotate in).

       scroll up   → flip LEFT
       scroll down → flip RIGHT

   Exposes:
     GOJ_FLIP.render(orderedPages, currentId)
     GOJ_FLIP.flipOut(direction)   → Promise (rotate page to edge-on)
     GOJ_FLIP.flipIn(direction)    → Promise (rotate new page back in)
     GOJ_FLIP.currentFlipDuration()
   ============================================================ */

(() => {
  "use strict";

  const ROW_H = 40;             // px per title row
  const MOMENTUM_DECAY = 0.93;
  const MOMENTUM_MIN = 0.02;
  const VEL_ALPHA = 0.4;
  const LEAN_K = 7;            // velocity → lean degrees
  const LEAN_MAX = 16;
  const FLIP_OUT_MS = 130;
  const FLIP_IN_MS = 170;

  let scrubber, viewport, listEl, hintEl, stageEl, pageEl;
  let pages = [];
  let currentId = null;

  let scrollPx = 0;
  let activeIndex = 0;
  let dragging = false;
  let lastY = 0, lastT = 0;
  let velocity = 0;
  let momentumRaf = null;
  let lastDir = "right";
  let leanIdleRaf = null;

  function init() {
    scrubber = document.getElementById("scrubber");
    viewport = document.getElementById("scrubberViewport");
    listEl   = document.getElementById("scrubberList");
    hintEl   = document.getElementById("scrubberHint");
    stageEl  = document.getElementById("pageStage");
    pageEl   = document.getElementById("pageEl");
    if (!scrubber) return;

    scrubber.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    scrubber.addEventListener("wheel", onWheel, { passive: false });

    // Focus reveals neighbours (keyboard / tap-focus)
    scrubber.setAttribute("tabindex", "0");
    scrubber.addEventListener("focus", () => expand());
    scrubber.addEventListener("blur", () => { if (!dragging) collapse(); });
  }

  // -------- Rendering --------
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
  function collapse() { scrubber.dataset.state = "collapsed"; setLean(0, true); }

  // -------- Lean (continuous feedback while scrolling) --------
  function setLean(deg, ease) {
    if (!stageEl) return;
    stageEl.style.transition = ease ? "transform 0.32s cubic-bezier(.22,.61,.36,1)" : "transform 0s";
    stageEl.style.transform = `rotateY(${deg}deg)`;
  }

  function leanFromVelocity() {
    let deg = velocity * LEAN_K;
    if (deg > LEAN_MAX) deg = LEAN_MAX;
    if (deg < -LEAN_MAX) deg = -LEAN_MAX;
    setLean(deg, false);
  }

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

    const ni = Math.round(scrollPx / ROW_H);
    if (ni !== activeIndex) {
      lastDir = ni > activeIndex ? "left" : "right";
      activeIndex = ni;
      setActiveRow();
      haptic();
    }
    leanFromVelocity();
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
    scrollPx += e.deltaY;
    clampScroll();
    applyTransform(false);
    const ni = Math.round(scrollPx / ROW_H);
    if (ni !== activeIndex) {
      lastDir = ni > activeIndex ? "left" : "right";
      activeIndex = ni;
      setActiveRow();
    }
    // small lean based on wheel delta
    velocity = Math.max(-3, Math.min(3, -e.deltaY / 16));
    leanFromVelocity();
    clearTimeout(onWheel._t);
    onWheel._t = setTimeout(settle, 200);
  }

  function clampScroll() {
    const max = (pages.length - 1) * ROW_H;
    if (scrollPx < 0) scrollPx = 0;
    if (scrollPx > max) scrollPx = max;
  }

  function startMomentum() {
    let v = -velocity; // list moves opposite the finger
    const step = () => {
      v *= MOMENTUM_DECAY;
      if (Math.abs(v) < MOMENTUM_MIN) { momentumRaf = null; settle(); return; }
      scrollPx += v * 16;
      clampScroll();
      applyTransform(false);
      const ni = Math.round(scrollPx / ROW_H);
      if (ni !== activeIndex) {
        lastDir = ni > activeIndex ? "left" : "right";
        activeIndex = ni;
        setActiveRow();
      }
      // lean follows momentum velocity (px/frame → px/ms)
      velocity = v;
      leanFromVelocity();
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
    const target = pages[activeIndex];
    if (target && target.id !== currentId) {
      currentId = target.id;
      if (window.GOJ && window.GOJ.navigateTo) {
        window.GOJ.navigateTo(target.id, { direction: lastDir });
      }
    } else {
      setLean(0, true); // ease the lean back if we didn't move
    }
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
      if (window.GOJ && window.GOJ.navigateTo) {
        window.GOJ.navigateTo(target.id, { direction: dir });
      }
    }
  }

  function haptic() { if (navigator.vibrate) { try { navigator.vibrate(3); } catch {} } }

  function currentFlipDuration() { return FLIP_OUT_MS + FLIP_IN_MS; }

  // -------- Two-phase flip (smooth, no DOM cloning) --------
  function flipOut(direction = "right") {
    const el = pageEl || document.getElementById("pageEl");
    if (!el) return Promise.resolve();
    el.style.transformOrigin = "center center";
    const to = direction === "left" ? -90 : 90;
    const anim = el.animate(
      [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${to}deg)` }],
      { duration: FLIP_OUT_MS, easing: "cubic-bezier(.4,0,1,.5)", fill: "forwards" }
    );
    return anim.finished.catch(() => {});
  }

  function flipIn(direction = "right") {
    const el = pageEl || document.getElementById("pageEl");
    if (!el) { setLean(0, true); return Promise.resolve(); }
    const from = direction === "left" ? 90 : -90;
    // reset lean instantly so the in-flip starts clean
    if (stageEl) { stageEl.style.transition = "transform 0s"; stageEl.style.transform = "rotateY(0deg)"; }
    const anim = el.animate(
      [{ transform: `rotateY(${from}deg)` }, { transform: "rotateY(0deg)" }],
      { duration: FLIP_IN_MS, easing: "cubic-bezier(0,.5,.4,1)", fill: "forwards" }
    );
    return anim.finished.then(() => {
      el.style.transform = "";   // hand control back to layout
    }).catch(() => { el.style.transform = ""; });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.GOJ_FLIP = { render, flipOut, flipIn, currentFlipDuration };
})();
