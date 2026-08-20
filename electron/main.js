const { app, BrowserWindow } = require("electron");
const path = require("path");

let splashWindow;
let mainWindow;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 420,
    frame: false,
    resizable: false,
    center: true,
    show: true,
    backgroundColor: "#08080a",
    webPreferences: {
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, "splash.html"));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    icon: path.join(__dirname, "icon.ico"),
    show: false,
    webPreferences: {
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));

  mainWindow.once("ready-to-show", () => {
    // Make sure the splash animation has had time to fully play (it settles
    // around 2.5s) even if the app itself loads faster than that.
    const MIN_SPLASH_MS = 7000;
    const elapsed = Date.now() - splashStartTime;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);

    setTimeout(() => {
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
    }, remaining);
  });
}

let splashStartTime;

app.whenReady().then(() => {
  splashStartTime = Date.now();
  createSplashWindow();
  createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    splashStartTime = Date.now();
    createSplashWindow();
    createMainWindow();
  }
});