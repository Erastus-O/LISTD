import 'server-only'
import { eq } from 'drizzle-orm'
import { db, platformSettings, withServiceRole } from '@/db'
import { bust, getOrSet } from '@/lib/cache'
import {
  AI_TEXT_MODEL_OPTIONS,
  AI_VISION_MODEL_OPTIONS,
  DEFAULT_TEXT_MODEL,
  DEFAULT_VISION_MODEL,
} from './openrouter'

/**
 * AI settings live in the shared `platform_settings` key/value table
 * under the key below. Stored as a single JSON object so adding a future
 * toggle (e.g. an enable/disable switch or a per-agent temperature)
 * doesn't need a second row or another setting key.
 *
 * Cached for 5 minutes via the existing Upstash layer; busted on save.
 *
 * Field shape:
 *   visionModel  — image-capable model used by the condition-assist
 *                  agent and any future vision agent (room photo
 *                  summariser, document OCR…). Validated against
 *                  AI_VISION_MODEL_OPTIONS.
 *   textModel    — text-only model used by the platform assistants and
 *                  inspection executive-summary generator. Validated
 *                  against AI_TEXT_MODEL_OPTIONS.
 */

export const AI_SETTINGS_KEY = 'ai_config'
const CACHE_KEY = 'platform:ai_config'
const CACHE_TTL_SECONDS = 300

export type AiSettings = {
  visionModel: string
  textModel: string
}

const DEFAULTS: AiSettings = {
  visionModel: DEFAULT_VISION_MODEL,
  textModel: DEFAULT_TEXT_MODEL,
}

const VALID_VISION = new Set(AI_VISION_MODEL_OPTIONS.map((m) => m.id))
const VALID_TEXT = new Set(AI_TEXT_MODEL_OPTIONS.map((m) => m.id))

export async function getAiSettings(): Promise<AiSettings> {
  return getOrSet(CACHE_KEY, CACHE_TTL_SECONDS, async () => {
    try {
      const [row] = await db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(eq(platformSettings.key, AI_SETTINGS_KEY))
        .limit(1)
      if (!row?.value) return DEFAULTS
      // Accept the legacy `conditionModel` key too, so settings saved
      // by the first version of this page still migrate cleanly.
      const parsed = JSON.parse(row.value) as {
        visionModel?: string
        textModel?: string
        conditionModel?: string
      }
      const vision = parsed.visionModel ?? parsed.conditionModel
      return {
        visionModel:
          typeof vision === 'string' && VALID_VISION.has(vision)
            ? vision
            : DEFAULTS.visionModel,
        textModel:
          typeof parsed.textModel === 'string' &&
          VALID_TEXT.has(parsed.textModel)
            ? parsed.textModel
            : DEFAULTS.textModel,
      }
    } catch {
      // Malformed JSON / DB error — never let an AI-side hiccup take
      // the whole admin/inspect surface down. Fall back to defaults.
      return DEFAULTS
    }
  })
}

export async function saveAiSettings(input: AiSettings): Promise<void> {
  if (!VALID_VISION.has(input.visionModel)) {
    throw new Error(`Unknown vision model: ${input.visionModel}`)
  }
  if (!VALID_TEXT.has(input.textModel)) {
    throw new Error(`Unknown text model: ${input.textModel}`)
  }
  const value = JSON.stringify({
    visionModel: input.visionModel,
    textModel: input.textModel,
  })
  await withServiceRole(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: AI_SETTINGS_KEY, value })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value, updatedAt: new Date().toISOString() },
      })
  })
  await bust(CACHE_KEY)
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}
