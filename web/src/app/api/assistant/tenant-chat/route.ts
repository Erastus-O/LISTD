import { z } from 'zod'
import { badRequest, errorResponse, forbidden, ok, serverError } from '@/lib/api'
import { rateLimit } from '@/lib/rate-limit'
import { resolveTenantToken } from '@/lib/tenant-tokens'
import { callerIp } from '@/lib/audit'
import { generateAssistantReply } from '@/lib/ai/openrouter'
import { getAiSettings, isAiConfigured } from '@/lib/ai/settings'
import { buildAssistantSystemPrompt } from '@/lib/ai/assistant-prompt'

export const runtime = 'nodejs'
export const maxDuration = 60

const Schema = z
  .object({
    token: z.string().min(1).max(400),
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().trim().min(1).max(2000),
        })
      )
      .min(1)
      .max(20),
  })
  .strict()

/**
 * POST /api/assistant/tenant-chat — the support assistant for the token-based
 * TENANT portal (which has no Supabase session). Authenticated by the same
 * `?token=` credential the portal pages use: we re-validate it per request via
 * {@link resolveTenantToken} and rate-limit per IP. Uses the tenant persona.
 */
export async function POST(req: Request) {
  const ip = callerIp(req)

  const limit = await rateLimit({
    scope: 'tenant-assistant',
    identifier: ip ?? 'anon',
    limit: 15,
    windowSeconds: 60,
  })
  if (!limit.allowed) {
    return badRequest('Too many messages : please wait a moment and try again.')
  }

  if (!isAiConfigured()) {
    return serverError('The assistant is not configured on this server yet.')
  }

  try {
    const { token, messages } = Schema.parse(await req.json())

    // Any valid (non-revoked, in-scope) tenant token is enough to chat.
    const verdict = await resolveTenantToken(token, undefined, req, 'assistant_chat')
    if (!verdict.ok) {
      return forbidden('Your access link is invalid or has expired.')
    }

    const systemPrompt = buildAssistantSystemPrompt('tenant')
    const { textModel } = await getAiSettings()
    const reply = await generateAssistantReply({
      model: textModel,
      systemPrompt,
      messages,
    })
    if (!reply) {
      return serverError('The assistant had nothing to say : please try again.')
    }
    return ok({ reply })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return badRequest('Invalid request', err.flatten().fieldErrors)
    }
    console.error('[assistant/tenant-chat] error:', err)
    return errorResponse(err)
  }
}
