import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  badRequest,
  errorResponse,
  escapeHtml,
  forbidden,
  ok,
  serverError,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  organisationMembers,
  profiles,
  userRoles,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { FROM_TRANSACTIONAL, getResend, logEmail } from '@/lib/resend'

export const maxDuration = 30
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    email: z.string().trim().email().max(254),
    fullName: z.string().trim().min(1).max(120),
  })
  .strict()

/**
 * POST /api/client/workers/invite — owner invites a staff member ("worker")
 * into their organisation.
 *
 * Flow:
 *   1. Caller must be an org owner (org_role='owner') — confirmed against
 *      `organisation_members` for the caller's user_id.
 *   2. Generate a random temp password and create the auth user via
 *      `supabase.auth.admin.createUser({ email, password, email_confirm }`.
 *   3. Upsert the `profiles` row (the `on_auth_user_created` trigger already
 *      created it from user_metadata) with `password_must_change=true` so
 *      first login forces a reset.
 *   4. Insert `organisation_members` with `org_role='worker'` and the
 *      owner's organisation_id — done *before* step 5 so the
 *      `auto_create_organisation` trigger sees an active membership and
 *      skips minting a stray personal org.
 *   5. Insert `user_roles` with role='client' (same Supabase role as the
 *      owner — workers are clients with a different `org_role`).
 *   6. Email the temp password via Resend (template id
 *      `send-worker-credentials`).
 *   7. Write `account_status/worker.invited` audit row carrying the
 *      invitee id + org + invited_by. **The temp password is NEVER stored
 *      in the audit payload.**
 *
 * Errors: 403 if caller isn't an owner; 400 if the email is already in
 * use; 500 on Supabase create / email failure.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)
    const supabaseAdmin = getSupabaseAdmin()

    // 1. Resolve caller's organisation + verify they're an owner.
    const ownership = await withServiceRole(async (tx) => {
      const [row] = await tx
        .select({
          organisationId: organisationMembers.organisationId,
          orgRole: organisationMembers.orgRole,
        })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.userId, session.userId),
            eq(organisationMembers.status, 'active')
          )
        )
        .limit(1)
      return row ?? null
    })
    const isAdmin = session.roles.includes('admin')
    if (!ownership && !isAdmin) {
      return forbidden('You must belong to an organisation to invite workers.')
    }
    if (ownership && ownership.orgRole !== 'owner' && !isAdmin) {
      return forbidden('Only the org owner can invite workers.')
    }
    if (!ownership) {
      return badRequest('No organisation found for this caller.')
    }

    // 2. Create the auth user with a generated temp password. Supabase
    //    rejects duplicate emails; surface that as a 400 with a friendly
    //    message rather than a 500.
    const tempPassword = generateTempPassword()
    const created = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: body.fullName, invited_as: 'worker' },
    })
    if (created.error || !created.data.user) {
      const message = created.error?.message ?? 'Could not create user'
      if (
        /already.*registered|exists|duplicate/i.test(message ?? '')
      ) {
        return badRequest('A user with that email already exists.')
      }
      return serverError(`User creation failed: ${message}`)
    }
    const workerUserId = created.data.user.id

    // 3–5. Persist the worker's domain rows in one tx so partial creation
    //      can't strand an auth user without a profile/membership.
    await withServiceRole(async (tx) => {
      // The `on_auth_user_created` trigger (handle_new_user) already inserted
      // a profiles row (user_id + full_name from user_metadata) the instant
      // createUser ran. Upsert rather than insert — a blind insert collides
      // with the profiles_user_id_key unique constraint (this is the 500
      // owners hit when inviting a worker). The conflict path fills in the
      // worker-specific flags the trigger doesn't set.
      await tx
        .insert(profiles)
        .values({
          userId: workerUserId,
          fullName: body.fullName,
          passwordMustChange: true,
          onboardingCompleted: true,
          accountStatus: 'active',
        })
        .onConflictDoUpdate({
          target: profiles.userId,
          set: {
            fullName: body.fullName,
            passwordMustChange: true,
            onboardingCompleted: true,
            accountStatus: 'active',
          },
        })
      // Seed the org membership BEFORE the user_roles row. The
      // `on_client_role_created` trigger (auto_create_organisation) fires on
      // user_roles insert and spins up a personal org for any client without
      // an active membership. Inserting the worker's membership first makes
      // that guard short-circuit, so the worker joins the inviter's org
      // instead of also getting a stray org they'd own.
      await tx.insert(organisationMembers).values({
        organisationId: ownership.organisationId,
        userId: workerUserId,
        orgRole: 'worker',
        status: 'active',
        invitedAt: new Date().toISOString(),
        invitedEmail: body.email,
      })
      await tx
        .insert(userRoles)
        .values({
          userId: workerUserId,
          role: 'client',
        })
        .onConflictDoNothing()
      await logAuditEvent(tx, {
        category: 'account_status',
        action: 'worker.invited',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: workerUserId,
        payload: {
          organisationId: ownership.organisationId,
          fullName: body.fullName,
          // email noted at the boundary of the audit log; temp password is
          // explicitly NOT included.
          emailHint: maskEmail(body.email),
        },
        ipAddress: ip,
        userAgent: ua,
      })
    })

    // 6. Send the credentials email. The worker is already created and
    //    committed above, so an email hiccup must NOT fail the whole invite —
    //    doing so would strand the worker AND keep the owner's modal open on
    //    an error. Report delivery status instead; the owner can re-send the
    //    credentials from the team page ("Resend invite") if it didn't land.
    let emailDelivered = true
    try {
      await sendCredentialsEmail({
        email: body.email,
        fullName: body.fullName,
        tempPassword,
        invitedBy: session.userId,
      })
    } catch (err) {
      emailDelivered = false
      console.error('[client/workers/invite] credentials email failed:', err)
    }

    return ok({ success: true, workerUserId, emailDelivered })
  } catch (err) {
    console.error('[client/workers/invite] error:', err)
    return errorResponse(err)
  }
}

/**
 * Cryptographically random 16-character temp password. Contains at least
 * one uppercase, one lowercase, one digit, and one symbol to satisfy any
 * reasonable downstream policy. Never persisted.
 */
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%^&*'
  const all = upper + lower + digits + symbols
  const required = [
    pickFrom(upper),
    pickFrom(lower),
    pickFrom(digits),
    pickFrom(symbols),
  ]
  const rest = Array.from({ length: 12 }, () => pickFrom(all))
  return shuffle([...required, ...rest]).join('')
}

function pickFrom(charset: string): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return charset[buf[0]! % charset.length]!
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const j = buf[0]! % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const visible = local.length <= 2 ? local[0]! : `${local[0]}${local[1]}`
  return `${visible}***@${domain}`
}

async function sendCredentialsEmail(params: {
  email: string
  fullName: string
  tempPassword: string
  invitedBy: string
}): Promise<void> {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'
  const loginUrl = `${origin}/auth?next=${encodeURIComponent('/worker/dashboard')}`
  const safeName = escapeHtml(params.fullName)
  const safeEmail = escapeHtml(params.email)
  const safePassword = escapeHtml(params.tempPassword)
  const safeUrl = escapeHtml(loginUrl)
  const subject = 'Your LISTD Pro worker account'
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
      <h1 style="color:#1a1a1a;font-size:24px;margin-bottom:16px;">Welcome to LISTD Pro, ${safeName}</h1>
      <p style="color:#555;font-size:16px;line-height:1.5;">An account has been created for you so you can post inspection jobs on behalf of your organisation.</p>
      <div style="margin:24px 0;padding:16px;border:1px solid #e5e5e5;border-radius:8px;background:#fafafa;">
        <p style="color:#1a1a1a;font-size:14px;margin:0 0 6px;"><strong>Email:</strong> ${safeEmail}</p>
        <p style="color:#1a1a1a;font-size:14px;margin:0;"><strong>Temporary password:</strong> <code style="font-family:Menlo,monospace;background:#fff;padding:2px 6px;border-radius:4px;border:1px solid #e5e5e5;">${safePassword}</code></p>
      </div>
      <p style="color:#555;font-size:14px;line-height:1.5;">For your security you'll be asked to set a new password the first time you log in.</p>
      <div style="margin:32px 0;">
        <a href="${safeUrl}" style="background-color:#22c55e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Log in</a>
      </div>
      <p style="color:#999;font-size:12px;">If you weren't expecting this email, ignore it and let your team know.</p>
    </div>
  `.trim()

  const { data, error } = await getResend().emails.send({
    from: FROM_TRANSACTIONAL,
    to: [params.email],
    subject,
    html,
  })

  await logEmail({
    functionName: 'send-worker-credentials',
    recipientEmails: [params.email],
    subject,
    resendId: data?.id ?? null,
    errorMessage: error ? error.message : null,
    metadata: { invitedBy: params.invitedBy },
  })
  if (error) throw new Error(`Email delivery failed: ${error.message}`)
}
