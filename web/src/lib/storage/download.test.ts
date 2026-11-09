import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: vi.fn() }))

import { isJobPhotoUrl } from './download'

const JOB = '11111111-1111-1111-1111-111111111111'
const base = 'https://x.supabase.co/storage/v1/object/public'

describe('isJobPhotoUrl', () => {
  it('accepts a photo in this job folder', () => {
    expect(isJobPhotoUrl(`${base}/generated-reports/${JOB}/inspection-photos/a.jpg`, JOB)).toBe(true)
  })
  it('rejects another job, another bucket and non-storage addresses', () => {
    expect(isJobPhotoUrl(`${base}/generated-reports/22222222/a.jpg`, JOB)).toBe(false)
    expect(isJobPhotoUrl(`${base}/clerk-documents/${JOB}/dbs.pdf`, JOB)).toBe(false)
    expect(isJobPhotoUrl('http://169.254.169.254/latest/meta-data', JOB)).toBe(false)
  })
  it('rejects climbing out of the job folder', () => {
    expect(isJobPhotoUrl(`${base}/generated-reports/${JOB}/..%2F22222222%2Fa.jpg`, JOB)).toBe(false)
  })
  it('rejects the folder itself', () => {
    expect(isJobPhotoUrl(`${base}/generated-reports/${JOB}`, JOB)).toBe(false)
  })
})
