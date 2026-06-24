/* ============================================================
   flip.js — Phase 2: page-flip animation + freewheel velocity
   ============================================================
   Behavior:
   - flip({ direction, durationMs }): briefly shows a 3D rotating
     snapshot of the previous page peeling away to reveal the new one.
   - Page-strip horizontal scroll velocity drives:
       · journal stage zoom-out (1.0 → 0.85)
       · flip duration (600ms → 150ms)
   - Velocity decays when scrolling stops; stage snaps back to 1.0.
   ============================================================ */

(() => {
  "use strict";

  // -------- Velocity tracking on the page strip --------
  const VEL_ALPHA = 0.32;
  const VEL_DECAY = 0.82;
  const VEL_TO_SCALE = 0.085;   // px/ms · factor → scale reduction
  const VEL_TO_FLIP  = 280;     // px/ms · factor → ms reduction
  const FLIP_MIN_MS  = 150;
  const FLIP_BASE_MS = 600;
  const SCALE_MIN    = 0.85;

  let smoothedVel = 0;
  let lastScrollLeft = 0;
  let lastScrollTime = 0;
  let pagestripEl = null;
  let stageEl = null;
  let decayRaf = null;

  function init() {
    pagestripEl = document.getElementById("pagestrip");
    stageEl     = document.getElementById("pageStage");
    if (!pagestripEl || !stageEl) return;

    pagestripEl.addEventListener("scroll", onScroll, { passive: true });
    pagestripEl.addEventListener("pointerup", scheduleDecay);
    pagestripEl.addEventListener("touchend", scheduleDecay);
    pagestripEl.addEventListener("mouseleave", scheduleDecay);
  }

  function onScroll() {
    const now = performance.now();
    const dt = now - lastScrollTime;
    if (dt < 1) return;
    const dx = pagestripEl.scrollLeft - lastScrollLeft;
    const v = Math.abs(dx) / dt;
    smoothedVel = smoothedVel * (1 - VEL_ALPHA) + v * VEL_ALPHA;
    lastScrollLeft = pagestripEl.scrollLeft;
    lastScrollTime = now;
    applyVelocityEffects();
    scheduleDecay();
  }

  function applyVelocityEffects() {
    if (!stageEl) return;
    const scale = Math.max(SCALE_MIN, 1 - smoothedVel * VEL_TO_SCALE);
    stageEl.style.setProperty("--page-scale", scale.toFixed(3));
  }

  function scheduleDecay() {
    if (decayRaf) return;
    const step = () => {
      smoothedVel *= VEL_DECAY;
      if (smoothedVel < 0.02) {
        smoothedVel = 0;
        applyVelocityEffects();
        decayRaf = null;
        return;
      }
      applyVelocityEffects();
      decayRaf = requestAnimationFrame(step);
    };
    decayRaf = requestAnimationFrame(step);
  }

  function currentFlipDuration() {
    return Math.max(FLIP_MIN_MS, FLIP_BASE_MS - smoothedVel * VEL_TO_FLIP);
  }

  // -------- The flip itself --------
  // Strategy: snapshot the current rendered page, place it absolutely
  // on top of the stage, then animate it rotating away while the new
  // page is rendered underneath. This avoids editing-inside-a-flipping-page.

  async function flip({ direction = "forward", durationMs = FLIP_BASE_MS } = {}) {
    const stage = stageEl || document.getElementById("pageStage");
    const pageEl = document.getElementById("pageEl");
    if (!stage || !pageEl) return;

    const rect = pageEl.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();

    // Clone the page DOM as a static snapshot
    const snap = pageEl.cloneNode(true);
    snap.classList.add("page-snapshot");
    snap.removeAttribute("id");
    // Make any inputs in the snapshot inert
    snap.querySelectorAll("input,[contenteditable]").forEach((n) => {
      n.setAttribute("readonly", "");
      n.removeAttribute("contenteditable");
    });
    snap.style.position = "absolute";
    snap.style.left = (rect.left - stageRect.left) + "px";
    snap.style.top  = (rect.top - stageRect.top) + "px";
    snap.style.width = rect.width + "px";
    snap.style.height = rect.height + "px";
    snap.style.margin = "0";
    snap.style.pointerEvents = "none";
    snap.style.willChange = "transform";
    snap.style.transformOrigin = direction === "forward" ? "left center" : "right center";
    snap.style.backfaceVisibility = "hidden";
    snap.style.zIndex = "5";
    // Add a subtle shadow on the leading edge so the flip reads as 3D
    snap.style.boxShadow = direction === "forward"
      ? "10px 0 28px -10px rgba(0,0,0,0.35)"
      : "-10px 0 28px -10px rgba(0,0,0,0.35)";

    stage.appendChild(snap);

    const targetRot = direction === "forward" ? -178 : 178; // not -180 so the back doesn't pop

    // animate
    const anim = snap.animate(
      [
        { transform: "rotateY(0deg)" },
        { transform: `rotateY(${targetRot}deg)` },
      ],
      { duration: durationMs, easing: "cubic-bezier(.55,.05,.45,.95)", fill: "forwards" }
    );

    try { await anim.finished; } catch {}
    snap.remove();
  }

  function takeSnapshot() {
    // Public helper if app.js wants to do its own ordering
    return null;
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.GOJ_FLIP = { flip, currentFlipDuration, takeSnapshot };
})();
