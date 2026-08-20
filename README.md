# Ornament Design Prototype

A desktop app for designing bead-wrapped ornament patterns. Paint a flat, 2D bead grid and watch the pattern build in real time on a rotatable 3D sphere preview, so you can see exactly how a design will wrap around the finished ornament before you ever pick up a bead.

Built with [p5.js](https://p5js.org/) and packaged as a Windows desktop app with [Electron](https://www.electronjs.org/).

## Features

- **Paintable bead grid** — a flattened 2D layout of every bead position (anchor beads plus the subcells between them). Left-drag to paint, right-drag to erase.
- **Live 3D sphere preview** — the same pattern rendered on a rotatable, zoomable sphere via an orbit camera, so you can check how the design reads once it's wrapped around the ornament.
- **Brush tools** — adjustable brush size (paint several cells per stroke), an eyedropper to pick up a color already on the grid, and a custom sphere base (background) color.
- **Undo / clear** — step back through paint strokes, clears, and profile loads with Ctrl/Cmd+Z or the Undo button; Clear paint resets the whole design.
- **Paint profiles** — save a named design, reload it later, or delete it. Profiles live in the browser's local storage.
- **Import / export** — export a profile to a file to back it up or share it, and import one back in.
- **Print & PNG export** — print the flat grid directly, or download it as a PNG for reference while beading.
- **Adjustable performance mode** — Auto, Battery saver, Balanced, or Best quality, controlling sphere polygon detail and frame rate so it stays smooth on lower-powered laptops and tablets.
- **Animated splash screen & custom app icon** on the Windows build.

## Running it

### As a plain web page

No build step required — it's a static site. Open `index.html` directly in a browser, or serve the folder with any static file server, e.g.:

```
npx serve .
```

### As the Windows desktop app (development)

```
npm install
npm run start
```

This launches the Electron shell (splash screen, then the main app window) pointed at the local files.

### Building a distributable Windows build

```
npm run dist
```

This runs `electron-builder` and produces both an NSIS installer and a portable `.exe` in `dist/`, using the settings in the `build` block of `package.json`.

## Project structure

```
index.html          Static entry point / page layout
style.css            App styling
shared.js            Shared app state + helper functions (paint state, profiles, undo, performance tiers)
mappingData.js        Generated mapping between grid cells and sphere node IDs
gridSketch.js         p5.js sketch for the paintable 2D grid
sphereSketch.js       p5.js sketch for the 3D sphere preview (WEBGL)
controlsSketch.js     p5.js sketch for the left-hand controls panel (brush, profiles, export, etc.)
electron/
  main.js              Electron main process — splash window + main window handoff
  splash.html           Animated splash screen shown while the app loads
  icon.ico              Windows app/exe icon
```

## How the pattern maps to the sphere

The bead layout is defined by two constants in `shared.js` — latitude rows and beads-per-row — plus a fixed number of "subcell" beads strung between each pair of anchor beads. `mappingData.js` is a generated lookup table pairing every flat grid cell to a stable node ID on the sphere, so painting a cell on the grid updates the matching node on the sphere instantly.

## Tech stack

- [p5.js](https://p5js.org/) (2D canvas for the grid, WEBGL for the sphere)
- Vanilla JavaScript, no framework or build tooling for the web app itself
- [Electron](https://www.electronjs.org/) for the desktop shell
- [electron-builder](https://www.electron.build/) for producing the Windows installer/portable build

## License

ISC
