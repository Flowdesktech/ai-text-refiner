import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  HotkeyStatuses,
  PlatformInfo,
  ProviderId,
  RefineResult,
  RefineStatus,
  Settings,
  SettingsWithSecrets
} from '../shared/types'

export interface RefinerApi {
  getSettings: () => Promise<SettingsWithSecrets>
  updateSettings: (
    patch: Partial<Settings>
  ) => Promise<{ settings: SettingsWithSecrets; hotkeyStatuses: HotkeyStatuses }>
  setApiKey: (provider: ProviderId, key: string) => Promise<SettingsWithSecrets>
  getPlatformInfo: () => Promise<PlatformInfo>
  getHotkeyStatus: () => Promise<HotkeyStatuses>
  isEncryptionAvailable: () => Promise<boolean>
  openAccessibilitySettings: () => Promise<void>
  testRefine: (sampleText: string) => Promise<RefineResult>
  runRefine: (selectAll?: boolean) => Promise<{ ok: boolean }>
  onStatus: (cb: (status: RefineStatus) => void) => () => void
}

const api: RefinerApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  setApiKey: (provider, key) => ipcRenderer.invoke('settings:setApiKey', provider, key),
  getPlatformInfo: () => ipcRenderer.invoke('platform:get'),
  getHotkeyStatus: () => ipcRenderer.invoke('hotkey:getStatus'),
  isEncryptionAvailable: () => ipcRenderer.invoke('platform:encryptionAvailable'),
  openAccessibilitySettings: () => ipcRenderer.invoke('platform:openAccessibility'),
  testRefine: (sampleText) => ipcRenderer.invoke('refine:test', sampleText),
  runRefine: (selectAll) => ipcRenderer.invoke('refine:run', selectAll),
  onStatus: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, status: RefineStatus): void => cb(status)
    ipcRenderer.on('refine:status', listener)
    return () => ipcRenderer.removeListener('refine:status', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('refiner', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define on window when context isolation is disabled)
  window.electron = electronAPI
  // @ts-ignore
  window.refiner = api
}
