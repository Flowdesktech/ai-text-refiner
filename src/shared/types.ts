export type ProviderId = 'openai' | 'anthropic' | 'gemini'

/** Which hotkey was pressed, i.e. how to capture the draft text. */
export type CaptureMode = 'selected' | 'select-all'

/** A named, reusable instruction template. Must contain {{text}}. */
export interface PromptPreset {
  id: string
  name: string
  template: string
}

export interface Settings {
  provider: ProviderId
  /** Per-provider model names so switching providers keeps each model. */
  models: Record<ProviderId, string>
  /** User-managed prompt templates (each must contain the {{text}} placeholder). */
  prompts: PromptPreset[]
  /** Id of the prompt preset currently used for refining. */
  activePromptId: string
  /** Hotkey that refines the user's current selection. */
  hotkeySelected: string
  /** Hotkey that selects all text in the focused field, then refines it. */
  hotkeySelectAll: string
  launchOnStartup: boolean
  restoreClipboard: boolean
  /** Show an animated "Refining…" placeholder directly in the text field. */
  inlineProgress: boolean
  /** Show a native OS notification when a refine fails. */
  notifyOnError: boolean
  /** Show a native OS notification when a refine succeeds. */
  notifyOnSuccess: boolean
}

export interface SettingsWithSecrets extends Settings {
  /** Whether an API key is stored for each provider (never the key itself). */
  hasApiKey: Record<ProviderId, boolean>
}

export interface RefineResult {
  ok: boolean
  text?: string
  error?: string
}

/** Result of capturing the focused selection, including non-text detection. */
export interface CaptureResult {
  /** Plain-text content of the selection. */
  text: string
  /** HTML flavor of the selection (used to recover inline images). */
  html: string
  /** True when the selection also contains an image / non-text rich content. */
  hasImage: boolean
}

export interface PlatformInfo {
  platform: NodeJS.Platform
  /** True when running under Wayland (synthetic input is blocked). */
  isWayland: boolean
  /** macOS only: whether Accessibility/automation permission is granted. */
  accessibilityGranted: boolean
  appVersion: string
}

/** Status pushed to the overlay window during a refine run. */
export type RefineStatus =
  | { stage: 'capturing' }
  | { stage: 'refining' }
  | { stage: 'pasting' }
  | { stage: 'done' }
  | { stage: 'error'; message: string }

export const PROVIDERS: { id: ProviderId; label: string; defaultModel: string }[] = [
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-5.5' },
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-opus-4-8' },
  { id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-3.5-pro' }
]

/** Curated model choices per provider for the settings dropdown. */
export const PROVIDER_MODELS: Record<ProviderId, { id: string; label: string }[]> = {
  openai: [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.5-mini', label: 'GPT-5.5 mini' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' }
  ],
  anthropic: [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' }
  ],
  gemini: [
    { id: 'gemini-3.5-pro', label: 'Gemini 3.5 Pro' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
  ]
}

export const DEFAULT_PROMPT =
  'You are a writing assistant. Refine the following text to be clear, correct, and professional while preserving its original meaning and language. Return ONLY the refined text with no preamble or explanation.\n\n{{text}}'

/** Built-in starter presets the user can edit, rename, or remove. */
export const DEFAULT_PROMPTS: PromptPreset[] = [
  { id: 'professional', name: 'Professional', template: DEFAULT_PROMPT },
  {
    id: 'concise',
    name: 'Concise',
    template:
      'Rewrite the following text to be as clear and concise as possible without losing meaning, preserving its original language. Return ONLY the rewritten text with no preamble.\n\n{{text}}'
  },
  {
    id: 'friendly',
    name: 'Friendly',
    template:
      'Rewrite the following text in a warm, friendly, and approachable tone while keeping it correct and preserving its original language. Return ONLY the rewritten text with no preamble.\n\n{{text}}'
  }
]

export const DEFAULT_HOTKEY_SELECTED = 'CommandOrControl+Alt+R'
export const DEFAULT_HOTKEY_SELECT_ALL = 'CommandOrControl+Alt+A'

export interface HotkeyStatus {
  ok: boolean
  accelerator: string
  error?: string
}

export interface HotkeyStatuses {
  selected: HotkeyStatus
  selectAll: HotkeyStatus
}
