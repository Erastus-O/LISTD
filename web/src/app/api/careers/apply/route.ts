import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { created, errorResponse } from '@/lib/api'
import {
  jobApplications,
  notifications,
  userRoles,
  withServiceRole,
} from '@/db'
import { findOpenVacancy } from '@/lib/careers'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { FROM_TRANSACTIONAL, getResend, logEmail } from '@/lib/resend'
import { logApp } from '@/lib/logging/logger'

export const runtime = 'nodejs'
export const maxDuration = 30

const CV_BUCKET = 'job-applications'
const CV_MAX_BYTES = 5 * 1024 * 1024
const CV_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const FieldsSchema = z.object({
  vacancy: z.string().trim().min(1).max(80),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(50).optional(),
  linkedinUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .refine((v) => !v || /^https:\/\//i.test(v), {
      message: 'LinkedIn URL must start with https://',
    }),
  coverNote: z.string().trim().max(4000).optional(),
  /** Honeypot — real users never fill it; bots do. */
  website: z.string().max(0).optional(),
})

/**
 * POST /api/careers/apply — PUBLIC application intake for the LISTD-hosted
 * careers flow. Applicants arrive from the vacancy page (often via the
 * external-apply link the admin pasted into Indeed/LinkedIn), so there is
 * deliberately NO auth here. Multipart body: the fields above + a `cv` file
 * (PDF/DOC/DOCX, ≤5 MB, required).
 *
 * CV goes to the private `job-applications` bucket via the service role;
 * the row lands in job_applications; every admin gets an in-app + email
 * heads-up. A honeypot field drops naive bots silently.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => null)
    if (!form) {
      return Response.json({ error: 'Invalid form submission' }, { status: 400 })
    }

    const fields = FieldsSchema.parse({
      vacancy: form.get('vacancy') ?? '',
      fullName: form.get('fullName') ?? '',
      email: form.get('email') ?? '',
      phone: form.get('phone') ?? undefined,
      linkedinUrl: form.get('linkedinUrl') ?? undefined,
      coverNote: form.get('coverNote') ?? undefined,
      website: form.get('website') ?? undefined,
    })

    // Honeypot tripped: pretend success, store nothing.
    if (form.get('website')) {
      return created({ received: true })
    }

    const vacancy = await findOpenVacancy(fields.vacancy)
    if (!vacancy) {
      return Response.json(
        { error: 'This role is no longer open for applications.' },
        { status: 404 }
      )
    }

    // CV — required, sane type + size.
    const cv = form.get('cv')
    if (!(cv instanceof File) || cv.size === 0) {
      return Response.json({ error: 'Please attach your CV.' }, { status: 400 })
    }
    if (cv.size > CV_MAX_BYTES) {
      return Response.json(
        { error: 'CV must be 5 MB or smaller.' },
        { status: 400 }
      )
    }
    const ext = (cv.name.split('.').pop() ?? '').toLowerCase()
    if (!CV_TYPES[ext]) {
      return Response.json(
        { error: 'CV must be a PDF or Word document (.pdf, .doc, .docx).' },
        { status: 400 }
      )
    }

    const safeName = cv.name.replace(/[^\w.-]+/g, '_').slice(-80)
    const cvPath = `${vacancy.id}/${crypto.randomUUID()}-${safeName}`
    const admin = getSupabaseAdmin()
    const upload = await admin.storage
      .from(CV_BUCKET)
      .upload(cvPath, Buffer.from(await cv.arrayBuffer()), {
        contentType: CV_TYPES[ext],
        upsert: false,
      })
    if (upload.error) {
      console.error('[careers/apply] CV upload failed:', upload.error)
      return Response.json(
        { error: 'Could not upload your CV. Please try again.' },
        { status: 500 }
      )
    }

    const [row] = await withServiceRole((tx) =>
      tx
        .insert(jobApplications)
        .values({
          vacancyId: vacancy.id,
          vacancyTitle: vacancy.title,
          fullName: fields.fullName,
          email: fields.email,
          phone: fields.phone || null,
          linkedinUrl: fields.linkedinUrl || null,
          coverNote: fields.coverNote || null,
          cvPath,
        })
        .returning({ id: jobApplications.id })
    )

    await logApp(
      'careers.application',
      'Job application received',
      { applicationId: row.id, vacancyId: vacancy.id, vacancyTitle: vacancy.title },
      { route: '/api/careers/apply' }
    )

    // Heads-up to every admin — in-app + email, best-effort.
    try {
      const adminIds = await withServiceRole((tx) =>
        tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.role, 'admin'))
      )
      if (adminIds.length > 0) {
        await withServiceRole((tx) =>
          tx.insert(notifications).values(
            adminIds.map(({ userId }) => ({
              userId,
              type: 'system',
              title: 'New job application',
              message: `${fields.fullName} applied for ${vacancy.title}.`,
              link: '/admin/careers',
            }))
          )
        )
        const recipients: string[] = []
        for (const { userId } of adminIds) {
          const u = await admin.auth.admin.getUserById(userId)
          if (u.data?.user?.email) recipients.push(u.data.user.email)
        }
        if (recipients.length > 0) {
          const subject = `New application: ${vacancy.title} — ${fields.fullName}`
          await getResend().emails.send({
            from: FROM_TRANSACTIONAL,
            to: recipients,
            subject,
            html: `<p><strong>${escapeText(fields.fullName)}</strong> (${escapeText(fields.email)}) applied for <strong>${escapeText(vacancy.title)}</strong>.</p><p>Review the application and CV in the admin panel → Careers.</p>`,
          })
          await logEmail({
            functionName: 'careers-application-received',
            recipientEmails: recipients,
            subject,
            resendId: null,
            errorMessage: null,
            metadata: { applicationId: row.id },
          })
        }
      }
    } catch (err) {
      console.warn('[careers/apply] admin notify failed:', err)
    }

    return created({ received: true })
  } catch (err) {
    console.error('[careers/apply] error:', err)
    return errorResponse(err)
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
