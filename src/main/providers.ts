import type { PromptPreset, ProviderId, Settings } from '../shared/types'
import { DEFAULT_PROMPT } from '../shared/types'

export class RefineError extends Error {}

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini'
}

// Fixed, sensible defaults (not user-configurable).
const REQUEST_TIMEOUT_MS = 60_000
const ANTHROPIC_MAX_TOKENS = 4096

function buildPrompt(template: string, text: string): string {
  if (template.includes('{{text}}')) {
    return template.split('{{text}}').join(text)
  }
  // Fall back to appending the draft if the placeholder was removed.
  return `${template}\n\n${text}`
}

async function readError(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = await res.json()
    detail = body?.error?.message || body?.error || body?.message || JSON.stringify(body)
  } catch {
    detail = await res.text().catch(() => '')
  }
  return detail
}

/** Map an HTTP failure to a clear, user-facing RefineError. */
async function httpError(res: Response, provider: ProviderId): Promise<RefineError> {
  const label = PROVIDER_LABEL[provider]
  const detail = await readError(res)
  if (res.status === 401 || res.status === 403) {
    return new RefineError(`Invalid API key for ${label}. Check it in Settings.`)
  }
  if (res.status === 429) {
    return new RefineError(`${label} rate limited. Wait a moment and try again.`)
  }
  if (res.status === 402) {
    return new RefineError(`${label} request rejected: billing or quota issue.`)
  }
  if (res.status >= 500) {
    return new RefineError(`${label} service error (${res.status}). Try again shortly.`)
  }
  return new RefineError(`${label} request failed (${res.status})${detail ? `: ${detail}` : ''}.`)
}

/**
 * POST JSON to a provider endpoint with a hard timeout (AbortController) and
 * normalized error handling. Returns the parsed JSON body on success.
 */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  provider: ProviderId,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new RefineError(
        `${PROVIDER_LABEL[provider]} request timed out after ${Math.round(timeoutMs / 1000)}s.`
      )
    }
    throw new RefineError(
      `Network error contacting ${PROVIDER_LABEL[provider]}. Check your connection.`
    )
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw await httpError(res, provider)
  try {
    return await res.json()
  } catch {
    throw new RefineError(`${PROVIDER_LABEL[provider]} returned an unreadable response.`)
  }
}

async function refineOpenAI(prompt: string, apiKey: string, model: string): Promise<string> {
  const data = (await postJson(
    'https://api.openai.com/v1/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      messages: [{ role: 'user', content: prompt }]
    },
    'openai',
    REQUEST_TIMEOUT_MS
  )) as { choices?: { message?: { content?: string } }[] }
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string')
    throw new RefineError('OpenAI returned an unexpected response shape.')
  return text.trim()
}

async function refineAnthropic(prompt: string, apiKey: string, model: string): Promise<string> {
  // `max_tokens` is required by the Anthropic API; `temperature` is omitted as
  // newer Claude models have deprecated it.
  const data = (await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }]
    },
    'anthropic',
    REQUEST_TIMEOUT_MS
  )) as { content?: { type?: string; text?: string }[] }
  const block = Array.isArray(data?.content)
    ? data.content.find((b) => b?.type === 'text')
    : undefined
  const text = block?.text
  if (typeof text !== 'string')
    throw new RefineError('Anthropic returned an unexpected response shape.')
  return text.trim()
}

async function refineGemini(prompt: string, apiKey: string, model: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`
  const data = (await postJson(
    url,
    { 'x-goog-api-key': apiKey },
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    },
    'gemini',
    REQUEST_TIMEOUT_MS
  )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const parts = data?.candidates?.[0]?.content?.parts
  const text = Array.isArray(parts) ? parts.map((part) => part?.text || '').join('') : undefined
  if (typeof text !== 'string' || text.length === 0) {
    throw new RefineError('Gemini returned an empty or unexpected response.')
  }
  return text.trim()
}

const dispatch: Record<
  ProviderId,
  (prompt: string, apiKey: string, model: string) => Promise<string>
> = {
  openai: refineOpenAI,
  anthropic: refineAnthropic,
  gemini: refineGemini
}

/** Resolve the active prompt template, falling back sensibly. */
function activeTemplate(settings: Settings): string {
  const presets: PromptPreset[] = settings.prompts ?? []
  const active = presets.find((preset) => preset.id === settings.activePromptId)
  return active?.template || presets[0]?.template || DEFAULT_PROMPT
}

/** Refine `text` using the configured provider. Throws RefineError on failure. */
export async function refine(text: string, settings: Settings, apiKey: string): Promise<string> {
  const trimmedKey = apiKey?.trim()
  if (!trimmedKey) {
    throw new RefineError(`No API key set for ${settings.provider}. Add one in Settings.`)
  }
  const model = settings.models[settings.provider]
  if (!model) throw new RefineError(`No model configured for ${settings.provider}.`)
  const prompt = buildPrompt(activeTemplate(settings), text)
  return dispatch[settings.provider](prompt, trimmedKey, model)
}
