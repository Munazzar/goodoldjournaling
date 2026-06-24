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

  // perfect-freehand has no UMD build, so we import the ESM module directly.
  // If this fails for any reason, drawing still works via a stroked-polyline fallback.
  const PERFECT_FREEHAND_URL = "https://esm.sh/perfect-freehand@1.2.2";

  let pfGetStroke = null;   // set to the real getStroke when the module loads
  let pfLoaded = false;
  function hasPF() { return typeof pfGetStroke === "function"; }

  async function loadPerfectFreehand() {
    if (pfLoaded) return;
    pfLoaded = true; // only attempt once
    try {
      const mod = await import(PERFECT_FREEHAND_URL);
      if (mod && typeof mod.getStroke === "function") pfGetStroke = mod.getStroke;
      else if (mod && mod.default && typeof mod.default.getStroke === "function") pfGetStroke = mod.default.getStroke;
    } catch (e) {
      console.warn("perfect-freehand unavailable, using polyline strokes:", e);
      pfGetStroke = null; // fallback path handles everything
    }
  }

  function getStroke(points, options) {
    if (hasPF()) return pfGetStroke(points, options);
    return points; // fallback: raw centerline (rendered as a stroked polyline)
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
      const color = s.color || "#1B1816";
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      if (hasPF()) {
        const outline = pfGetStroke(s.points, strokeOptions(s.size, false));
        path.setAttribute("d", getSvgPathFromStroke(outline));
        path.setAttribute("fill", color);
      } else {
        // Stroked polyline fallback — always renders as a line
        const pts = s.points;
        if (!pts.length) return;
        let d = `M ${pts[0][0]} ${pts[0][1]}`;
        for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", color);
        path.setAttribute("stroke-width", String(s.size || 6));
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
      }
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
        const color = s.color || "#1B1816";
        if (hasPF()) {
          // perfect-freehand: outline polygon, filled
          const outline = pfGetStroke(s.points, strokeOptions(s.size, false));
          if (!outline.length) return;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(outline[0][0], outline[0][1]);
          for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
          ctx.closePath();
          ctx.fill();
        } else {
          // Fallback: a real stroked line (round caps/joins), pressure-scaled width
          const pts = s.points;
          if (pts.length < 1) return;
          ctx.strokeStyle = color;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          if (pts.length === 1) {
            // a dot
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(pts[0][0], pts[0][1], Math.max(1, s.size / 2), 0, Math.PI * 2);
            ctx.fill();
            return;
          }
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) {
            const pr = pts[i][2] || 0.5;
            ctx.lineWidth = Math.max(1, s.size * (0.5 + pr));
            ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(pts[i][0], pts[i][1]);
          }
        }
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
