import 'server-only'
import { ZodError } from 'zod'

/**
 * Common Response helpers for route handlers.
 * Keeps shape consistent across all 24 ported handlers.
 */

export const ok = <T,>(body: T) => Response.json(body, { status: 200 })

export const created = <T,>(body: T) => Response.json(body, { status: 201 })

export const noContent = () => new Response(null, { status: 204 })

export const badRequest = (message: string, details?: unknown) =>
  Response.json({ error: message, details }, { status: 400 })

export const unauthorized = () =>
  Response.json({ error: 'Unauthorized' }, { status: 401 })

export const forbidden = (message = 'Forbidden') =>
  Response.json({ error: message }, { status: 403 })

export const notFound = (message = 'Not found') =>
  Response.json({ error: message }, { status: 404 })

export const conflict = (message: string) =>
  Response.json({ error: message }, { status: 409 })

export const serverError = (message = 'Internal server error') =>
  Response.json({ error: message }, { status: 500 })

/**
 * Convert a thrown error into a JSON Response. Use inside route handler
 * `catch` blocks to keep error shape consistent.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    return badRequest('Validation failed', err.flatten().fieldErrors)
  }
  if (err instanceof Response) {
    return err
  }
  console.error('[api] unhandled error:', err)
  return serverError(err instanceof Error ? err.message : 'Unknown error')
}

/** Escape user-controlled values before interpolating into HTML email bodies. */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
