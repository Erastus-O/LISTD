import { z } from 'zod'
import { badRequest, errorResponse, ok, serverError } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { generateAssistantReply } from '@/lib/ai/openrouter'
import { getAiSettings, isAiConfigured } from '@/lib/ai/settings'
import {
  assistantRoleFor,
  buildAssistantSystemPrompt,
} from '@/lib/ai/assistant-prompt'

export const runtime = 'nodejs'
export const maxDuration = 60

const Schema = z
  .object({
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
 * POST /api/assistant/chat — the in-app support assistant (help chatbot).
 *
 * Available to any authenticated, non-admin user (client / clerk / cleaner /
 * tenant). The system prompt is tailored to the caller's role, derived
 * server-side from the session — the client never dictates its own role.
 * Stateless: the widget sends the running conversation each turn.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  // Admins use the admin tooling, not the help bot.
  const nonAdminRoles = session.roles.filter((r) => r !== 'admin')
  if (nonAdminRoles.length === 0) {
    return badRequest('The assistant is for client, clerk, cleaner and tenant accounts.')
  }

  if (!isAiConfigured()) {
    return serverError('The assistant is not configured on this server yet.')
  }

  try {
    const { messages } = Schema.parse(await req.json())
    const role = assistantRoleFor(nonAdminRoles)
    const systemPrompt = buildAssistantSystemPrompt(role)
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
    console.error('[assistant/chat] error:', err)
    return errorResponse(err)
  }
}
