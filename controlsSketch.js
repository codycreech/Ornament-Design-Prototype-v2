// controlsSketch.js — left-side controls (sticky)
// Includes: brush, paint toggle (grid only), sphere base color, paint profiles save/load.

new p5((p) => {
  const S = window.Shared;
  const H = window.SharedHelpers;

  const LS_PROFILES = "ornament_profiles_v1";
  const LS_ACTIVE   = "ornament_active_profile_v1";

  let colorInput, paintToggle, clearBtn;
  let sphereColorInput;

  let profileNameInput, profileSelect;
  let saveProfileBtn, loadProfileBtn, deleteProfileBtn;
  let exportProfileBtn, importFileInput, importProfileBtn;
  let importStatusDiv;

  function loadProfilesFromLS() {
    try {
      const raw = localStorage.getItem(LS_PROFILES);
      const obj = raw ? JSON.parse(raw) : {};
      S.profiles = Object.keys(obj).sort().map(name => obj[name]);
    } catch (e) {
      S.profiles = [];
    }
    S.activeProfileName = localStorage.getItem(LS_ACTIVE) || "";
  }

  function saveProfilesToLS() {
    const obj = {};
    for (const prof of (S.profiles || [])) {
      if (prof && prof.name) obj[prof.name] = prof;
    }
    localStorage.setItem(LS_PROFILES, JSON.stringify(obj));
    localStorage.setItem(LS_ACTIVE, S.activeProfileName || "");
  }

  function refreshProfileSelect() {
    if (!profileSelect) return;
    profileSelect.elt.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— select profile —";
    profileSelect.elt.appendChild(opt0);

    for (const prof of (S.profiles || [])) {
      const opt = document.createElement("option");
      opt.value = prof.name;
      opt.textContent = prof.name;
      profileSelect.elt.appendChild(opt);
    }
    profileSelect.value(S.activeProfileName || "");
  }

  function getProfileByName(name) {
    return (S.profiles || []).find(pf => pf && pf.name === name) || null;
  }

  function applyProfileByName(name) {
    const prof = getProfileByName(name);
    if (!prof) return;
    H.applyPaintProfile(prof);
    S.activeProfileName = name;
    saveProfilesToLS();

    // Sync UI values
    if (sphereColorInput) sphereColorInput.value(S.sphereBaseColor);
    if (colorInput) colorInput.value(S.selectedColor);
  }

  function upsertProfile(profile) {
    if (!profile || !profile.name) return;
    S.profiles = (S.profiles || []).filter(pf => pf && pf.name !== profile.name);
    S.profiles.push(profile);
    S.profiles.sort((a,b) => (a.name||"").localeCompare(b.name||""));
    S.activeProfileName = profile.name;
    saveProfilesToLS();
    refreshProfileSelect();
  }

  let brushSlider, brushValueSpan;
  let perfSelect;

  p.setup = () => {
    const c = p.createCanvas(260, 200);
    c.parent("controlsMount");
    p.pixelDensity(1);
    p.textFont("monospace");

    // This panel is just status text — no need to redraw at 60fps.
    p.frameRate(10);

    const ui = p.select("#controlsUI");
    ui.html("");

    // Row: Brush color
    const row1 = p.createDiv().parent(ui).addClass("row");
    p.createSpan("Brush:").parent(row1).addClass("label");
    colorInput = p.createInput(S.selectedColor, "color").parent(row1);
    colorInput.input(() => { S.selectedColor = colorInput.value(); });

    // Row: Brush size (paint multiple cells at once for efficiency)
    const rowBrush = p.createDiv().parent(ui).addClass("row");
    p.createSpan("Brush size:").parent(rowBrush).addClass("label");
    const brushWrap = p.createDiv().parent(rowBrush);
    brushWrap.style("display", "flex");
    brushWrap.style("align-items", "center");
    brushWrap.style("gap", "8px");
    brushSlider = p.createSlider(1, 6, S.brushSize || 1, 1).parent(brushWrap);
    brushValueSpan = p.createSpan(String(S.brushSize || 1)).parent(brushWrap);
    brushSlider.input(() => {
      S.brushSize = brushSlider.value();
      brushValueSpan.html(String(S.brushSize));
    });

    // Row: Paint toggle
    const row2 = p.createDiv().parent(ui).addClass("row");
    paintToggle = p.createCheckbox("Painting enabled (grid)", true).parent(row2);
    paintToggle.changed(() => { S.paintEnabled = paintToggle.checked(); });

    // Row: Touch erase toggle (mobile)
    const row2b = p.createDiv().parent(ui).addClass("row");
    const touchEraseToggle = p.createCheckbox("Touch eraser mode", false).parent(row2b);
    touchEraseToggle.changed(() => { S.touchErase = touchEraseToggle.checked(); });

    // Row: Performance mode (auto picks based on device; phones/tablets
    // default to lower sphere detail + frame rate for smoothness/battery)
    const rowPerf = p.createDiv().parent(ui).addClass("row");
    p.createSpan("Performance:").parent(rowPerf).addClass("label");
    perfSelect = p.createSelect().parent(rowPerf);
    perfSelect.option("Auto (recommended)", "auto");
    perfSelect.option("Battery saver", "low");
    perfSelect.option("Balanced", "medium");
    perfSelect.option("Best quality", "high");
    perfSelect.selected(S.performanceMode || "auto");
    perfSelect.changed(() => {
      S.performanceMode = perfSelect.value();
      if (importStatusDiv) importStatusDiv.html("Performance mode changed — reload the page to apply it to the sphere preview.");
    });

    // Row: Sphere base color
    const row3 = p.createDiv().parent(ui).addClass("row");
    p.createSpan("Sphere:").parent(row3).addClass("label");
    sphereColorInput = p.createInput(S.sphereBaseColor || "#1c1c1c", "color").parent(row3);
    sphereColorInput.input(() => { S.sphereBaseColor = sphereColorInput.value(); });

    // Row: Clear paint
    const row4 = p.createDiv().parent(ui).addClass("row");
    clearBtn = p.createButton("Clear paint").parent(row4);
    clearBtn.mousePressed(() => {
      S.nodePaint = Object.create(null);
      S.cellPaint = Object.create(null);
    });

    // ---- Profiles UI ----
    const profTitle = p.createDiv("Profiles").parent(ui);
    profTitle.style("margin-top", "10px");
    profTitle.style("font-weight", "700");

    const rowP1 = p.createDiv().parent(ui).addClass("row");
    p.createSpan("Name:").parent(rowP1).addClass("label");
    profileNameInput = p.createInput("", "text").parent(rowP1);
    profileNameInput.attribute("placeholder", "e.g. Snowflake A");

    const rowP2 = p.createDiv().parent(ui).addClass("row");
    profileSelect = p.createSelect().parent(rowP2);
    profileSelect.changed(() => {
      const name = profileSelect.value();
      if (name) profileNameInput.value(name);
    });

    const rowP3 = p.createDiv().parent(ui).addClass("row");
    saveProfileBtn = p.createButton("Save").parent(rowP3);
    loadProfileBtn = p.createButton("Load").parent(rowP3);
    deleteProfileBtn = p.createButton("Delete").parent(rowP3);

    saveProfileBtn.mousePressed(() => {
      const name = (profileNameInput.value() || "").trim();
      if (!name) return;
      const prof = H.buildPaintProfile(name);
      upsertProfile(prof);
      refreshProfileSelect();
    });

    loadProfileBtn.mousePressed(() => {
      const name = (profileNameInput.value() || profileSelect.value() || "").trim();
      if (!name) return;
      applyProfileByName(name);
      refreshProfileSelect();
    });

    deleteProfileBtn.mousePressed(() => {
      const name = (profileNameInput.value() || profileSelect.value() || "").trim();
      if (!name) return;
      S.profiles = (S.profiles || []).filter(pf => pf && pf.name !== name);
      if (S.activeProfileName === name) S.activeProfileName = "";
      saveProfilesToLS();
      refreshProfileSelect();
    });

    const rowP4 = p.createDiv().parent(ui).addClass("row");
    exportProfileBtn = p.createButton("Export").parent(rowP4);
    importProfileBtn = p.createButton("Import").parent(rowP4);

    importStatusDiv = p.createDiv("").parent(ui);
    importStatusDiv.addClass("hint");

    // Hidden but clickable file input (off-screen)
    importFileInput = p.createFileInput((file) => {
      const finish = (txt) => {
        try {
          if (!txt) throw new Error("Empty file data");
          // p5 sometimes gives a base64 data URL
          if (typeof txt === "string" && txt.startsWith("data:")) {
            const comma = txt.indexOf(",");
            const payload = txt.slice(comma + 1);
            if (txt.includes(";base64,")) {
              txt = atob(payload);
            } else {
              txt = decodeURIComponent(payload);
            }
          }
          const prof = JSON.parse(txt);
          if (!prof.name) prof.name = "Imported " + new Date().toISOString().slice(0,19).replace("T"," ");
          upsertProfile(prof);
          applyProfileByName(prof.name);
          refreshProfileSelect();
          if (importStatusDiv) importStatusDiv.html(`Imported: <b>${prof.name}</b>`);
        } catch (e) {
          console.error("Import failed:", e);
          if (importStatusDiv) importStatusDiv.html("Import failed — check console.");
        }
      };

      if (!file) return;

      // Prefer p5's file.data when present
      if (typeof file.data === "string" && file.data.length) {
        finish(file.data);
        return;
      }

      // Fallback: native File object
      if (file.file) {
        const reader = new FileReader();
        reader.onload = () => finish(String(reader.result || ""));
        reader.onerror = () => finish("");
        reader.readAsText(file.file);
        return;
      }

      finish("");
    }).parent(ui);

    // Make it invisible but still "clickable"
    importFileInput.style("position", "absolute");
    importFileInput.style("left", "-10000px");
    importFileInput.style("top", "0px");
    importFileInput.style("opacity", "0");

    exportProfileBtn.mousePressed(() => {
      const name = (profileNameInput.value() || S.activeProfileName || "profile").trim();
      const prof = H.buildPaintProfile(name);
      // also keep it in list
      upsertProfile(prof);
      p.saveJSON(prof, `${name.replace(/[^a-z0-9\-_]+/gi,"_")}.json`);
    });

    importProfileBtn.mousePressed(() => {
      // trigger chooser
      importFileInput.elt.value = "";
      importFileInput.elt.click();
    });

    const hint = p.createDiv("Grid paints; sphere is preview only. L-drag paint, R-drag erase. Increase brush size to paint several cells per stroke.").parent(ui);

    // ---- Output ----
    const rowOut = p.createDiv().parent(ui).addClass("row");

    const printBtn = p.createButton("Print grid").parent(rowOut);
    printBtn.mousePressed(() => window.print());

    const pngBtn = p.createButton("Download PNG").parent(rowOut);
    pngBtn.mousePressed(() => {
      const c = document.querySelector("#gridMount canvas");
      if (!c) return;
      const a = document.createElement("a");
      a.download = (S.activeProfileName ? S.activeProfileName : "grid") + ".png";
      a.href = c.toDataURL("image/png");
      a.click();
    });

    hint.addClass("hint");

    // Load profiles
    loadProfilesFromLS();
    refreshProfileSelect();

    // Auto-load active profile if present
    if (S.activeProfileName) {
      const prof = getProfileByName(S.activeProfileName);
      if (prof) H.applyPaintProfile(prof);
    }
  };

  p.draw = () => {
    p.background(0);
    p.noStroke();
    p.fill(255);
    p.textSize(14);
    p.text("Ornament Design Prototype v1", 10, 22);
    p.textSize(11);
    p.fill(180);
    p.text("Grid ⇄ Sphere paint sync", 10, 44);

    const painted = Object.keys(S.nodePaint).length;
    p.fill(140);
   _attach = painted
    p.text(`Painted nodes: ${painted}`, 10, 66);

    if (!S.paintEnabled) {
      p.fill(255, 90, 90);
      p.text("Painting is OFF", 10, 88);
    } else {
      p.fill(120);
      p.text("Painting is ON", 10, 88);
    }

    if (S.activeProfileName) {
      p.fill(160);
      p.text(`Profile: ${S.activeProfileName}`, 10, 110);
    } else {
      p.fill(90);
      p.text("Profile: (none)", 10, 110);
    }
  };
});
