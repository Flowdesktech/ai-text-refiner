import {
  app,
  shell,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  nativeImage,
  Notification
} from 'electron'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import {
  buildRefinedHtml,
  captureSelection,
  extractImageTags,
  isAccessibilityGranted,
  isWayland,
  pasteRich,
  pasteText,
  readClipboardImage,
  replacePrevious,
  replacePreviousRich,
  restoreClipboard,
  snapshotClipboard,
  stripImagePlaceholders
} from './automation'
import { refine, RefineError } from './providers'
import {
  getApiKey,
  getSettings,
  getSettingsWithSecrets,
  isEncryptionAvailable,
  setApiKey,
  updateSettings
} from './settings'
import type {
  HotkeyStatus,
  HotkeyStatuses,
  PlatformInfo,
  ProviderId,
  RefineStatus,
  Settings
} from '../shared/types'

let tray: Tray | null = null
let settingsWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let hotkeyStatuses: HotkeyStatuses = {
  selected: { ok: false, accelerator: '' },
  selectAll: { ok: false, accelerator: '' }
}
let isRefining = false

const iconPath = join(__dirname, '../../resources/icon.png')
const trayIconPath = join(__dirname, '../../resources/tray.png')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function getPlatformInfo(): PlatformInfo {
  return {
    platform: process.platform,
    isWayland: isWayland(),
    accessibilityGranted: isAccessibilityGranted(false),
    appVersion: app.getVersion()
  }
}

function createSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 560,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title: 'AI Text Refiner',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  settingsWindow.on('ready-to-show', () => settingsWindow?.show())

  // Hide to tray instead of quitting when the window is closed.
  settingsWindow.on('close', (e) => {
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
      e.preventDefault()
      settingsWindow?.hide()
    }
  })

  settingsWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createOverlayWindow(): void {
  overlayWindow = new BrowserWindow({
    width: 240,
    height: 84,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay.html'))
  }
}

function positionOverlay(): void {
  if (!overlayWindow) return
  const { screen } = require('electron') as typeof import('electron')
  const display = screen.getPrimaryDisplay()
  const { width, height, x, y } = display.workArea
  const [w, h] = overlayWindow.getSize()
  overlayWindow.setPosition(x + width - w - 24, y + height - h - 24)
}

function showStatus(status: RefineStatus): void {
  if (!overlayWindow) return
  if (status.stage !== 'done') {
    positionOverlay()
    if (!overlayWindow.isVisible()) overlayWindow.showInactive()
  }
  overlayWindow.webContents.send('refine:status', status)
}

function hideOverlaySoon(delay: number): void {
  setTimeout(() => overlayWindow?.hide(), delay)
}

/** Show a native OS notification (used so feedback isn't missed when the overlay is off). */
function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  try {
    new Notification({ title, body, silent: true }).show()
  } catch {
    // Notifications are best-effort; never let them break a refine.
  }
}

async function runRefine(selectAll: boolean): Promise<void> {
  if (isRefining) return
  const platform = getPlatformInfo()

  if (platform.isWayland) {
    showStatus({
      stage: 'error',
      message: 'Wayland blocks synthetic input. Copy text manually and use the Test button.'
    })
    hideOverlaySoon(4000)
    return
  }
  if (!isAccessibilityGranted(true)) {
    showStatus({ stage: 'error', message: 'Grant Accessibility permission in System Settings.' })
    hideOverlaySoon(4000)
    return
  }

  isRefining = true
  const settings = getSettings()
  const snapshot = settings.restoreClipboard ? snapshotClipboard() : null

  let placeholderLen = 0
  let captured = ''
  try {
    showStatus({ stage: 'capturing' })
    const capture = await captureSelection(selectAll)

    // When the selection carries an inline image (rich field), recover it now:
    // the HTML `<img>` tag preserves the real image (data-URI / remote src), and
    // the bitmap is grabbed as a fallback. After refining we paste refined text
    // plus the image back as one rich fragment, so the image is never lost.
    const hasImage = capture.hasImage
    const imageTags = hasImage ? extractImageTags(capture.html) : ''
    // Strip the plain-text placeholder the app leaves where the image sits, so
    // the word ("image", alt text, U+FFFC) isn't refined into stray text.
    captured = hasImage ? stripImagePlaceholders(capture.text, capture.html) : capture.text
    if (!captured.trim()) {
      showStatus({ stage: 'error', message: 'No text captured. Select text and try again.' })
      hideOverlaySoon(3500)
      return
    }

    // Prefer the HTML <img> (the real image). Only fall back to the flattened
    // bitmap when there's no recoverable img tag, so we never paste a duplicate
    // static copy alongside the real one.
    const imageBitmap = hasImage && !imageTags ? readClipboardImage() : null
    const apiKey = getApiKey(settings.provider) || ''

    if (settings.inlineProgress) {
      // Move feedback into the text field: an animated placeholder at the caret.
      overlayWindow?.hide()
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      const label = (f: string): string => `Refining ${f}`
      let stop = false

      const initial = label(frames[0])
      await pasteText(initial)
      placeholderLen = initial.length

      const animate = async (): Promise<void> => {
        let i = 0
        while (!stop) {
          await sleep(140)
          if (stop) break
          i = (i + 1) % frames.length
          // Only the trailing spinner glyph changes, so replace just 1 char.
          await replacePrevious(1, frames[i])
        }
      }
      const anim = animate()

      let refined: string
      try {
        refined = await refine(captured, settings, apiKey)
      } finally {
        stop = true
        await anim
      }
      if (hasImage) {
        await replacePreviousRich(
          placeholderLen,
          refined,
          buildRefinedHtml(refined, imageTags),
          imageBitmap
        )
      } else {
        await replacePrevious(placeholderLen, refined)
      }
      placeholderLen = 0
    } else {
      showStatus({ stage: 'refining' })
      const refined = await refine(captured, settings, apiKey)
      showStatus({ stage: 'pasting' })
      if (hasImage) {
        await pasteRich(refined, buildRefinedHtml(refined, imageTags), imageBitmap)
      } else {
        await pasteText(refined)
      }
      showStatus({ stage: 'done' })
      hideOverlaySoon(900)
    }
    if (settings.notifyOnSuccess) {
      notify(
        'Refined',
        hasImage ? 'Refined your text and kept the image.' : 'Your text was refined.'
      )
    }
  } catch (err) {
    const message =
      err instanceof RefineError ? err.message : err instanceof Error ? err.message : String(err)
    // Remove the in-field placeholder and restore the user's original text.
    if (placeholderLen > 0) {
      try {
        await replacePrevious(placeholderLen, captured)
      } catch {
        // best-effort restore
      }
    }
    showStatus({ stage: 'error', message })
    hideOverlaySoon(5000)
    if (settings.notifyOnError) notify('Refine failed', message)
  } finally {
    // Restore the user's original clipboard after the paste settles.
    if (snapshot) setTimeout(() => restoreClipboard(snapshot), 400)
    isRefining = false
  }
}

function registerOne(accelerator: string, selectAll: boolean): HotkeyStatus {
  if (!accelerator) {
    return { ok: false, accelerator, error: 'No hotkey set.' }
  }
  try {
    const ok = globalShortcut.register(accelerator, () => {
      void runRefine(selectAll)
    })
    if (!ok) {
      return { ok: false, accelerator, error: 'Hotkey is unavailable or already in use.' }
    }
    return { ok: true, accelerator }
  } catch (err) {
    return { ok: false, accelerator, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Re-register both global hotkeys from current settings. */
function registerHotkeys(settings: Settings): HotkeyStatuses {
  globalShortcut.unregisterAll()
  // Avoid double-registering if both accelerators are identical.
  const selected = registerOne(settings.hotkeySelected, false)
  const selectAll =
    settings.hotkeySelectAll && settings.hotkeySelectAll === settings.hotkeySelected
      ? {
          ok: false,
          accelerator: settings.hotkeySelectAll,
          error: 'Must differ from the other hotkey.'
        }
      : registerOne(settings.hotkeySelectAll, true)
  hotkeyStatuses = { selected, selectAll }
  return hotkeyStatuses
}

function applyLoginItem(enabled: boolean): void {
  if (process.platform === 'linux') return
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true })
}

// Replace Electron's default menu so its reload (Ctrl/⌘+R) and devtools
// accelerators don't hijack hotkey capture or the global shortcut.
function applyAppMenu(): void {
  if (process.platform === 'darwin') {
    const menu = Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' }
    ])
    Menu.setApplicationMenu(menu)
  } else {
    Menu.setApplicationMenu(null)
  }
}

function createTray(): void {
  let image = nativeImage.createFromPath(trayIconPath)
  if (process.platform === 'darwin' && !image.isEmpty()) {
    image = image.resize({ width: 18, height: 18 })
    image.setTemplateImage(true)
  }
  tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(iconPath) : image)
  tray.setToolTip('AI Text Refiner')
  const menu = Menu.buildFromTemplate([
    { label: 'Refine selection now', click: () => void runRefine(false) },
    { label: 'Refine entire field now', click: () => void runRefine(true) },
    { label: 'Settings…', click: () => createSettingsWindow() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        ;(app as unknown as { isQuitting?: boolean }).isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => createSettingsWindow())
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettingsWithSecrets())

  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => {
    const next = updateSettings(patch)
    if (patch.hotkeySelected !== undefined || patch.hotkeySelectAll !== undefined) {
      registerHotkeys(next)
    }
    if (patch.launchOnStartup !== undefined) applyLoginItem(next.launchOnStartup)
    return { settings: getSettingsWithSecrets(), hotkeyStatuses }
  })

  ipcMain.handle('settings:setApiKey', (_e, provider: ProviderId, key: string) => {
    setApiKey(provider, key)
    return getSettingsWithSecrets()
  })

  ipcMain.handle('platform:get', () => getPlatformInfo())

  ipcMain.handle('hotkey:getStatus', () => hotkeyStatuses)

  ipcMain.handle('platform:encryptionAvailable', () => isEncryptionAvailable())

  ipcMain.handle('platform:openAccessibility', () => {
    if (process.platform === 'darwin') {
      shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      )
    }
  })

  // Run a refine on provided sample text without any keystroke simulation.
  ipcMain.handle('refine:test', async (_e, sampleText: string) => {
    try {
      const settings = getSettings()
      const apiKey = getApiKey(settings.provider) || ''
      const text = await refine(sampleText, settings, apiKey)
      return { ok: true, text }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  })

  // Trigger the full capture→refine→paste flow from the UI (for testing).
  ipcMain.handle('refine:run', (_e, selectAll?: boolean) => {
    void runRefine(Boolean(selectAll))
    return { ok: true }
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => createSettingsWindow())

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.aitextrefiner.app')

    applyAppMenu()
    registerIpc()
    createOverlayWindow()
    createTray()

    const settings = getSettings()
    const statuses = registerHotkeys(settings)
    if (!statuses.selected.ok) console.warn('Selected-text hotkey:', statuses.selected.error)
    if (!statuses.selectAll.ok) console.warn('Select-all hotkey:', statuses.selectAll.error)
    applyLoginItem(settings.launchOnStartup)

    createSettingsWindow()

    app.on('activate', () => createSettingsWindow())
  })

  app.on('window-all-closed', () => {
    // Keep running in the tray; do not quit on window close.
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
}
