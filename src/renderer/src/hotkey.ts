// Converts a browser KeyboardEvent into an Electron accelerator string.
// Returns null while only modifier keys are held (no main key yet).

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Enter: 'Return',
  '+': 'Plus'
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'ContextMenu'])

export function eventToAccelerator(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  let key = e.key
  if (KEY_ALIASES[key]) {
    key = KEY_ALIASES[key]
  } else if (key.length === 1) {
    key = key.toUpperCase()
  } else if (/^F\d{1,2}$/.test(key)) {
    // function keys already in correct form
  } else {
    // e.g. "Tab", "Home", "PageUp" — Electron accepts most of these as-is.
  }

  parts.push(key)

  // Require at least one modifier so the hotkey is safe as a global shortcut.
  if (parts.length < 2) return null
  return parts.join('+')
}

export function prettyAccelerator(accel: string, isMac: boolean): string {
  return accel
    .split('+')
    .map((p) => {
      if (p === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl'
      if (p === 'Alt') return isMac ? '⌥' : 'Alt'
      if (p === 'Shift') return isMac ? '⇧' : 'Shift'
      return p
    })
    .join(isMac ? '' : ' + ')
}
