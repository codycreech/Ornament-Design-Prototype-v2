// sphereSketch.js — sphere preview (NOT paintable). Shows painted nodes from grid.
// Perf notes:
//  - Node world positions never change (only camera rotation does), so they are
//    computed ONCE in setup() and cached, instead of recomputing sin/cos for
//    ~2650 nodes on every single draw() call (was the single biggest CPU cost).
//  - Sphere polygon detail + target frame rate scale down automatically on
//    phones/tablets (see Shared.getQualitySettings), since immediate-mode
//    p.sphere() calls are expensive per-draw-call on mobile GPUs.
//  - Hover/pick math is skipped on frames where the pointer hasn't moved.

new p5((p) => {
  const S = window.Shared;
  const H = window.SharedHelpers;

  const R = 180;

  let hoveredId = null;
  let hoveredPos = null;
  let hoveredRadius = 0;

  let mount = null;

  // Cached, precomputed once in setup() (or when quality settings change)
  let nodeCache = [];      // [{ id, x, y, z, defaultHex, isAnchor }]
  let quality = null;

  let lastMouseX = -1;
  let lastMouseY = -1;

  p.setup = () => {
    quality = H.getQualitySettings();

    const c = p.createCanvas(10, 10, p.WEBGL);
    mount = p.select("#sphereMount");

    resizeToMount();
    c.parent("sphereMount");
    p.pixelDensity(1);
    p.frameRate(quality.fps);

    function resizeToMount(){
      if (!mount) return;
      const el = mount && mount.elt ? mount.elt : null;
      let w = 650, h = 650;
      if (el){
        const r = el.getBoundingClientRect();
        w = Math.max(200, Math.floor(r.width || 0));
        h = Math.max(200, Math.floor(r.height || 0));
      }
      // If the mount has no height (e.g., auto), keep it square
      if (el){
        const r = el.getBoundingClientRect();
        if (!r.height || r.height < 50) h = w;
      }
      p.resizeCanvas(w, h);
    }

    if (mount) mount.style("position", "relative");

    c.elt.addEventListener("contextmenu", (e) => e.preventDefault());
    c.elt.style.touchAction = "none";

    buildNodeCache();

    window.addEventListener("resize", () => { resizeToMount(); });
  };

  function posOnSphere(lat, lon) {
    const y = R * p.sin(lat);
    const rr = R * p.cos(lat);
    return { x: rr * p.cos(lon), y: y, z: rr * p.sin(lon) };
  }

  function lerpOnSphereObj(a, b, t) {
    const va = p.createVector(a.x, a.y, a.z);
    const vb = p.createVector(b.x, b.y, b.z);
    const v = p5.Vector.lerp(va, vb, t);
    v.normalize().mult(R);
    return { x: v.x, y: v.y, z: v.z };
  }

  function defaultSubColor(k) {
    return (k % 2 === 0) ? "#e6e6e6" : "#ffffff";
  }

  // Computes every node's static world position + default color ONE TIME.
  // This replaces per-frame trig that previously ran for every node on every draw.
  function buildNodeCache() {
    nodeCache = [];

    const LAT_PAD = 0.15;
    const rows = [];
    for (let rIdx = 1; rIdx <= S.NUM_LATITUDE; rIdx++) {
      const lat = p.map(
        rIdx,
        0,
        S.NUM_LATITUDE + 1,
        -p.HALF_PI + LAT_PAD,
        p.HALF_PI - LAT_PAD
      );
      const phase = (rIdx % 2 === 0) ? 0.0 : 0.5;

      const pts = [];
      for (let i = 0; i < S.GRID_COUNT; i++) {
        const lon = p.TWO_PI * (i + phase) / S.GRID_COUNT;
        pts.push(posOnSphere(lat, lon));
      }
      rows.push({ phase, pts });
    }

    // Anchors: stable ids 0..255
    let anchorId = 0;
    for (let r = 0; r < rows.length; r++) {
      for (let i = 0; i < S.GRID_COUNT; i++) {
        const nodeId = anchorId++;
        if (!S.sphereNodeToCellId[String(nodeId)]) continue; // skip unmapped
        const v = rows[r].pts[i];
        nodeCache.push({ id: nodeId, x: v.x, y: v.y, z: v.z, defaultHex: "#ffffff", radius: 3.2 });
      }
    }

    // Subcells: stable ids 256+
    let subId = S.GRID_COUNT * S.NUM_LATITUDE; // 256
    for (let r = 0; r < rows.length - 1; r++) {
      const upper = rows[r];
      const lower = rows[r + 1];

      if (upper.phase === 0.0 && lower.phase === 0.5) {
        for (let idx = 0; idx < S.GRID_COUNT; idx++) {
          const apex = upper.pts[(idx + 1) % S.GRID_COUNT];
          const left = lower.pts[idx];
          const right = lower.pts[(idx + 1) % S.GRID_COUNT];
          for (let k = 1; k <= S.SUBCELLS_PER_LEG; k++) cacheSub(subId++, lerpOnSphereObj(apex, left, k / (S.SUBCELLS_PER_LEG + 1)), defaultSubColor(k));
          for (let k = 1; k <= S.SUBCELLS_PER_LEG; k++) cacheSub(subId++, lerpOnSphereObj(apex, right, k / (S.SUBCELLS_PER_LEG + 1)), defaultSubColor(k));
        }
      } else {
        for (let idx = 0; idx < S.GRID_COUNT; idx++) {
          const apex = upper.pts[idx];
          const left = lower.pts[idx];
          const right = lower.pts[(idx + 1) % S.GRID_COUNT];
          for (let k = 1; k <= S.SUBCELLS_PER_LEG; k++) cacheSub(subId++, lerpOnSphereObj(apex, left, k / (S.SUBCELLS_PER_LEG + 1)), defaultSubColor(k));
          for (let k = 1; k <= S.SUBCELLS_PER_LEG; k++) cacheSub(subId++, lerpOnSphereObj(apex, right, k / (S.SUBCELLS_PER_LEG + 1)), defaultSubColor(k));
        }
      }
    }

    function cacheSub(nodeId, v, defaultHex) {
      if (!S.sphereNodeToCellId[String(nodeId)]) return; // skip unmapped
      nodeCache.push({ id: nodeId, x: v.x, y: v.y, z: v.z, defaultHex, radius: 2.1 });
    }
  }

  p.draw = () => {
    p.background(15);

    // Orbit + zoom (mouse/touch drag only — keyboard rotation removed)
    p.orbitControl(1, 1, 0.25);

    // Keep lon=0 centered (matches the grid pairing intuition)
    p.rotateY(-p.HALF_PI);

    p.ambientLight(90);
    p.directionalLight(255, 255, 255, 0.3, 0.6, -1);

    // Sphere surface
    p.noStroke();
    p.ambientMaterial(p.color(S.sphereBaseColor || "#1c1c1c"));
    p.sphere(R, quality.mainU, quality.mainV);

    // Only redo hover/pick math if the pointer actually moved (skips ~2600
    // distance checks + matrix math per frame while the pointer is idle).
    const mouseMoved = (p.mouseX !== lastMouseX) || (p.mouseY !== lastMouseY);
    lastMouseX = p.mouseX;
    lastMouseY = p.mouseY;

    const candidates = mouseMoved ? [] : null;

    for (let i = 0; i < nodeCache.length; i++) {
      const n = nodeCache[i];
      const nk = String(n.id);
      const hex = S.nodePaint[nk] || n.defaultHex;

      if (candidates) {
        const sp = projectToScreen(n.x, n.y, n.z);
        if (sp) candidates.push({ id: n.id, x: sp.x, y: sp.y, depth: sp.depth, pos: n, radius: n.radius });
      }

      p.noStroke();
      p.ambientMaterial(p.color(hex));
      p.push();
      p.translate(n.x, n.y, n.z);
      p.sphere(n.radius, quality.nodeU, quality.nodeV);
      p.pop();
    }

    if (candidates) {
      // Resolve hover (front-most candidate within threshold)
      hoveredId = null;
      hoveredPos = null;
      hoveredRadius = 0;

      let best = null;
      let bestDepth = -1e9;
      let bestD = 1e9;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const dx = p.mouseX - c.x;
        const dy = p.mouseY - c.y;
        const d = dx*dx + dy*dy;
        if (d < 100) {
          if (c.depth > bestDepth || (c.depth === bestDepth && d < bestD)) {
            bestDepth = c.depth;
            bestD = d;
            best = c;
          }
        }
      }

      if (best) {
        hoveredId = best.id;
        hoveredPos = best.pos;
        hoveredRadius = best.radius;
      }
      S.hoverSphere = null;
    }

    // Halo
    if (hoveredPos) {
      p.push();
      p.translate(hoveredPos.x, hoveredPos.y, hoveredPos.z);
      p.noFill();
      p.stroke(255);
      p.strokeWeight(2);
      p.sphere(hoveredRadius * 1.9, 12, 10);
      p.pop();
    }
  };
  // Sphere is preview-only; painting is disabled here.

  function projectToScreen(x, y, z) {
    const r = p._renderer;
    if (!r || !r.uMVMatrix || !r.uPMatrix) return null;

    const mv = r.uMVMatrix.mat4;
    const pr = r.uPMatrix.mat4;

    const v0 = x, v1 = y, v2 = z, v3 = 1;

    const ex = mv[0]*v0 + mv[4]*v1 + mv[8]*v2  + mv[12]*v3;
    const ey = mv[1]*v0 + mv[5]*v1 + mv[9]*v2  + mv[13]*v3;
    const ez = mv[2]*v0 + mv[6]*v1 + mv[10]*v2 + mv[14]*v3;
    const ew = mv[3]*v0 + mv[7]*v1 + mv[11]*v2 + mv[15]*v3;

    const cx = pr[0]*ex + pr[4]*ey + pr[8]*ez  + pr[12]*ew;
    const cy = pr[1]*ex + pr[5]*ey + pr[9]*ez  + pr[13]*ew;
    const cw = pr[3]*ex + pr[7]*ey + pr[11]*ez + pr[15]*ew;

    if (cw === 0 || ew === 0) return null;

    const eyeZ = ez / ew;

    const nx = cx / cw;
    const ny = cy / cw;

    const sx = (nx * 0.5 + 0.5) * p.width;
    const sy = (-ny * 0.5 + 0.5) * p.height;
    return { x: sx, y: sy, depth: eyeZ };
  }
});
