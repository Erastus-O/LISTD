import { z } from 'zod'
import { eq } from 'drizzle-orm'
import {
  badRequest,
  errorResponse,
  forbidden,
  ok,
  serverError,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { db, jobs } from '@/db'
import { generateItemAssist } from '@/lib/ai/openrouter'
import { getAiSettings } from '@/lib/ai/settings'
import {
  isJobPhotoUrl,
  parseSupabaseStorageUrl,
  signStoredAssetUrl,
} from '@/lib/storage/download'

export const runtime = 'nodejs'
/** Vision models can take 10-30 s on a cold call. Give the route plenty
 *  of headroom; OpenRouter client itself bails at 50 s. */
export const maxDuration = 60

const Schema = z
  .object({
    jobId: z.string().uuid(),
    itemName: z.string().trim().min(1).max(120),
    photoUrl: z.string().url().max(2000),
    currentDescription: z.string().trim().max(2000).nullable().optional(),
    /** Which field the clerk asked for. Condition is opt-in so it isn't
     *  generated (and billed) on every assist. */
    field: z.enum(['description', 'condition', 'both']).optional(),
  })
  .strict()

/**
 * POST /api/clerk/ai/item-condition — the "Condition assist" agent.
 *
 * The clerk taps the ✨ AI assist button on an inspection item; the
 * client sends the item name, the URL of the first photo the clerk
 * uploaded, and the optional existing description for context. We:
 *
 *   1. Re-sign the photo URL — the `generated-reports` bucket is
 *      private, so the publicUrl the form holds is unfetchable; the
 *      LLM provider would 401. A 5-minute signed URL is plenty for
 *      OpenRouter to pull and pass through.
 *   2. Verify the photo path's `jobId` segment matches a job the
 *      caller is authorised on. Stops a leaked job UUID from being
 *      used to OCR another tenant's photos via this endpoint.
 *   3. Call the admin-selected OpenRouter model and return the text.
 *
 * The clerk decides whether to keep, edit, or discard the result —
 * the agent never writes the field directly.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('clerk', 'trades', 'admin')
  if (session instanceof Response) return session

  try {
    const body = Schema.parse(await req.json())

    // 1. The URL must point at our bucket and the job folder must match
    // the jobId in the body — a clerk asking the AI about an arbitrary
    // job's photo would be a privacy leak.
    const parsed = parseSupabaseStorageUrl(body.photoUrl)
    if (!parsed || parsed.bucket !== 'generated-reports') {
      return badRequest('Photo URL is not on the inspection bucket.')
    }
    if (!isJobPhotoUrl(body.photoUrl, body.jobId)) {
      return badRequest('Photo URL does not belong to this job.')
    }

    // 2. Authorisation: caller must be the assigned clerk or an admin.
    const [job] = await db
      .select({ id: jobs.id, clerkId: jobs.clerkId })
      .from(jobs)
      .where(eq(jobs.id, body.jobId))
      .limit(1)
    if (!job) return badRequest('Job not found.')
    const isAdmin = session.roles.includes('admin')
    if (!isAdmin && job.clerkId !== session.userId) {
      return forbidden('Not assigned to this job.')
    }

    // 3. Sign the photo URL for the LLM provider — 5-minute TTL is
    // plenty for OpenRouter to fetch and pass to the upstream model.
    const signed = await signStoredAssetUrl(body.photoUrl, 300)
    if (!signed) {
      return serverError('Could not sign photo URL for AI agent.')
    }

    // 4. Call the configured vision model. `getAiSettings` is cached.
    const { visionModel } = await getAiSettings()
    const assist = await generateItemAssist({
      model: visionModel,
      imageUrl: signed,
      itemName: body.itemName,
      currentDescription: body.currentDescription ?? null,
      field: body.field ?? 'both',
    })

    if (!assist.condition && !assist.description) {
      return serverError('AI returned an empty response. Please try again.')
    }

    return ok({
      description: assist.description,
      condition: assist.condition,
      model: visionModel,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return badRequest('Invalid request', err.flatten().fieldErrors)
    }
    console.error('[clerk/ai/item-condition] error:', err)
    return errorResponse(err)
  }
}
