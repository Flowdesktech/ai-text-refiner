import { safeStorage } from 'electron'
import Store from 'electron-store'
import {
  DEFAULT_HOTKEY_SELECTED,
  DEFAULT_HOTKEY_SELECT_ALL,
  DEFAULT_PROMPTS,
  PROVIDERS,
  type ProviderId,
  type PromptPreset,
  type Settings,
  type SettingsWithSecrets
} from '../shared/types'

interface StoreSchema extends Settings {
  /** safeStorage-encrypted (or base64 fallback) API keys, base64 encoded. */
  secrets: Partial<Record<ProviderId, string>>
}

const defaultModels = PROVIDERS.reduce(
  (acc, p) => {
    acc[p.id] = p.defaultModel
    return acc
  },
  {} as Record<ProviderId, string>
)

const store = new Store<StoreSchema>({
  name: 'ai-text-refiner',
  defaults: {
    provider: 'openai',
    models: defaultModels,
    prompts: DEFAULT_PROMPTS,
    activePromptId: DEFAULT_PROMPTS[0].id,
    hotkeySelected: DEFAULT_HOTKEY_SELECTED,
    hotkeySelectAll: DEFAULT_HOTKEY_SELECT_ALL,
    launchOnStartup: false,
    restoreClipboard: true,
    inlineProgress: true,
    notifyOnError: true,
    notifyOnSuccess: false,
    secrets: {}
  }
})

/** Normalize the persisted prompt presets, guaranteeing at least one valid entry. */
function readPrompts(): PromptPreset[] {
  const stored = store.get('prompts')
  if (Array.isArray(stored) && stored.length > 0) return stored
  return DEFAULT_PROMPTS
}

function encrypt(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64')
  }
  // Fallback when the OS keychain is unavailable: base64 only (not secure).
  return Buffer.from(plain, 'utf8').toString('base64')
}

function decrypt(stored: string): string {
  const buf = Buffer.from(stored, 'base64')
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buf)
    } catch {
      // Value may have been written as the base64 fallback.
      return buf.toString('utf8')
    }
  }
  return buf.toString('utf8')
}

export function getSettings(): Settings {
  const prompts = readPrompts()
  const storedActive = store.get('activePromptId')
  const activePromptId = prompts.some((p) => p.id === storedActive) ? storedActive : prompts[0].id
  return {
    provider: store.get('provider'),
    models: { ...defaultModels, ...store.get('models') },
    prompts,
    activePromptId,
    hotkeySelected: store.get('hotkeySelected'),
    hotkeySelectAll: store.get('hotkeySelectAll'),
    launchOnStartup: store.get('launchOnStartup'),
    restoreClipboard: store.get('restoreClipboard'),
    inlineProgress: store.get('inlineProgress') ?? true,
    notifyOnError: store.get('notifyOnError') ?? true,
    notifyOnSuccess: store.get('notifyOnSuccess') ?? false
  }
}

export function getSettingsWithSecrets(): SettingsWithSecrets {
  const secrets = store.get('secrets')
  const hasApiKey = PROVIDERS.reduce(
    (acc, p) => {
      acc[p.id] = Boolean(secrets[p.id])
      return acc
    },
    {} as Record<ProviderId, boolean>
  )
  return { ...getSettings(), hasApiKey }
}

/** Persist non-secret settings. Partial updates are merged. */
export function updateSettings(patch: Partial<Settings>): Settings {
  if (patch.provider !== undefined) store.set('provider', patch.provider)
  if (patch.models !== undefined) {
    store.set('models', { ...store.get('models'), ...patch.models })
  }
  if (patch.prompts !== undefined) store.set('prompts', patch.prompts)
  if (patch.activePromptId !== undefined) store.set('activePromptId', patch.activePromptId)
  if (patch.hotkeySelected !== undefined) store.set('hotkeySelected', patch.hotkeySelected)
  if (patch.hotkeySelectAll !== undefined) store.set('hotkeySelectAll', patch.hotkeySelectAll)
  if (patch.launchOnStartup !== undefined) store.set('launchOnStartup', patch.launchOnStartup)
  if (patch.restoreClipboard !== undefined) store.set('restoreClipboard', patch.restoreClipboard)
  if (patch.inlineProgress !== undefined) store.set('inlineProgress', patch.inlineProgress)
  if (patch.notifyOnError !== undefined) store.set('notifyOnError', patch.notifyOnError)
  if (patch.notifyOnSuccess !== undefined) store.set('notifyOnSuccess', patch.notifyOnSuccess)
  return getSettings()
}

export function setApiKey(provider: ProviderId, key: string): void {
  const secrets = { ...store.get('secrets') }
  const trimmed = key.trim()
  if (trimmed.length === 0) {
    delete secrets[provider]
  } else {
    secrets[provider] = encrypt(trimmed)
  }
  store.set('secrets', secrets)
}

export function getApiKey(provider: ProviderId): string | null {
  const stored = store.get('secrets')[provider]
  if (!stored) return null
  return decrypt(stored)
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}
