import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipcHandlers'
import { isAllowedNavigation } from './navigationPolicy'
import { openExternalLink } from './handlers/shellHandlers'
import { APP_USER_MODEL_ID } from './appIdentity'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'prompt-ide',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 新しいウィンドウは開かない。http・https だけを既定のブラウザへ渡し、ほかのスキーム(file:・独自のスキーム)は開かない
  mainWindow.webContents.setWindowOpenHandler((details) => {
    // 開けなかったとき(既定のブラウザが無いなど)の reject は openExternalLink が握る
    void openExternalLink((url) => shell.openExternal(url), details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  const indexHtmlPath = join(__dirname, '../renderer/index.html')
  const appUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : pathToFileURL(indexHtmlPath).href

  // アプリ自身の URL 以外への遷移を止める(遷移した先のページに preload の API が渡らないように)
  mainWindow.webContents.on('will-navigate', (event) => {
    if (!isAllowedNavigation(event.url, appUrl)) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(indexHtmlPath)
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  // Windows の通知の送り元。electron-builder.yml の appId と同じ値(appIdentity.ts)
  electronApp.setAppUserModelId(APP_USER_MODEL_ID)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers(ipcMain)

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
