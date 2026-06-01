import type { ElectronAPI } from '@electron-toolkit/preload'
import type { RefinerApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    refiner: RefinerApi
  }
}

export {}
