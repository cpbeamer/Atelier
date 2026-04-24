const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: true
  });

  // Open DevTools automatically
  win.webContents.openDevTools();

  // In development, load from Vite
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  console.log('[Electron] Creating window, isDev:', isDev);
  if (isDev) {
    console.log('[Electron] Loading http://localhost:5173');
    win.loadURL('http://localhost:5173').catch(err => {
      console.error('[Electron] Failed to load URL:', err);
    });
    win.webContents.on('did-fail-load', (event, errorCode, errorDesc) => {
      console.error('[Electron] Failed to load:', errorCode, errorDesc);
    });
    win.webContents.on('did-finish-load', () => {
      console.log('[Electron] Page finished loading');
    });
  } else {
    win.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
  }
}

// Handle folder picker
ipcMain.handle('dialog:openFolder', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled) return null;
    return result.filePaths[0] || null;
  } catch (err) {
    console.error('[Electron] dialog:openFolder failed:', err);
    throw err;
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
