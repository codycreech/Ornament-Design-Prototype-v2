// shared.js — global shared state for all sketches

window.Shared = {
  // Sphere lattice constants (your finalized model)
  GRID_COUNT: 16,
  NUM_LATITUDE: 16,
  SUBCELLS_PER_LEG: 5,

  // Mapping (filled by mappingData.js)
  cellIdToSphereNode: Object.create(null), // cellId -> nodeId
  sphereNodeToCellId: Object.create(null), // nodeId -> cellId

  // Paint state (authoritative is nodePaint)
  selectedColor: "#00aaff",
  defaults: {
    anchors: "#dc2828",
    subOdd:  "#50dc78",
    subEven: "#e6c83c",
    sphere:  "#1c1c1c"
  },
  sphereBaseColor: "#1c1c1c",

  // Paint profiles (saved bead paint states)
  profiles: [],
  activeProfileName: "",

  nodePaint: Object.create(null), // nodeId -> css color
  cellPaint: Object.create(null), // cellId -> css color (cached for grid draw)

  // UI toggles
  paintEnabled: true,
  touchErase: false, // mobile: when true, touch paints as erase

  // Brush: how many cells wide a single paint stroke covers (1 = single cell)
  brushSize: 1,

  // Performance: 'auto' picks based on device, or force 'low' | 'medium' | 'high'
  performanceMode: "auto",

  // Live hover info
  hoverGrid: null,   // { cellId, nodeId }
  hoverSphere: null  // { nodeId }
};

// Helpers shared across sketches
window.SharedHelpers = {
  setPaintByCellId(cellId, colorOrNull) {
    const S = window.Shared;
    const nodeId = S.cellIdToSphereNode[String(cellId)];
    if (nodeId === undefined) return;
    const nk = String(nodeId);
    const ck = String(cellId);
    if (colorOrNull == null) {
      delete S.nodePaint[nk];
      delete S.cellPaint[ck];
    } else {
      S.nodePaint[nk] = colorOrNull;
      S.cellPaint[ck] = colorOrNull;
    }
  },

  setPaintByNodeId(nodeId, colorOrNull) {
    const S = window.Shared;
    const nk = String(nodeId);
    const cellId = S.sphereNodeToCellId[Number(nodeId)];
    if (colorOrNull == null) {
      delete S.nodePaint[nk];
      if (cellId) delete S.cellPaint[String(cellId)];
    } else {
      S.nodePaint[nk] = colorOrNull;
      if (cellId) S.cellPaint[String(cellId)] = colorOrNull;
    }
  }
,
  // ---- Profiles ----
  buildPaintProfile(name) {
    const S = window.Shared;
    return {
      version: 1,
      name: name || "",
      createdAt: new Date().toISOString(),
      sphereBaseColor: S.sphereBaseColor,
      nodePaint: { ...S.nodePaint }
    };
  },

  applyPaintProfile(profile) {
    const S = window.Shared;
    if (!profile || typeof profile !== "object") return;

    // Optional: sphere base color stored with profile
    if (profile.sphereBaseColor) S.sphereBaseColor = profile.sphereBaseColor;

    // Clear then rebuild via stable nodeId -> cellId mapping
    S.nodePaint = Object.create(null);
    S.cellPaint = Object.create(null);

    const np = profile.nodePaint || {};
    for (const [nodeId, color] of Object.entries(np)) {
      if (!color) continue;
      window.SharedHelpers.setPaintByNodeId(nodeId, color);
    }
  },

  // ---- Device / performance detection ----
  // Rough heuristic: phones get the lowest tier, tablets/small laptops medium,
  // everything else (desktop) high. Used to pick sphere polygon detail and
  // frame-rate caps so the app stays smooth on mobile GPUs and battery.
  detectDeviceTier() {
    const w = Math.min(window.innerWidth || 1200, window.innerHeight || 1200) === window.innerHeight
      ? Math.max(window.innerWidth || 1200, 1)
      : Math.max(window.innerWidth || 1200, 1);
    const shortSide = Math.min(window.innerWidth || 1200, window.innerHeight || 1200);
    const touch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
    if (touch && shortSide < 600) return "phone";
    if (touch && shortSide < 1100) return "tablet";
    return "desktop";
  },

  getPerformanceTier() {
    const S = window.Shared;
    if (S.performanceMode && S.performanceMode !== "auto") return S.performanceMode;
    const tier = window.SharedHelpers.detectDeviceTier();
    if (tier === "phone") return "low";
    if (tier === "tablet") return "medium";
    return "high";
  },

  // Tunables per tier: [sphereMainDetailU, sphereMainDetailV, nodeDetailU, nodeDetailV, targetFrameRate]
  getQualitySettings() {
    const tier = window.SharedHelpers.getPerformanceTier();
    if (tier === "low") return { mainU: 32, mainV: 16, nodeU: 4, nodeV: 3, fps: 30 };
    if (tier === "medium") return { mainU: 44, mainV: 22, nodeU: 5, nodeV: 4, fps: 45 };
    return { mainU: 56, mainV: 28, nodeU: 7, nodeV: 5, fps: 60 };
  }
};
