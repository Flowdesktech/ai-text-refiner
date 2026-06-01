import { useCallback, useEffect, useState } from 'react'
import {
  PROVIDERS,
  PROVIDER_MODELS,
  type HotkeyStatuses,
  type PlatformInfo,
  type PromptPreset,
  type ProviderId,
  type Settings,
  type SettingsWithSecrets
} from '../../shared/types'
import { eventToAccelerator, prettyAccelerator } from './hotkey'

const CUSTOM_MODEL = '__custom__'

type HotkeyField = 'selected' | 'selectAll'

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<SettingsWithSecrets | null>(null)
  const [platform, setPlatform] = useState<PlatformInfo | null>(null)
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hotkeyStatuses, setHotkeyStatuses] = useState<HotkeyStatuses | null>(null)
  const [capturingField, setCapturingField] = useState<HotkeyField | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const [sampleText, setSampleText] = useState(
    'i think we should definately move foward with the plan, lmk what u think'
  )
  const [testOutput, setTestOutput] = useState('')
  const [testError, setTestError] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void (async () => {
      const [s, p, enc, hk] = await Promise.all([
        window.refiner.getSettings(),
        window.refiner.getPlatformInfo(),
        window.refiner.isEncryptionAvailable(),
        window.refiner.getHotkeyStatus()
      ])
      setSettings(s)
      setPlatform(p)
      setEncryptionAvailable(enc)
      setHotkeyStatuses(hk)
    })()
  }, [])

  const flashSaved = useCallback(() => {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1200)
  }, [])

  const patch = useCallback(
    async (p: Partial<Settings>) => {
      const res = await window.refiner.updateSettings(p)
      setSettings(res.settings)
      if (res.hotkeyStatuses) setHotkeyStatuses(res.hotkeyStatuses)
      flashSaved()
    },
    [flashSaved]
  )

  const isMac = platform?.platform === 'darwin'

  if (!settings) {
    return <div className="loading">Loading…</div>
  }

  const provider = settings.provider
  const model = settings.models[provider]
  const modelOptions = PROVIDER_MODELS[provider]
  const isCustomModel = !modelOptions.some((m) => m.id === model)

  const setModel = (value: string): void => {
    setSettings({ ...settings, models: { ...settings.models, [provider]: value } })
  }
  const saveModel = (value: string): void => {
    void patch({ models: { [provider]: value } as Settings['models'] })
  }

  const onCaptureHotkey = (e: React.KeyboardEvent<HTMLButtonElement>, field: HotkeyField): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setCapturingField(null)
      e.currentTarget.blur()
      return
    }
    const accel = eventToAccelerator(e)
    if (accel) {
      setCapturingField(null)
      e.currentTarget.blur()
      void patch(field === 'selected' ? { hotkeySelected: accel } : { hotkeySelectAll: accel })
    }
  }

  const saveApiKey = async (): Promise<void> => {
    const next = await window.refiner.setApiKey(provider, apiKeyInput)
    setSettings(next)
    setApiKeyInput('')
    flashSaved()
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestError('')
    setTestOutput('')
    const res = await window.refiner.testRefine(sampleText)
    if (res.ok) setTestOutput(res.text ?? '')
    else setTestError(res.error ?? 'Unknown error')
    setTesting(false)
  }

  const activePrompt =
    settings.prompts.find((p) => p.id === settings.activePromptId) ?? settings.prompts[0]
  const promptHasPlaceholder = activePrompt.template.includes('{{text}}')

  // Update the active preset locally; callers persist on blur via savePrompts.
  const editActivePrompt = (changes: Partial<PromptPreset>): void => {
    const prompts = settings.prompts.map((p) =>
      p.id === activePrompt.id ? { ...p, ...changes } : p
    )
    setSettings({ ...settings, prompts })
  }
  const savePrompts = (prompts: PromptPreset[], activePromptId?: string): void => {
    void patch(activePromptId ? { prompts, activePromptId } : { prompts })
  }
  const addPreset = (): void => {
    const id = `preset-${Date.now()}`
    const preset: PromptPreset = {
      id,
      name: 'New preset',
      template: 'Refine the following text.\n\n{{text}}'
    }
    savePrompts([...settings.prompts, preset], id)
  }
  const deletePreset = (): void => {
    if (settings.prompts.length <= 1) return
    const prompts = settings.prompts.filter((p) => p.id !== activePrompt.id)
    savePrompts(prompts, prompts[0].id)
  }

  const brokenHotkeys = hotkeyStatuses
    ? [
        !hotkeyStatuses.selected.ok
          ? { label: 'Refine selection', s: hotkeyStatuses.selected }
          : null,
        !hotkeyStatuses.selectAll.ok
          ? { label: 'Refine entire field', s: hotkeyStatuses.selectAll }
          : null
      ].filter(Boolean as unknown as <T>(v: T | null) => v is T)
    : []

  const renderHotkeyField = (
    field: HotkeyField,
    title: string,
    hint: string,
    value: string
  ): React.JSX.Element => {
    const status = hotkeyStatuses?.[field]
    const capturing = capturingField === field
    return (
      <label className="field">
        <span className="field-label">{title}</span>
        <button
          className={`hotkey-input ${capturing ? 'capturing' : ''}`}
          onFocus={() => setCapturingField(field)}
          onBlur={() => setCapturingField((f) => (f === field ? null : f))}
          onKeyDown={(e) => onCaptureHotkey(e, field)}
        >
          {capturing ? 'Press a key combination…' : prettyAccelerator(value, !!isMac)}
        </button>
        {status && !status.ok ? (
          <span className="hint warn">{status.error}</span>
        ) : (
          <span className="hint" style={{ color: 'var(--ok)' }}>
            Active
          </span>
        )}
        <span className="hint">{hint}</span>
      </label>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-badge">R</div>
          <div>
            <h1>AI Text Refiner</h1>
            <p className="muted">Draft anywhere → hotkey → refined in place</p>
          </div>
        </div>
        <span className={`save-flash ${savedFlash ? 'visible' : ''}`}>Saved</span>
      </header>

      {platform?.isWayland && (
        <div className="banner banner-warn">
          <strong>Wayland detected.</strong> Synthetic keystrokes are blocked on Wayland. The hotkey
          flow won't paste automatically — use the Test panel below, or switch to an X11 session.
        </div>
      )}
      {isMac && !platform?.accessibilityGranted && (
        <div className="banner banner-warn">
          <strong>Accessibility permission needed.</strong> macOS requires it to simulate
          copy/paste.
          <button className="link-btn" onClick={() => window.refiner.openAccessibilitySettings()}>
            Open System Settings
          </button>
        </div>
      )}
      {brokenHotkeys.length > 0 && (
        <div className="banner banner-error">
          <strong>{brokenHotkeys.length === 2 ? 'Hotkeys' : 'A hotkey'} not active.</strong>{' '}
          {brokenHotkeys.map((b) => `${b.label}: ${b.s.error}`).join(' ')} Pick a different
          combination below (each must be unique and include a modifier).
        </div>
      )}
      {!encryptionAvailable && (
        <div className="banner banner-warn">
          OS secure storage is unavailable, so API keys are only base64-encoded on disk (not
          encrypted). Configure an OS keychain for at-rest encryption.
        </div>
      )}

      <section className="card">
        <h2>Provider</h2>
        <div className="field-row">
          {PROVIDERS.map((p) => (
            <label key={p.id} className={`pill ${provider === p.id ? 'active' : ''}`}>
              <input
                type="radio"
                name="provider"
                checked={provider === p.id}
                onChange={() => void patch({ provider: p.id as ProviderId })}
              />
              {p.label}
              {settings.hasApiKey[p.id] && <span className="dot" title="API key saved" />}
            </label>
          ))}
        </div>

        <label className="field">
          <span className="field-label">Model</span>
          <select
            className="select"
            value={isCustomModel ? CUSTOM_MODEL : model}
            onChange={(e) => {
              const v = e.target.value
              if (v === CUSTOM_MODEL) {
                // Start a custom entry; keep current value if already custom.
                if (!isCustomModel) setModel('')
              } else {
                setModel(v)
                saveModel(v)
              }
            }}
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.id})
              </option>
            ))}
            <option value={CUSTOM_MODEL}>Custom…</option>
          </select>
          {isCustomModel && (
            <input
              type="text"
              value={model}
              placeholder={PROVIDERS.find((p) => p.id === provider)?.defaultModel}
              autoFocus
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => saveModel(model)}
            />
          )}
        </label>

        <label className="field">
          <span className="field-label">
            API key
            {settings.hasApiKey[provider] && <span className="badge ok">stored</span>}
          </span>
          <div className="key-row">
            <input
              type="password"
              value={apiKeyInput}
              placeholder={settings.hasApiKey[provider] ? '•••••••••• (saved)' : 'Paste API key'}
              onChange={(e) => setApiKeyInput(e.target.value)}
              autoComplete="off"
            />
            <button
              className="btn"
              disabled={!apiKeyInput.trim()}
              onClick={() => void saveApiKey()}
            >
              Save key
            </button>
            {settings.hasApiKey[provider] && (
              <button
                className="btn ghost"
                onClick={() => void saveApiKey()}
                title="Clear stored key"
              >
                Clear
              </button>
            )}
          </div>
          <span className="hint">Stored encrypted at rest via your OS keychain.</span>
        </label>
      </section>

      <section className="card">
        <h2>Prompt presets</h2>
        <p className="muted small">
          Create reusable instruction templates and pick the active one. Each must contain{' '}
          <code>{'{{text}}'}</code> where the captured draft is inserted.
        </p>
        <div className="field-row preset-bar">
          <select
            className="select"
            value={activePrompt.id}
            onChange={(e) => void patch({ activePromptId: e.target.value })}
          >
            {settings.prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || 'Untitled'}
              </option>
            ))}
          </select>
          <button className="btn" onClick={addPreset}>
            Add
          </button>
          <button
            className="btn ghost"
            onClick={deletePreset}
            disabled={settings.prompts.length <= 1}
            title={settings.prompts.length <= 1 ? 'Keep at least one preset' : 'Delete this preset'}
          >
            Delete
          </button>
        </div>
        <label className="field">
          <span className="field-label">Preset name</span>
          <input
            type="text"
            value={activePrompt.name}
            placeholder="e.g. Professional"
            onChange={(e) => editActivePrompt({ name: e.target.value })}
            onBlur={() => savePrompts(settings.prompts)}
          />
        </label>
        <label className="field">
          <span className="field-label">Template</span>
          <textarea
            className="prompt"
            rows={6}
            value={activePrompt.template}
            onChange={(e) => editActivePrompt({ template: e.target.value })}
            onBlur={() => savePrompts(settings.prompts)}
          />
        </label>
        {!promptHasPlaceholder && (
          <span className="hint warn">
            Tip: include <code>{'{{text}}'}</code> where the captured draft should be inserted.
          </span>
        )}
      </section>

      <section className="card">
        <h2>Global hotkeys</h2>
        <p className="muted small">
          Click a field and press a key combination (must include a modifier; each must be unique).
        </p>
        {renderHotkeyField(
          'selected',
          'Refine selected text',
          'Copies your current selection, then refines it.',
          settings.hotkeySelected
        )}
        {renderHotkeyField(
          'selectAll',
          'Refine entire field',
          'Sends Ctrl/⌘+A to select all in the focused field, then refines it.',
          settings.hotkeySelectAll
        )}
      </section>

      <section className="card">
        <h2>Behavior</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.inlineProgress}
            onChange={(e) => void patch({ inlineProgress: e.target.checked })}
          />
          Show animated “Refining…” progress in the text field
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.restoreClipboard}
            onChange={(e) => void patch({ restoreClipboard: e.target.checked })}
          />
          Restore my original clipboard after refining
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.launchOnStartup}
            onChange={(e) => void patch({ launchOnStartup: e.target.checked })}
            disabled={platform?.platform === 'linux'}
          />
          Launch on system startup
          {platform?.platform === 'linux' && (
            <span className="hint inline">(not supported on Linux)</span>
          )}
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.notifyOnError}
            onChange={(e) => void patch({ notifyOnError: e.target.checked })}
          />
          Show a desktop notification when a refine fails
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.notifyOnSuccess}
            onChange={(e) => void patch({ notifyOnSuccess: e.target.checked })}
          />
          Show a desktop notification when a refine succeeds
        </label>
      </section>

      <section className="card">
        <h2>Test refine</h2>
        <p className="muted small">
          Runs your provider + prompt on the sample below — no keystroke simulation needed.
        </p>
        <textarea
          className="prompt"
          rows={3}
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
        />
        <div className="field-row">
          <button className="btn primary" disabled={testing} onClick={() => void runTest()}>
            {testing ? 'Refining…' : 'Run test'}
          </button>
          <button className="btn ghost" onClick={() => void window.refiner.runRefine(false)}>
            Flow: selection
          </button>
          <button className="btn ghost" onClick={() => void window.refiner.runRefine(true)}>
            Flow: whole field
          </button>
        </div>
        {testError && <div className="banner banner-error">{testError}</div>}
        {testOutput && (
          <div className="result">
            <span className="field-label">Result</span>
            <p>{testOutput}</p>
          </div>
        )}
      </section>

      <footer className="app-footer muted small">
        AI Text Refiner v{platform?.appVersion} · Runs in your system tray · Settings save
        automatically · Right-click the tray icon to quit
      </footer>
    </div>
  )
}
