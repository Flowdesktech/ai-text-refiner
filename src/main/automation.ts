import { clipboard, systemPreferences } from 'electron'
import { keyboard, Key } from '@nut-tree-fork/nut-js'
import type { CaptureResult } from '../shared/types'

// Keep synthetic keystrokes snappy; the default nut-js delay is quite slow.
keyboard.config.autoDelayMs = 4

const isMac = process.platform === 'darwin'
const PRIMARY_MODIFIER = isMac ? Key.LeftCmd : Key.LeftControl

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Modifier keys that the user may still be physically holding from the hotkey.
const MODIFIER_KEYS: Key[] = [
  Key.LeftControl,
  Key.RightControl,
  Key.LeftShift,
  Key.RightShift,
  Key.LeftAlt,
  Key.RightAlt,
  Key.LeftSuper,
  Key.RightSuper,
  Key.LeftCmd,
  Key.LeftWin
]

/**
 * Release any modifier keys we might be holding. When the global hotkey fires,
 * the user is still pressing its modifiers (e.g. Ctrl+Shift), which would
 * otherwise corrupt the synthetic Ctrl+C / Ctrl+V into Ctrl+Shift+C / +V.
 */
async function releaseHeldModifiers(): Promise<void> {
  for (const key of MODIFIER_KEYS) {
    try {
      await keyboard.releaseKey(key)
    } catch {
      // Some keys may not exist on every platform/layout; ignore.
    }
  }
}

/** True when running on Linux under a Wayland session (synthetic input blocked). */
export function isWayland(): boolean {
  if (process.platform !== 'linux') return false
  const sessionType = (process.env.XDG_SESSION_TYPE || '').toLowerCase()
  return sessionType === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY)
}

/**
 * macOS only: whether the app is a trusted Accessibility client (required for
 * synthetic keystrokes). On other platforms this is always true.
 * @param prompt When true (macOS), opens the system prompt to grant access.
 */
export function isAccessibilityGranted(prompt = false): boolean {
  if (!isMac) return true
  try {
    return systemPreferences.isTrustedAccessibilityClient(prompt)
  } catch {
    return true
  }
}

async function pressCombo(...keys: Key[]): Promise<void> {
  await keyboard.pressKey(...keys)
  await keyboard.releaseKey(...keys)
}

export interface ClipboardSnapshot {
  text: string
  html: string
}

export function snapshotClipboard(): ClipboardSnapshot {
  return { text: clipboard.readText(), html: clipboard.readHTML() }
}

export function restoreClipboard(snap: ClipboardSnapshot): void {
  if (snap.html) {
    clipboard.write({ text: snap.text, html: snap.html })
  } else {
    clipboard.writeText(snap.text)
  }
}

/**
 * Detect whether the clipboard currently holds image / non-text rich content.
 *
 * Two signals are checked:
 *  - a real bitmap on the clipboard (`readImage`), e.g. a pasted screenshot;
 *  - an `<img` tag inside the HTML flavor, which is how contenteditable editors
 *    (Slack, Gmail) represent inline images when text is copied alongside them.
 *
 * We deliberately do NOT treat plain rich-text formatting (bold, links, etc.)
 * as "non-text": replacing styled text with refined plain text is expected.
 */
export function clipboardHasImage(): boolean {
  try {
    if (!clipboard.readImage().isEmpty()) return true
  } catch {
    // readImage can throw on some platforms; fall through to the HTML check.
  }
  const html = clipboard.readHTML()
  return /<img[\s>]/i.test(html)
}

/**
 * Simulate the copy of currently selected text (or select-all then copy),
 * then read the captured text from the clipboard.
 *
 * Returns both the plain text and whether the selection also contained an
 * image. Callers use `hasImage` to avoid destructive whole-field replacement
 * that would otherwise drop inline images (see runRefine).
 */
export async function captureSelection(selectAll: boolean): Promise<CaptureResult> {
  // Clear so we can detect whether anything was actually copied. Clearing both
  // flavors prevents a stale image from a previous copy looking like part of
  // this selection.
  clipboard.clear()

  // Let the user lift the hotkey, then force-release any still-held modifiers
  // so the synthetic copy isn't combined with them.
  await sleep(160)
  await releaseHeldModifiers()
  await sleep(40)

  if (selectAll) {
    await pressCombo(PRIMARY_MODIFIER, Key.A)
    await sleep(60)
  }
  await pressCombo(PRIMARY_MODIFIER, Key.C)

  // Give the source app time to populate the clipboard.
  await sleep(140)
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    hasImage: clipboardHasImage()
  }
}

/**
 * Read the bitmap currently on the clipboard, or null if there isn't one.
 * Call this right after `captureSelection` (before any text is written to the
 * clipboard) to grab an inline image so it can be re-inserted after refining.
 */
export function readClipboardImage(): Electron.NativeImage | null {
  try {
    const img = clipboard.readImage()
    return img.isEmpty() ? null : img
  } catch {
    return null
  }
}

/** Escape a plain-text string for safe embedding in an HTML fragment. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n|\r|\n/g, '<br>')
}

/** Pull the `<img …>` tags out of a clipboard HTML fragment (in order). */
export function extractImageTags(html: string): string {
  const matches = html.match(/<img\b[^>]*>/gi)
  return matches ? matches.join('') : ''
}

/**
 * Remove the plain-text placeholders that apps inject where an inline image
 * sits (e.g. the U+FFFC object-replacement char, or the image's `alt` text such
 * as "image"). Without this they leak into the text sent to the LLM and end up
 * rendered as stray text above the re-inserted image.
 */
export function stripImagePlaceholders(text: string, html: string): string {
  let out = text.replace(/[\uFFFC\u200B]/g, '')
  const altRe = /<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
  let match: RegExpExecArray | null
  while ((match = altRe.exec(html))) {
    const alt = (match[1] ?? match[2] ?? '').trim()
    if (alt) out = out.split(alt).join('')
  }
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Build an HTML fragment that places the refined text first, then re-inserts
 * the original inline image(s). Pasting HTML lets the target editor restore the
 * *actual* image (data-URI or remote `src`) instead of a flattened bitmap.
 */
export function buildRefinedHtml(refined: string, imageTags: string): string {
  const body = escapeHtml(refined)
  return imageTags ? `<div>${body}</div>${imageTags}` : `<div>${body}</div>`
}

/** Write text to the clipboard and simulate paste in the focused field. */
export async function pasteText(text: string): Promise<void> {
  clipboard.writeText(text)
  await releaseHeldModifiers()
  await sleep(50)
  await pressCombo(PRIMARY_MODIFIER, Key.V)
  await sleep(90)
}

/**
 * Write rich content (refined text + recovered image) and paste it, replacing
 * the current selection in one shot. The bitmap is included as a fallback for
 * editors that ignore the HTML flavor.
 */
export async function pasteRich(
  text: string,
  html: string,
  image?: Electron.NativeImage | null
): Promise<void> {
  const data: Electron.Data = { text, html }
  if (image && !image.isEmpty()) data.image = image
  clipboard.write(data)
  await releaseHeldModifiers()
  await sleep(60)
  await pressCombo(PRIMARY_MODIFIER, Key.V)
  await sleep(140)
}

/** Select the previous `count` characters (Shift+Left ×count) without releasing. */
async function selectPrevious(count: number): Promise<void> {
  if (count <= 0) return
  await keyboard.pressKey(Key.LeftShift)
  for (let i = 0; i < count; i++) {
    await keyboard.pressKey(Key.Left)
    await keyboard.releaseKey(Key.Left)
  }
  await keyboard.releaseKey(Key.LeftShift)
  await sleep(20)
}

/**
 * Select the previous `count` characters (Shift+Left ×count) and replace them
 * with `text`. Used to animate / finalize an in-field placeholder.
 */
export async function replacePrevious(count: number, text: string): Promise<void> {
  await selectPrevious(count)
  clipboard.writeText(text)
  await sleep(20)
  await pressCombo(PRIMARY_MODIFIER, Key.V)
  await sleep(40)
}

/**
 * Like {@link replacePrevious} but pastes rich content, so the finalized result
 * keeps the inline image that the plain-text placeholder temporarily replaced.
 */
export async function replacePreviousRich(
  count: number,
  text: string,
  html: string,
  image?: Electron.NativeImage | null
): Promise<void> {
  await selectPrevious(count)
  const data: Electron.Data = { text, html }
  if (image && !image.isEmpty()) data.image = image
  clipboard.write(data)
  await sleep(20)
  await pressCombo(PRIMARY_MODIFIER, Key.V)
  await sleep(60)
}
