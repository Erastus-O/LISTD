import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Storage for adopted signature marks (0040).
 *
 * A signer adopts a mark in the browser — their typed name set in a
 * handwriting face, or drawn with a finger — and the panel hands us a PNG
 * data URL. This module is the only way that reaches storage.
 *
 * **Why the bytes come through the server.** A tenant signs holding a
 * portal token, not a Supabase session, so there is no `auth.uid()` to
 * scope a browser-direct upload against — an RLS policy permissive enough
 * to accept their write would be permissive enough to accept anyone's.
 * Routing through the service role also means the bytes are validated
 * before they land: a signature is evidence, and "whatever the client
 * POSTed" is not a standard worth applying to it.
 *
 * The mark is deliberately NOT the whole signature record. The typed name
 * and the signed-at timestamp stay in their own columns and remain the
 * identity check; this is the visual, exactly as DocuSign separates
 * "adopt a signature" from "who are you".
 */

/** How the signer produced the mark. Recorded in the object key so a
 *  dispute can tell a drawn mark from a typeset one without a schema
 *  column to carry it. */
export type SignatureMode = 'drawn' | 'styled'

/**
 * Cap on the decoded PNG. A drawn mark off a 3× retina canvas lands
 * around 30–60 KB; 2 MB is far above any legitimate signature and well
 * below anything that would trouble a serverless request body.
 */
const MAX_BYTES = 2 * 1024 * 1024

const DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/

export type StoredSignature = { url: string; bytes: number }

/**
 * Decode, validate and store a signature PNG. Returns the stored URL, or
 * throws with a message safe to surface to the signer.
 *
 * `scope` becomes the object folder — pass something that identifies the
 * thing being signed (a job id), so a signature is discoverable from the
 * record it belongs to and is swept by the same DSAR/retention logic that
 * already walks job-scoped storage.
 */
export async function storeSignatureImage(input: {
  dataUrl: string
  mode: SignatureMode
  /** Folder — use the job id so the mark sits with the job it signs. */
  scope: string
  /** Party label, part of the filename: 'tenant' | 'client' | 'clerk'. */
  party: 'tenant' | 'client' | 'clerk'
}): Promise<StoredSignature> {
  const match = DATA_URL_RE.exec(input.dataUrl.trim())
  if (!match) {
    throw new Error('Signature must be a PNG image.')
  }

  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.byteLength === 0) {
    throw new Error('Signature image was empty.')
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error('Signature image is too large.')
  }
  // Trust the magic bytes, not the data-URL prefix a client wrote.
  if (!hasPngSignature(bytes)) {
    throw new Error('Signature must be a PNG image.')
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const key = `${input.scope}/${input.party}-${input.mode}-${ts}.png`

  const { error } = await getSupabaseAdmin()
    .storage.from('signatures')
    .upload(key, bytes, { contentType: 'image/png', upsert: false })
  if (error) {
    throw new Error(`Could not store signature: ${error.message}`)
  }

  const { data } = getSupabaseAdmin()
    .storage.from('signatures')
    .getPublicUrl(key)
  // Public-FORM url against a private bucket — the same convention the
  // rest of the app stores (see `job-photos`). Readers re-sign it.
  return { url: data.publicUrl, bytes: bytes.byteLength }
}

function hasPngSignature(b: Uint8Array): boolean {
  return (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47
  )
}

/**
 * Zod-friendly guard for the optional `signatureImage` field on the sign
 * endpoints: present and plausible, or absent. Full validation (magic
 * bytes, size) happens in `storeSignatureImage` — this just keeps
 * obviously-wrong payloads out of the handler.
 */
export function looksLikePngDataUrl(value: string): boolean {
  return DATA_URL_RE.test(value.trim())
}
