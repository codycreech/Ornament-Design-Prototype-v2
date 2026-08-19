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
  hoverSphere: null, // { nodeId }

  // True whenever painted work (or the sphere base color) has changed since
  // the last save/export/load of a profile. Drives the "unsaved changes"
  // banner and the close/navigate-away warning below.
  isDirty: false,

  // Undo history: a stack of prior { nodePaint, cellPaint, sphereBaseColor }
  // snapshots, oldest first. A snapshot is pushed before each discrete,
  // potentially-destructive action (a whole paint stroke, Clear paint,
  // loading/importing a profile) — see pushUndoSnapshot()/undo() below.
  undoStack: [],

  // True while the eyedropper tool is armed: the next click/tap on the grid
  // samples that cell's color into the brush instead of painting.
  eyedropperActive: false
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
    window.SharedHelpers.markDirty();
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
    window.SharedHelpers.markDirty();
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

    // The state now matches a known saved profile, so there's nothing
    // unsaved anymore (setPaintByNodeId above marked it dirty along the way).
    window.SharedHelpers.markSaved();
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
  },

  // ---- Unsaved-changes guard ----
  // Call whenever painted state (or the sphere base color) changes.
  markDirty() {
    window.Shared.isDirty = true;
    window.SharedHelpers._refreshUnsavedBanner();
  },

  // Call once the current state is safely captured in a saved/exported/
  // loaded profile.
  markSaved() {
    window.Shared.isDirty = false;
    window.SharedHelpers._refreshUnsavedBanner();
  },

  _refreshUnsavedBanner() {
    const el = document.getElementById("unsavedBanner");
    if (!el) return;
    el.hidden = !window.Shared.isDirty;
  },

  // ---- Undo ----
  UNDO_LIMIT: 50,

  // Call before a discrete, possibly-unwanted mutation (a paint stroke,
  // Clear paint, loading/importing a profile) so it can be undone.
  pushUndoSnapshot() {
    const S = window.Shared;
    S.undoStack.push({
      nodePaint: { ...S.nodePaint },
      cellPaint: { ...S.cellPaint },
      sphereBaseColor: S.sphereBaseColor
    });
    if (S.undoStack.length > window.SharedHelpers.UNDO_LIMIT) S.undoStack.shift();
  },

  // Reverts to the state captured by the most recent pushUndoSnapshot().
  // Returns true if something was actually undone.
  undo() {
    const S = window.Shared;
    if (!S.undoStack.length) return false;
    const snap = S.undoStack.pop();
    S.nodePaint = snap.nodePaint;
    S.cellPaint = snap.cellPaint;
    S.sphereBaseColor = snap.sphereBaseColor;
    window.SharedHelpers.markDirty();
    return true;
  }
};

// Ctrl/Cmd+Z undoes the last paint action from anywhere in the app, except
// while the user is actually typing in a text field (e.g. the profile name).
window.addEventListener("keydown", (e) => {
  if (!(e.key === "z" || e.key === "Z") || !(e.ctrlKey || e.metaKey) || e.shiftKey) return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (window.SharedHelpers.undo()) e.preventDefault();
});

// Keeps the user from accidentally losing painted work: while anything is
// unsaved, closing the tab, reloading, or navigating away triggers the
// browser's native "leave site?" confirmation. A small banner (toggled by
// markDirty/markSaved above) stays visible the whole time as a reminder,
// so the warning on close is never a surprise.
window.addEventListener("beforeunload", (e) => {
  if (!window.Shared.isDirty) return;
  e.preventDefault();
  e.returnValue = "You have unsaved paint changes. Save or export a profile before leaving, or they'll be lost.";
  return e.returnValue;
});

document.addEventListener("DOMContentLoaded", () => {
  window.SharedHelpers._refreshUnsavedBanner();
});
