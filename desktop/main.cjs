const { app, BrowserWindow, dialog } = require('electron');

const GAME_URL = 'https://game.130-61-158-79.sslip.io';
const GAME_ORIGIN = new URL(GAME_URL).origin;

function isGameUrl(value) {
  try {
    return new URL(value).origin === GAME_ORIGIN;
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    title: 'Harvest Village',
    autoHideMenuBar: true,
    backgroundColor: '#171923',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:harvest-village'
    }
  });

  win.webContents.setWindowOpenHandler(() => ({
    action: 'deny'
  }));

  for (const event of ['will-navigate', 'will-redirect']) {
    win.webContents.on(event, (e, url) => {
      if (!isGameUrl(url)) e.preventDefault();
    });
  }

  win.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );

  win.webContents.session.setPermissionCheckHandler(() => false);

  win.loadURL(GAME_URL).catch(() => {
    if (win.isDestroyed()) return;

    dialog.showMessageBoxSync(win, {
      type: 'error',
      title: 'Bağlantı xətası',
      message: 'Oyuna qoşulmaq mümkün olmadı.',
      detail: 'İnternet bağlantısını və oyun serverini yoxla.'
    });
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
