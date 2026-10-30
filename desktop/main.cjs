const { app, BrowserWindow, shell, dialog, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { startServer } = require('../server/index.cjs');
let backend;
let window;

app.whenReady().then(async () => {
  const credentialFile = path.join(app.getPath('userData'), 'lob-credentials.enc');
  const available = () => safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  const credentialStore = {
    storage: 'OS-protected encrypted storage',
    get: () => {
      if (!fs.existsSync(credentialFile)) return null;
      if (!available()) throw new Error('OS encryption is unavailable; stored credentials cannot be opened.');
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialFile)));
    },
    set: value => {
      if (!available()) throw new Error('OS encryption is unavailable; credentials were not saved.');
      fs.mkdirSync(path.dirname(credentialFile), { recursive: true });
      const temporary = `${credentialFile}.tmp`;
      fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
      fs.renameSync(temporary, credentialFile);
    },
    delete: () => { fs.rmSync(credentialFile, { force: true }); },
  };
  backend = await startServer({
    port: 0,
    host: '127.0.0.1',
    rootDir: app.getAppPath(),
    dataDir: path.join(app.getPath('userData'), 'workspace'),
    staticDir: path.join(app.getAppPath(), 'dist'),
    credentialStore,
  });
  const origin = `http://127.0.0.1:${backend.port}`;
  const openWindow = () => {
    window = new BrowserWindow({
      width: 1440, height: 940, minWidth: 900, minHeight: 650,
      title: 'Permit Atlas', backgroundColor: '#f5f3ed',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) {
        event.preventDefault();
        if (/^https:\/\//.test(url)) shell.openExternal(url);
      }
    });
    window.loadURL(origin);
  };
  openWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) openWindow(); });
}).catch((error) => {
  dialog.showErrorBox('Permit Atlas could not start', error.message);
  app.quit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (backend) backend.close(); });
