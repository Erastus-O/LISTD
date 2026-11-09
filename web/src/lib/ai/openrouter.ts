import 'server-only'
import { minimiseImageForAi } from '@/lib/ai/image-minimise'

/**
 * Thin client for the OpenRouter chat-completions API. OpenRouter is an
 * OpenAI-compatible gateway across many providers (Anthropic, OpenAI,
 * Google, …), so we keep a single API key in env and let admins pick the
 * model per LISTD instance.
 *
 * Vision support: the curated model list below is restricted to models
 * OpenRouter advertises as supporting image inputs in the
 * `image_url` content field. Picking a non-vision model would still
 * return a (probably hallucinated) text response; the dropdown
 * deliberately doesn't expose those.
 *
 *   Auth     `Authorization: Bearer $OPENROUTER_API_KEY`
 *   Referrer `HTTP-Referer` + `X-Title` — OpenRouter uses these for
 *            attribution / abuse handling. Defaults wire to the public
 *            site URL.
 *
 * The function is intentionally narrow: it knows how to ask "describe
 * the condition of THIS item in THIS photo" and returns plain text. If
 * we add more agents later (room narrative, action summariser, etc.)
 * each gets its own helper rather than this becoming a generic chat
 * proxy.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export type AiModelOption = { id: string; label: string; hint: string }

/** Curated list of OpenRouter models that support **image inputs**. The
 *  admin "Vision model" dropdown is sourced from this array; keep it
 *  tight so a non-vision model can never accidentally land on the
 *  condition-assist path. Costs are rough per-million-token estimates
 *  shown as a hint in the admin UI. */
export const AI_VISION_MODEL_OPTIONS: ReadonlyArray<AiModelOption> = [
  {
    id: 'anthropic/claude-3.5-sonnet',
    label: 'Claude 3.5 Sonnet (Anthropic)',
    hint: 'Best quality · ~£3 / 1M tokens',
  },
  {
    id: 'anthropic/claude-3.5-haiku',
    label: 'Claude 3.5 Haiku (Anthropic)',
    hint: 'Fast & cheap · ~£0.80 / 1M tokens',
  },
  {
    id: 'openai/gpt-4o',
    label: 'GPT-4o (OpenAI)',
    hint: 'Quality · ~£2 / 1M tokens',
  },
  {
    id: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini (OpenAI)',
    hint: 'Cheap · ~£0.12 / 1M tokens',
  },
  {
    id: 'google/gemini-flash-1.5',
    label: 'Gemini 1.5 Flash (Google)',
    hint: 'Cheap & fast · ~£0.05 / 1M tokens',
  },
  {
    id: 'google/gemini-pro-1.5',
    label: 'Gemini 1.5 Pro (Google)',
    hint: 'Quality · ~£1 / 1M tokens',
  },
]

export const DEFAULT_VISION_MODEL = 'anthropic/claude-3.5-haiku'

/** Curated list for **text-only agents** (no image input). Wider net —
 *  cheap reasoning specialists from DeepSeek + Mistral land here in
 *  addition to the multimodal models that also handle text well. No
 *  agent uses this list yet; it's the scaffold for the next agent
 *  (report summariser, QA-flag triage, etc.) so the admin can pick the
 *  text-side model from the same page rather than waiting for code. */
export const AI_TEXT_MODEL_OPTIONS: ReadonlyArray<AiModelOption> = [
  {
    id: 'anthropic/claude-3.5-sonnet',
    label: 'Claude 3.5 Sonnet (Anthropic)',
    hint: 'Best quality · ~£3 / 1M tokens',
  },
  {
    id: 'anthropic/claude-3.5-haiku',
    label: 'Claude 3.5 Haiku (Anthropic)',
    hint: 'Fast & cheap · ~£0.80 / 1M tokens',
  },
  {
    id: 'openai/gpt-4o',
    label: 'GPT-4o (OpenAI)',
    hint: 'Quality · ~£2 / 1M tokens',
  },
  {
    id: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini (OpenAI)',
    hint: 'Cheap · ~£0.12 / 1M tokens',
  },
  {
    id: 'google/gemini-flash-1.5',
    label: 'Gemini 1.5 Flash (Google)',
    hint: 'Cheap & fast · ~£0.05 / 1M tokens',
  },
  {
    id: 'mistralai/mistral-large',
    label: 'Mistral Large (Mistral)',
    hint: 'Strong reasoning · ~£2 / 1M tokens',
  },
  {
    id: 'deepseek/deepseek-chat',
    label: 'DeepSeek Chat (DeepSeek)',
    hint: 'Very cheap reasoning · ~£0.10 / 1M tokens',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    label: 'Llama 3.3 70B Instruct (Meta)',
    hint: 'Open-weights · ~£0.20 / 1M tokens',
  },
]

export const DEFAULT_TEXT_MODEL = 'anthropic/claude-3.5-haiku'

/** Maximum length of each AI-generated field. Caps both the model's
 *  max_tokens and a post-trim safety check so a runaway response can't
 *  blow past the form field's 2000-char limit. */
const MAX_FIELD_CHARS = 600

export type ItemAssist = { description: string; condition: string }

/** Which field(s) the clerk asked the AI to draft. Condition is opt-in so the
 *  clerk only spends tokens on it for the cases that actually warrant a note. */
export type AssistField = 'description' | 'condition' | 'both'

const DESC_PART = `"description" : a concise, factual description of WHAT the item is: type, colour, material, and any defining detail (brand, size, pattern, number of seats, etc.) that's visible. One short sentence.`
const COND_PART = `"condition" : a concise condition note: observable wear, damage, marks, cleanliness, missing parts : anything a landlord or tenant would care about at check-in or check-out. One short paragraph, under 400 characters.`
const RULES = `Be professional and factual, in British English. Do NOT hallucinate details the image doesn't support; if the image is unclear or shows the wrong item, say so briefly.`

function buildSystemPrompt(field: AssistField): string {
  const intro = `You are an assistant for UK inventory clerks. The clerk uploads a photo of an item during a property inspection and asks you to help write the report entry for it. Look carefully at the image.`
  let want: string
  let shape: string
  if (field === 'description') {
    want = `Produce ONE field:\n${DESC_PART}`
    shape = `{"description": "..."}`
  } else if (field === 'condition') {
    want = `Produce ONE field:\n${COND_PART}`
    shape = `{"condition": "..."}`
  } else {
    want = `Produce TWO fields:\n1. ${DESC_PART}\n2. ${COND_PART}`
    shape = `{"description": "...", "condition": "..."}`
  }
  return `${intro}\n\n${want}\n\n${RULES}\n\nRespond with ONLY a JSON object, no markdown fences, in exactly this shape:\n${shape}`
}

/**
 * Ask the configured OpenRouter vision model to draft an item description
 * and/or condition note from a photo. `field` selects which to produce —
 * defaulting to 'both' — so a clerk who only needs the description doesn't
 * spend tokens generating a condition note. Returns the trimmed fields (the
 * unrequested one empty), or throws on transport / provider errors. If the
 * model returns unparseable JSON, the whole reply becomes the requested
 * single field (or the condition for 'both').
 */
export async function generateItemAssist(input: {
  model: string
  imageUrl: string
  itemName: string
  currentDescription?: string | null
  field?: AssistField
}): Promise<ItemAssist> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set on the server')
  }
  const field = input.field ?? 'both'
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd-pro.vercel.app'

  const ask =
    field === 'description'
      ? 'Draft the description'
      : field === 'condition'
        ? 'Draft the condition note'
        : 'Draft the description and condition'
  const userText = [
    `Item: ${input.itemName}.`,
    input.currentDescription
      ? `Clerk's existing description (for context, may be empty): ${input.currentDescription}`
      : null,
    `${ask} based on the attached photo. Return the JSON object only.`,
  ]
    .filter(Boolean)
    .join(' ')

  // Data-minimise the image before it leaves for the AI provider: strip
  // EXIF/GPS, downscale, and inline the bytes (so the provider never fetches
  // our storage). Best-effort — fall back to the signed URL on failure.
  let imageContent = input.imageUrl
  try {
    imageContent = await minimiseImageForAi(input.imageUrl)
  } catch (err) {
    console.warn('[ai] image minimise failed; sending original URL:', err)
  }

  const body = {
    model: input.model,
    // Single-field asks are much shorter — cap tighter to save tokens.
    max_tokens: field === 'both' ? 600 : 300,
    temperature: 0.3,
    // Provider routing. Some upstream providers serve a NON-vision
    // variant of a model under the same OpenRouter slug (e.g. Amazon
    // Bedrock's claude-3-5-haiku rejects image_url with "does not support
    // image input"). We *prefer* the first-party providers that reliably
    // accept images via `order`, but keep `allow_fallbacks: true` and do
    // NOT hard-ignore anything — hard-ignoring can leave zero providers
    // ("All providers have been ignored") when an account's OpenRouter
    // privacy settings already restrict the provider pool. If the only
    // provider an account allows for the chosen model can't do vision,
    // that's an account-config issue (pick another model on /admin/ai or
    // widen the providers at openrouter.ai/settings/privacy).
    provider: {
      order: ['Anthropic', 'OpenAI', 'Google AI Studio', 'Google Vertex'],
      allow_fallbacks: true,
      // GDPR: only route to providers that do NOT collect/train on prompt
      // data. Inspection images can contain personal data, so we never let
      // them land on a provider that retains them. (Also set account-level
      // "no logging/training" at openrouter.ai/settings/privacy.)
      data_collection: 'deny',
    },
    messages: [
      { role: 'system', content: buildSystemPrompt(field) },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: imageContent } },
        ],
      },
    ],
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter attribution / abuse-handling headers.
      'HTTP-Referer': siteUrl,
      'X-Title': 'LISTD Pro',
    },
    body: JSON.stringify(body),
    // Vision models can be slow; give them up to 50 s, but the function
    // route's maxDuration is the real ceiling.
    signal: AbortSignal.timeout(50_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `OpenRouter ${res.status}: ${text.slice(0, 300) || res.statusText}`
    )
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = (json.choices?.[0]?.message?.content ?? '').trim()
  return parseItemAssist(raw)
}

/**
 * Parse the model's reply into `{ description, condition }`. Tolerates
 * markdown ```json fences and trailing prose; falls back to treating the
 * whole reply as the condition note when no JSON object is found.
 */
export type AssistantMessage = { role: 'user' | 'assistant'; content: string }

/**
 * Text-only chat completion for the in-app support assistant (the help
 * chatbot available to client / clerk / cleaner / tenant). Takes a
 * role-tailored system prompt + the running conversation and returns the
 * assistant's plain-text reply. Throws on transport / provider errors.
 */
export async function generateAssistantReply(input: {
  model: string
  systemPrompt: string
  messages: AssistantMessage[]
}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set on the server')
  }
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd-pro.vercel.app'

  const body = {
    model: input.model,
    max_tokens: 600,
    temperature: 0.4,
    // GDPR: restrict to providers that don't retain/train on prompt data —
    // chat prompts can carry personal data too.
    provider: { allow_fallbacks: true, data_collection: 'deny' },
    messages: [
      { role: 'system', content: input.systemPrompt },
      ...input.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': siteUrl,
      'X-Title': 'LISTD Pro',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `OpenRouter ${res.status}: ${text.slice(0, 300) || res.statusText}`
    )
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return (json.choices?.[0]?.message?.content ?? '').trim()
}

function parseItemAssist(raw: string): ItemAssist {
  const cap = (s: unknown): string =>
    typeof s === 'string' ? s.trim().slice(0, MAX_FIELD_CHARS) : ''
  // Pull the first {...} block out of the reply (handles ```json fences).
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as {
        description?: unknown
        condition?: unknown
      }
      const description = cap(obj.description)
      const condition = cap(obj.condition)
      if (description || condition) return { description, condition }
    } catch {
      /* fall through to plain-text fallback */
    }
  }
  return { description: '', condition: cap(raw) }
}
