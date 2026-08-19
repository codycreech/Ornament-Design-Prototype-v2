// gridSketch.js — paintable grid (reflects to sphere via mapping)
// Perf notes:
//  - hitTest() used to linearly scan up to ~2650 paintable rects on every
//    mousemove/draw call. It now uses a spatial hash bucketed by tile
//    position, so a hit test only checks a handful of nearby candidates.
//  - The frame rate is capped (grid UI doesn't need 60fps) which cuts
//    idle CPU/battery use substantially, especially on mobile.
//  - Brush size: painting now covers a configurable radius of cells
//    (Shared.brushSize) instead of always a single cell, and fast
//    drags/swipes are interpolated so no cells are skipped between samples.

new p5((p) => {
  const S = window.Shared;
  const H = window.SharedHelpers;  let grid = [];
  const margin = 30;
  const letters = ["A","B","C","D","E","F"];

  const TILE_W = 10;
  const TILE_H = 10;
  const SPACING = 10;
  const BUCKET = 10; // spatial hash cell size, matches tile spacing

  const OUTER = "outer";
  const INNER = "inner";

  const PAD_RIGHT = 20;
  const PAD_BOTTOM = 20;

  let paintables = [];
  let hoverIdx = -1;

  let isPainting = false;
  let lastPaintX = null;
  let lastPaintY = null;
  let lastEraseFlag = false;

  // bucketKey -> array of paintable indices
  let spatialHash = new Map();

  // Cached static overlay (grid lines) + labels, blitted instead of
  // redrawn with hundreds of line()/text() calls every frame.
  let staticOverlay = null;

  // These counts are the original capacity of the sphere lattice.
  const ANCHOR_N = S.GRID_COUNT * S.NUM_LATITUDE; // 256
  const SUBCELL_N = (S.NUM_LATITUDE - 1) * S.GRID_COUNT * (2 * S.SUBCELLS_PER_LEG); // 2400
  const SUBCELL_BASE = ANCHOR_N;

  let canvasEl = null;

  p.setup = () => {
    const c = p.createCanvas(200, 200);
    c.parent("gridMount");
    canvasEl = c.elt;

    const mount = p.select("#gridMount");
    p.pixelDensity(1);
    p.textFont("monospace");
    p.textSize(12);

    // Grid UI is mostly static — 60fps is wasted CPU/battery, especially
    // on mobile. This is still plenty responsive for painting.
    p.frameRate(30);

    loadGrid();
    autoResizeToFit();
    buildPaintables_RowAligned();
    buildSpatialHash();
    buildStaticOverlay();

    c.elt.addEventListener("contextmenu", (e) => e.preventDefault());
    c.elt.style.touchAction = "none";
  };

  p.draw = () => {
    p.clear();

    hoverIdx = hitTest(p.mouseX, p.mouseY);
    if (hoverIdx >= 0) {
      const hv = paintables[hoverIdx];
      const nodeId = S.cellIdToSphereNode[String(hv.id)];
      S.hoverGrid = { cellId: hv.id, nodeId };
    } else {
      S.hoverGrid = null;
    }

    if (canvasEl) canvasEl.style.cursor = S.eyedropperActive ? "crosshair" : "";

    drawGrid();
    if (S.eyedropperActive) {
      drawEyedropperHoverPreview();
    } else {
      drawBrushHoverPreview();
    }
    if (staticOverlay) p.image(staticOverlay, 0, 0);
  };

  p.mousePressed = () => {
    if (!inCanvasBounds(p.mouseX, p.mouseY)) return;
    // The eyedropper works even while painting is toggled off — it only
    // reads a color, it doesn't touch the artwork.
    if (trySampleEyedropper(p.mouseX, p.mouseY)) return;
    if (!S.paintEnabled) return;
    // Activate as soon as the click lands inside the canvas — it no longer
    // has to land exactly on a cell. That way a radius brush hovering the
    // gap between cells still picks up everything inside its circle.
    H.pushUndoSnapshot();
    isPainting = true;
    const isErase = (p.mouseButton === p.RIGHT);
    lastPaintX = p.mouseX;
    lastPaintY = p.mouseY;
    lastEraseFlag = isErase;
    paintBrushAt(p.mouseX, p.mouseY, isErase);
  };

  p.mouseDragged = () => {
    if (!S.paintEnabled) return;
    if (!isPainting) return;
    const isErase = (p.mouseButton === p.RIGHT);
    paintStrokeTo(p.mouseX, p.mouseY, isErase);
  };

  p.mouseReleased = () => {
    isPainting = false;
    lastPaintX = null;
    lastPaintY = null;
  };


  // Touch support (mobile)
  p.touchStarted = () => {
    // Only paint if touch is inside this canvas — but (as with mouse) it no
    // longer needs to land exactly on a cell for a radius brush to activate.
    if (!inCanvasBounds(p.mouseX, p.mouseY)) return true;
    // The eyedropper works even while painting is toggled off — it only
    // reads a color, it doesn't touch the artwork.
    if (trySampleEyedropper(p.mouseX, p.mouseY)) return false;
    if (!S.paintEnabled) return true;
    H.pushUndoSnapshot();
    isPainting = true;
    lastPaintX = p.mouseX;
    lastPaintY = p.mouseY;
    lastEraseFlag = !!S.touchErase;
    paintBrushAt(p.mouseX, p.mouseY, !!S.touchErase);
    return false; // prevent page scroll while painting
  };

  p.touchMoved = () => {
    if (!S.paintEnabled) return true;
    if (!isPainting) return true;
    paintStrokeTo(p.mouseX, p.mouseY, !!S.touchErase);
    return false;
  };

  p.touchEnded = () => {
    isPainting = false;
    lastPaintX = null;
    lastPaintY = null;
    return false;
  };


  function inCanvasBounds(mx, my) {
    return mx >= 0 && my >= 0 && mx <= p.width && my <= p.height;
  }

  // Radius (in px) the current brush size covers around its center point.
  function brushRadiusPx(size) {
    return (size - 1) * BUCKET + (TILE_W / 2);
  }

  // Every paintable index whose center lies within radiusPx of (cx, cy),
  // found via the spatial hash so only nearby buckets are checked instead
  // of scanning every cell.
  function collectWithinRadius(cx, cy, radiusPx) {
    const out = [];
    const bucketRadius = Math.ceil(radiusPx / BUCKET);
    const bx = Math.floor(cx / BUCKET);
    const by = Math.floor(cy / BUCKET);

    for (let ix = bx - bucketRadius; ix <= bx + bucketRadius; ix++) {
      for (let iy = by - bucketRadius; iy <= by + bucketRadius; iy++) {
        const bucket = spatialHash.get(ix + "," + iy);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const idx = bucket[k];
          const v = paintables[idx];
          const vx = v.x + v.w / 2;
          const vy = v.y + v.h / 2;
          const d = Math.sqrt((vx - cx) * (vx - cx) + (vy - cy) * (vy - cy));
          if (d <= radiusPx) out.push(idx);
        }
      }
    }
    return out;
  }

  // Paints a brush stamp centered on the given canvas coords. The brush is
  // anchored to the actual cursor position (not snapped to whatever cell
  // happens to be under it), so every cell inside the radius gets painted
  // even when the cursor itself is hovering a gap between cells.
  function paintBrushAt(mx, my, isErase) {
    paintBrushAroundPoint(mx, my, isErase);
  }

  // Interpolates from the last painted point to the new point so fast
  // drags/swipes don't skip cells between animation frames, then stamps
  // the brush along that path.
  function paintStrokeTo(mx, my, isErase) {
    if (lastPaintX === null || lastPaintY === null) {
      paintBrushAt(mx, my, isErase);
      lastPaintX = mx; lastPaintY = my; lastEraseFlag = isErase;
      return;
    }
    const dx = mx - lastPaintX;
    const dy = my - lastPaintY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const step = 5; // px between samples along the stroke
    const steps = Math.min(40, Math.max(1, Math.ceil(dist / step)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = lastPaintX + dx * t;
      const sy = lastPaintY + dy * t;
      paintBrushAroundPoint(sx, sy, isErase);
    }
    lastPaintX = mx;
    lastPaintY = my;
    lastEraseFlag = isErase;
  }

  // Paints every paintable cell whose center lies within the brush radius
  // (Shared.brushSize) of (cx, cy) — the raw cursor/stroke-sample position,
  // not a cell center.
  function paintBrushAroundPoint(cx, cy, isErase) {
    const size = Math.max(1, Math.min(6, Math.round(S.brushSize || 1)));
    if (size <= 1) {
      const idx = hitTest(cx, cy);
      paintIndex(idx, isErase);
      return;
    }
    const radiusPx = brushRadiusPx(size);
    const hits = collectWithinRadius(cx, cy, radiusPx);
    for (let i = 0; i < hits.length; i++) paintIndex(hits[i], isErase);
  }

  function paintIndex(idx, isErase) {
    if (idx < 0) return;
    const v = paintables[idx];
    if (!v) return;
    const cellId = String(v.id);
    if (S.cellIdToSphereNode[cellId] === undefined) return;
    H.setPaintByCellId(cellId, isErase ? null : S.selectedColor);
  }

  // Reads the current on-screen color of the cell under (mx, my) — its
  // paint if any, otherwise its default fill — the same value paintIndex()
  // would overwrite, not a lit/rendered pixel readback.
  function sampleColorAt(mx, my) {
    const idx = hitTest(mx, my);
    if (idx < 0) return null;
    const v = paintables[idx];
    if (!v) return null;
    return S.cellPaint[String(v.id)] || defaultFill(v.kind);
  }

  // If the eyedropper tool is armed, consumes this click/tap: samples the
  // color under the cursor into the brush instead of painting, then
  // disarms itself (one shot per activation). Returns true when it handled
  // the event (caller should not also start a paint stroke).
  function trySampleEyedropper(mx, my) {
    if (!S.eyedropperActive) return false;
    const c = sampleColorAt(mx, my);
    if (c) S.selectedColor = c;
    S.eyedropperActive = false;
    return true;
  }

  function insertAt1Based(arr, pos1, value) {
    const idx = Math.max(0, Math.min(arr.length, pos1 - 1));
    arr.splice(idx, 0, value);
  }

  function loadGrid() {
    let x = 0;
    let y = 0;

    for (let gridCol = 1; gridCol <= 12; gridCol++) {
      grid[gridCol] = [];
      for (let gridRow = 1; gridRow <= 16; gridRow++) {
        const pat = loadPattern(x + margin, y + margin, gridCol, gridRow);
        grid[gridCol][gridRow] = { pattern: pat, gridCol, gridRow };
        x = x + 40;
      }
      x = 0;
      y = y + 60;
    }
  }

  function loadPattern(g_x, g_y, g_c, g_r) {
    const pattern = [];
    const x_count = g_x;
    const y_count = g_y;

    for (let col = 1; col <= 4; col++) {
      for (let row = 1; row <= 6; row++) {
        let kind = "white";
        let loc = INNER;

        if (col === 1 || col === 3) {
          kind = "red";
          loc = OUTER;
        } else if (row === 2 || row === 4 || row === 6) {
          kind = "green";
          loc = INNER;
        } else if (row === 3 || row === 5) {
          kind = "yellow";
          loc = INNER;
        }

        const obj = {
          x: (col * SPACING) + x_count,
          y: (row * SPACING) + y_count,
          w: TILE_W,
          h: TILE_H,
          kind,
          loc,
          id: `g${g_c}-${g_r}-c${col}-r${row}-${loc}-${kind}`
        };

        // Preserve your original pattern insertion order
        if (g_c < 12) {
          if (g_c % 2 === 0) {
            if (col === 3 && row === 1) insertAt1Based(pattern, row, obj);
            if (col === 2 && row > 1) insertAt1Based(pattern, row, obj);
            if (col === 4 && row > 1) insertAt1Based(pattern, row, obj);
          } else {
            if (col === 1 && row === 1) insertAt1Based(pattern, row, obj);
            if (col === 2 && row > 1) insertAt1Based(pattern, row, obj);
            if (col === 4 && row > 1) insertAt1Based(pattern, row, obj);
          }
        } else if (g_c === 12 && row === 1 && col === 3) {
          insertAt1Based(pattern, row, obj);
        }
      }
    }
    return pattern;
  }

  function buildPaintables_RowAligned() {
    paintables = [];
    const reds = [];
    const subs = [];

    for (let gc = 1; gc < grid.length; gc++) {
      const col = grid[gc];
      if (!col) continue;
      for (let gr = 1; gr < col.length; gr++) {
        const cell = col[gr];
        if (!cell) continue;
        const pat = cell.pattern;
        for (let i = 0; i < pat.length; i++) {
          const v = pat[i];
          if (!v) continue;
          if (v.kind === "red") reds.push(v);
          else if (v.kind === "green" || v.kind === "yellow") subs.push(v);
        }
      }
    }

    // Sort top->bottom then left->right, so rows align with latitude rows.
    const byYX = (a, b) => (a.y - b.y) || (a.x - b.x) || (a.id < b.id ? -1 : 1);
    reds.sort(byYX);
    subs.sort(byYX);

    for (let i = 0; i < reds.length; i++) {
      const v = reds[i];
      v._provisionalNodeId = (i < ANCHOR_N) ? i : null;
      paintables.push(v);
    }
    for (let i = 0; i < subs.length; i++) {
      const v = subs[i];
      v._provisionalNodeId = (i < SUBCELL_N) ? (SUBCELL_BASE + i) : null;
      paintables.push(v);
    }
  }

  // Buckets paintables by tile position so hit-testing and brush painting
  // only need to check a handful of nearby candidates instead of scanning
  // the full ~2650-entry list every time.
  function buildSpatialHash() {
    spatialHash = new Map();
    for (let i = 0; i < paintables.length; i++) {
      const v = paintables[i];
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      const bx = Math.floor(cx / BUCKET);
      const by = Math.floor(cy / BUCKET);
      const key = bx + "," + by;
      let arr = spatialHash.get(key);
      if (!arr) { arr = []; spatialHash.set(key, arr); }
      arr.push(i);
    }
  }

  function hitTest(mx, my) {
    const bx = Math.floor(mx / BUCKET);
    const by = Math.floor(my / BUCKET);
    // Check the containing bucket plus immediate neighbors (cells can
    // straddle a bucket boundary near their edges).
    for (let ix = bx - 1; ix <= bx + 1; ix++) {
      for (let iy = by - 1; iy <= by + 1; iy++) {
        const bucket = spatialHash.get(ix + "," + iy);
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const idx = bucket[k];
          const v = paintables[idx];
          if (mx >= v.x && mx <= v.x + v.w && my >= v.y && my <= v.y + v.h) return idx;
        }
      }
    }
    return -1;
  }

  function defaultFill(kind) {
    if (kind === "red") return "#ffffff";
    if (kind === "green") return "#e6e6e6";
    if (kind === "yellow") return "#ffffff";
    return "#ffffff";
  }

  function paintFillFor(v) {
    const c = S.cellPaint[String(v.id)];
    if (c) return c;
    return defaultFill(v.kind);

    //const isEven = (v.i + v.j) % 2 === 0;
    //return isEven ? "#ffffff" : "#e6e6e6";
  }

  function drawPattern(patternArr) {
    for (let i = 0; i < patternArr.length; i++) {
      const v = patternArr[i];
      if (!v) continue;

      p.stroke(255);
      p.strokeWeight(1);
      p.noFill();
      p.rect(v.x, v.y, v.w, v.h);

      p.noStroke();
      p.fill(paintFillFor(v));
      p.rect(v.x + 1, v.y + 1, v.w - 2, v.h - 2);
    }
  }

  function drawGrid() {
    p.noStroke();
    p.strokeWeight(1);

    for (let i = 1; i < grid.length; i++) {
      const col = grid[i];
      if (!col) continue;
      for (let j = 1; j < col.length; j++) {
        const cell = col[j];
        if (!cell) continue;
        drawPattern(cell.pattern);
      }
    }
  }

  // Renders the row/column labels + faint grid-line overlay ONE TIME into
  // an offscreen buffer. These never change, so every draw() call just
  // blits the buffer (1 image draw) instead of redoing dozens of text()
  // calls and hundreds of line() calls every frame.
  function buildStaticOverlay() {
    staticOverlay = p.createGraphics(p.width, p.height);
    const g = staticOverlay;

    let tempX = 40;
    let tempY = 38;

    g.fill(0);
    g.noStroke();
    g.textFont("monospace");
    g.textSize(12);
    g.textAlign(g.LEFT, g.TOP);

    for (let x = 1; x <= 16; x++) {
      g.text(String(x), x * 41, 0);
      for (let i = 1; i <= 4; i++) {
        g.text(letters[i - 1], tempX, 20);
        tempX = tempX + 10;
      }
    }

    for (let y = 1; y <= 11; y++) {
      g.text(String(y), 0, y * 61);
      for (let i = 1; i <= 6; i++) {
        g.text(letters[i - 1], 22, tempY);
        tempY = tempY + 10;
      }
    }
    g.text(letters[0], 22, tempY);

    g.push();
    g.noFill();
    g.stroke(0, 120);
    g.strokeWeight(1);

    for (let x = 0; x <= g.width; x += 10) {
      g.line(x, 0, x, g.height);
    }
    for (let y = 0; y <= g.height; y += 10) {
      g.line(0, y, g.width, y);
    }
    g.pop();
  }

  // Shows exactly what a click/tap would do right now: the brush-radius
  // circle around the actual cursor position, every cell inside that
  // radius outlined (so it's clear the whole radius is "live", not just
  // whichever cell the cursor happens to sit on), and a filled highlight
  // on the cell directly under the cursor, if any.
  function drawBrushHoverPreview() {
    if (!S.paintEnabled) return;
    const mx = p.mouseX, my = p.mouseY;
    if (!inCanvasBounds(mx, my)) return;

    const size = Math.max(1, Math.min(6, Math.round(S.brushSize || 1)));

    if (size > 1) {
      const radiusPx = brushRadiusPx(size);
      p.noFill();
      p.stroke(255, 160);
      p.strokeWeight(1);
      p.circle(mx, my, radiusPx * 2);

      // Outline every cell that's actually inside the radius, so it's
      // visually obvious the whole area is selected, not just the center.
      const hits = collectWithinRadius(mx, my, radiusPx);
      p.stroke(255, 210);
      p.strokeWeight(1);
      for (let i = 0; i < hits.length; i++) {
        const hv = paintables[hits[i]];
        p.rect(hv.x - 0.5, hv.y - 0.5, hv.w + 1, hv.h + 1);
      }
    }

    if (hoverIdx >= 0) {
      const v = paintables[hoverIdx];
      p.noFill();
      p.stroke(255);
      p.strokeWeight(2);
      p.rect(v.x - 1, v.y - 1, v.w + 2, v.h + 2);

      const mapped = S.cellIdToSphereNode[String(v.id)];
      if (mapped !== undefined) {
        p.noStroke();
        const c = p.color(S.selectedColor);
        c.setAlpha(120);
        p.fill(c);
        p.rect(v.x + 1, v.y + 1, v.w - 2, v.h - 2);
      }
    }
  }

  // While the eyedropper is armed, highlight only the exact cell that
  // would be sampled — a dashed-looking ring (no brush-radius circle, no
  // fill), so it reads clearly as "pick", not "paint".
  function drawEyedropperHoverPreview() {
    if (hoverIdx < 0) return;
    const v = paintables[hoverIdx];
    if (!v) return;
    p.noFill();
    p.stroke(0, 200, 255);
    p.strokeWeight(2);
    p.rect(v.x - 2, v.y - 2, v.w + 4, v.h + 4);
  }

  function autoResizeToFit() {
    let maxX = 16 * 41 + 20;
    let maxY = 11 * 61 + 20;

    for (let i = 1; i < grid.length; i++) {
      const col = grid[i];
      if (!col) continue;
      for (let j = 1; j < col.length; j++) {
        const cell = col[j];
        if (!cell) continue;
        const pat = cell.pattern;
        for (let k = 0; k < pat.length; k++) {
          const v = pat[k];
          if (!v) continue;
          maxX = p.max(maxX, v.x + v.w);
          maxY = p.max(maxY, v.y + v.h);
        }
      }
    }

    maxX += PAD_RIGHT;
    maxY += PAD_BOTTOM;

    p.resizeCanvas(Math.ceil(maxX), Math.ceil(maxY));
  }
});
