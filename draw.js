/* ============================================================
   draw.js — Phase 3: drawing canvas with pressure strokes
   ============================================================
   - openCanvas() opens a full-screen drawing overlay and resolves
     with a Drawing object (or null if cancelled).
   - Strokes are stored as JSON points + style. Rendered as SVG.
   - Uses perfect-freehand (loaded from CDN as UMD) for smooth
     pressure-sensitive outlines.

   Drawing object shape:
   {
     id, width, height, createdAt,
     strokes: [ { id, points: [[x,y,pressure], ...], size, color, eraser } ]
   }
   ============================================================ */

(() => {
  "use strict";

  const PERFECT_FREEHAND_URL = "https://cdn.jsdelivr.net/npm/perfect-freehand@1.2.2/dist/index.umd.js";

  let pfLoaded = false;
  async function loadPerfectFreehand() {
    if (pfLoaded) return;
    if (window.PerfectFreehand && window.PerfectFreehand.getStroke) { pfLoaded = true; return; }
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PERFECT_FREEHAND_URL;
      s.async = true;
      s.onload = () => { pfLoaded = true; resolve(); };
      s.onerror = () => reject(new Error("Couldn't load perfect-freehand"));
      document.head.appendChild(s);
    });
  }

  function getStroke(points, options) {
    if (window.PerfectFreehand && window.PerfectFreehand.getStroke) {
      return window.PerfectFreehand.getStroke(points, options);
    }
    // Fallback: just return points if perfect-freehand isn't available
    return points.map(([x, y]) => [x, y]);
  }

  function getSvgPathFromStroke(stroke) {
    if (!stroke.length) return "";
    const d = stroke.reduce((acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    }, ["M", ...stroke[0], "Q"]);
    d.push("Z");
    return d.join(" ");
  }

  function strokeOptions(size, isEraser) {
    return {
      size,
      thinning: 0.55,
      smoothing: 0.55,
      streamline: 0.55,
      easing: (t) => t,
      simulatePressure: true,
      last: true,
    };
  }

  // -------- Render a saved drawing as SVG (called from renderDrawings) --------
  function renderSvg(drawing) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${drawing.width} ${drawing.height}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("class", "drawing-svg");
    (drawing.strokes || []).forEach((s) => {
      if (s.eraser) return; // eraser strokes don't render — they removed content live
      const points = s.points;
      const outline = getStroke(points, strokeOptions(s.size, false));
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", getSvgPathFromStroke(outline));
      path.setAttribute("fill", s.color || "#1B1816");
      svg.appendChild(path);
    });
    return svg;
  }

  // -------- The drawing overlay --------
  function openCanvas(existing) {
    return new Promise(async (resolve) => {
      try { await loadPerfectFreehand(); }
      catch (e) { console.warn(e); /* fallback strokes still work */ }

      const overlay = document.createElement("div");
      overlay.className = "draw-overlay";
      overlay.innerHTML = `
        <div class="draw-topbar">
          <div class="draw-title">Drawing</div>
          <div class="draw-actions">
            <button class="btn" id="drawCancel">Cancel</button>
            <button class="btn btn-vermillion" id="drawDone">Done</button>
          </div>
        </div>
        <div class="draw-stage">
          <canvas id="drawCanvas"></canvas>
        </div>
        <div class="draw-toolbar">
          <div class="draw-tool-group" role="radiogroup" aria-label="Tool">
            <button class="tool-btn active" data-tool="pen" aria-label="Pen">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/></svg>
            </button>
            <button class="tool-btn" data-tool="eraser" aria-label="Eraser">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 4l6 6-10 10H4l-1-1 11-11z"/></svg>
            </button>
          </div>
          <div class="draw-tool-group" role="radiogroup" aria-label="Size">
            <button class="size-btn"  data-size="3"></button>
            <button class="size-btn active" data-size="6"></button>
            <button class="size-btn"  data-size="12"></button>
            <button class="size-btn"  data-size="22"></button>
          </div>
          <div class="draw-tool-group" role="radiogroup" aria-label="Color">
            <button class="color-btn active" data-color="#1B1816" style="background:#1B1816"></button>
            <button class="color-btn" data-color="#B33A1A" style="background:#B33A1A"></button>
            <button class="color-btn" data-color="#1F4E79" style="background:#1F4E79"></button>
            <button class="color-btn" data-color="#3E6943" style="background:#3E6943"></button>
            <button class="color-btn" data-color="#7A5A1F" style="background:#7A5A1F"></button>
          </div>
          <div class="draw-tool-group">
            <button class="tool-btn" id="drawUndo" aria-label="Undo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 14l-4-4 4-4M5 10h10a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4H9"/></svg>
            </button>
            <button class="tool-btn" id="drawClear" aria-label="Clear">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const canvas = overlay.querySelector("#drawCanvas");
      const ctx = canvas.getContext("2d");
      const drawId = (window.GOJ && window.GOJ.cryptoId) ? window.GOJ.cryptoId() : Math.random().toString(36).slice(2);

      const strokes = existing && existing.strokes ? [...existing.strokes] : [];
      let currentStroke = null;
      let drawing = false;
      let tool = "pen";
      let size = 6;
      let color = "#1B1816";

      // Resize canvas to fit container with DPR
      function resize() {
        const stage = overlay.querySelector(".draw-stage");
        const rect = stage.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width  = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
        canvas.style.width = rect.width + "px";
        canvas.style.height = rect.height + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        redraw();
      }
      resize();
      window.addEventListener("resize", resize);

      function redraw() {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        // Paper background — keep light always (drawing surface)
        ctx.fillStyle = "#F4EFE5";
        ctx.fillRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
        strokes.forEach((s) => drawStrokeOnCanvas(s));
      }

      function drawStrokeOnCanvas(s) {
        if (s.eraser) return;
        const outline = getStroke(s.points, strokeOptions(s.size, false));
        ctx.fillStyle = s.color || "#1B1816";
        ctx.beginPath();
        outline.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
      }

      function pointerToLocal(e) {
        const rect = canvas.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top, e.pressure || 0.5];
      }

      function isPointNearStroke(pt, stroke, radius) {
        // Cheap hit-test: any point within radius?
        for (const p of stroke.points) {
          const dx = p[0] - pt[0], dy = p[1] - pt[1];
          if (dx * dx + dy * dy < radius * radius) return true;
        }
        return false;
      }

      function startStroke(e) {
        if (e.button !== undefined && e.button > 0) return; // only main button
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        const pt = pointerToLocal(e);

        if (tool === "eraser") {
          // Eraser removes strokes hit by the eraser path
          const radius = size * 2;
          const before = strokes.length;
          for (let i = strokes.length - 1; i >= 0; i--) {
            if (isPointNearStroke(pt, strokes[i], radius)) strokes.splice(i, 1);
          }
          if (strokes.length !== before) redraw();
          drawing = true;
          currentStroke = null;
          return;
        }

        currentStroke = {
          id: (window.GOJ && window.GOJ.cryptoId) ? window.GOJ.cryptoId() : Math.random().toString(36).slice(2),
          points: [pt],
          size, color, eraser: false,
        };
        drawing = true;
      }

      function continueStroke(e) {
        if (!drawing) return;
        e.preventDefault();
        const pt = pointerToLocal(e);

        if (tool === "eraser") {
          const radius = size * 2;
          const before = strokes.length;
          for (let i = strokes.length - 1; i >= 0; i--) {
            if (isPointNearStroke(pt, strokes[i], radius)) strokes.splice(i, 1);
          }
          if (strokes.length !== before) redraw();
          return;
        }

        if (currentStroke) {
          currentStroke.points.push(pt);
          // Draw the current stroke incrementally on top
          drawStrokeOnCanvas(currentStroke);
        }
      }

      function endStroke(e) {
        if (!drawing) return;
        drawing = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch {}
        if (currentStroke && currentStroke.points.length > 1) {
          strokes.push(currentStroke);
        }
        currentStroke = null;
        redraw();
      }

      canvas.addEventListener("pointerdown", startStroke);
      canvas.addEventListener("pointermove", continueStroke);
      canvas.addEventListener("pointerup",   endStroke);
      canvas.addEventListener("pointercancel", endStroke);
      canvas.addEventListener("pointerleave", endStroke);

      // Toolbar wiring
      overlay.querySelectorAll(".tool-btn[data-tool]").forEach((b) => {
        b.addEventListener("click", () => {
          tool = b.dataset.tool;
          overlay.querySelectorAll(".tool-btn[data-tool]").forEach((x) => x.classList.toggle("active", x === b));
        });
      });
      overlay.querySelectorAll(".size-btn").forEach((b) => {
        // Visual: dot size proportional to data-size
        const s = +b.dataset.size;
        b.style.setProperty("--dot", `${Math.min(22, Math.max(4, s * 0.9))}px`);
        b.addEventListener("click", () => {
          size = s;
          overlay.querySelectorAll(".size-btn").forEach((x) => x.classList.toggle("active", x === b));
        });
      });
      overlay.querySelectorAll(".color-btn").forEach((b) => {
        b.addEventListener("click", () => {
          color = b.dataset.color;
          overlay.querySelectorAll(".color-btn").forEach((x) => x.classList.toggle("active", x === b));
        });
      });

      overlay.querySelector("#drawUndo").addEventListener("click", () => {
        if (strokes.length) { strokes.pop(); redraw(); }
      });
      overlay.querySelector("#drawClear").addEventListener("click", () => {
        if (!strokes.length) return;
        if (confirm("Clear the drawing?")) { strokes.length = 0; redraw(); }
      });

      function close(result) {
        window.removeEventListener("resize", resize);
        overlay.remove();
        resolve(result);
      }

      overlay.querySelector("#drawCancel").addEventListener("click", () => close(null));
      overlay.querySelector("#drawDone").addEventListener("click", () => {
        if (!strokes.length) { close(null); return; }
        const rect = canvas.getBoundingClientRect();
        const drawing = {
          id: drawId,
          width: rect.width,
          height: rect.height,
          strokes,
          createdAt: new Date().toISOString(),
        };
        close(drawing);
      });

      // Keyboard
      const onKey = (e) => {
        if (e.key === "Escape") close(null);
        if ((e.metaKey || e.ctrlKey) && e.key === "z") {
          e.preventDefault();
          if (strokes.length) { strokes.pop(); redraw(); }
        }
      };
      document.addEventListener("keydown", onKey);
      const origClose = close;
      close = (r) => { document.removeEventListener("keydown", onKey); origClose(r); };
    });
  }

  window.GOJ_DRAW = { openCanvas, renderSvg };
})();
