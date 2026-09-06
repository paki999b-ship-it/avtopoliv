import { BrowserWindow, app, shell } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { openDatabase } from './db/connection.js';
import { seedReferenceData } from './db/seed.js';
import { contentDir, contentFile, databaseFile } from './content/paths.js';
import { registerIpc } from './ipc/register.js';

/**
 * Главный процесс АртЛандшафт.
 *
 * Приложение офлайн: сеть не используется нигде, ключей не хранит (§13 ТЗ).
 * Поэтому renderer запускается без интеграции с Node, с контекстной изоляцией,
 * а любая попытка увести пользователя на внешний адрес отдаётся системному
 * браузеру, а не открывается внутри окна.
 */

// Имя пакета — «@irrigo/electron-app», и Electron сделал бы из него каталог
// вида %APPDATA%\@irrigo\electron-app. Имя задаётся явно и до первого
// обращения к getPath('userData'), иначе база уедет по другому пути.
app.setName('IrrigoMaster');

const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0E1613',
    autoHideMenuBar: true,
    title: 'АртЛандшафт',
    // Иконка окна и панели задач. Берётся из того же файла, что и логотип в
    // интерфейсе: второй источник бренда неизбежно разошёлся бы с первым.
    // Отдельного .ico нет, потому что сборщик установщика в проекте не
    // настроен — Electron принимает PNG напрямую.
    ...(existsSync(contentFile('ARTlogo.png')) ? { icon: contentFile('ARTlogo.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  // Внешние ссылки — в системный браузер, окно приложения остаётся на месте.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

function bootstrap(): void {
  const db = openDatabase(databaseFile());

  const seed = seedReferenceData(db, contentDir());
  console.log(
    seed.seeded
      ? `[db] справочники пересобраны: ${JSON.stringify(seed.counts)}`
      : `[db] справочники актуальны: ${JSON.stringify(seed.counts)}`,
  );

  registerIpc(db);
  mainWindow = createWindow();

  app.on('before-quit', () => {
    db.close();
  });
}

// Один экземпляр: две копии на одном файле базы — источник трудноуловимых
// расхождений в прогрессе.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(bootstrap);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
}
