import 'server-only'
import { desc, eq } from 'drizzle-orm'
import {
  generatedReports,
  jobs,
  properties,
  tenantDetails,
  withServiceRole,
} from '@/db'

/**
 * Server-only data layer for the tenant portal pages (M3 #5–8 / S2 of the
 * Lovable port roadmap). Replaces the legacy Supabase RPC `tenant_portal_data`.
 *
 * Caller has already validated the inbound token via `resolveTenantToken`
 * from [./tenant-tokens.ts](./tenant-tokens.ts) — this lib trusts the
 * resolved `jobId` + `tenantDetailId` and queries within that scope only.
 */

export type TenantPortalData = {
  tenant: {
    id: string
    fullName: string | null
    email: string | null
    phone: string | null
  } | null
  job: {
    id: string
    inspectionType: string
    scheduledDate: string
    status: string
  } | null
  property: {
    addressLine1: string | null
    addressLine2: string | null
    city: string | null
    postcode: string | null
  } | null
  reports: Array<{
    id: string
    generatedAt: string | null
    reportUrl: string | null
    tenantSignature: string | null
    signedAt: string | null
  }>
}

/**
 * Load the full portal context for a resolved token. Single transaction,
 * service-role connection (we've already authenticated the inbound token,
 * RLS would unnecessarily filter our scoped lookups).
 */
export async function loadTenantPortalData(params: {
  jobId: string
  tenantDetailId?: string | null
}): Promise<TenantPortalData> {
  return withServiceRole(async (tx) => {
    // 1) Tenant. Resolve by id when we have it; otherwise pick the
    //    first tenant on the job (legacy single-tenant case).
    let tenant: TenantPortalData['tenant'] = null
    if (params.tenantDetailId) {
      const [row] = await tx
        .select({
          id: tenantDetails.id,
          fullName: tenantDetails.fullName,
          email: tenantDetails.email,
          phone: tenantDetails.phone,
        })
        .from(tenantDetails)
        .where(eq(tenantDetails.id, params.tenantDetailId))
        .limit(1)
      tenant = row ?? null
    } else {
      const [row] = await tx
        .select({
          id: tenantDetails.id,
          fullName: tenantDetails.fullName,
          email: tenantDetails.email,
          phone: tenantDetails.phone,
        })
        .from(tenantDetails)
        .where(eq(tenantDetails.jobId, params.jobId))
        .limit(1)
      tenant = row ?? null
    }

    // 2) Job + property in one join.
    const [jobRow] = await tx
      .select({
        id: jobs.id,
        inspectionType: jobs.inspectionType,
        scheduledDate: jobs.scheduledDate,
        status: jobs.status,
        addressLine1: properties.addressLine1,
        addressLine2: properties.addressLine2,
        city: properties.city,
        postcode: properties.postcode,
      })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .where(eq(jobs.id, params.jobId))
      .limit(1)

    const job = jobRow
      ? {
          id: jobRow.id,
          inspectionType: jobRow.inspectionType,
          scheduledDate: jobRow.scheduledDate,
          status: jobRow.status,
        }
      : null

    const property = jobRow
      ? {
          addressLine1: jobRow.addressLine1,
          addressLine2: jobRow.addressLine2,
          city: jobRow.city,
          postcode: jobRow.postcode,
        }
      : null

    // 3) Reports for the job.
    const reportRows = await tx
      .select({
        id: generatedReports.id,
        generatedAt: generatedReports.generatedAt,
        reportUrl: generatedReports.reportUrl,
        tenantSignature: generatedReports.tenantSignature,
        signedAt: generatedReports.signedAt,
      })
      .from(generatedReports)
      .where(eq(generatedReports.jobId, params.jobId))
      .orderBy(desc(generatedReports.generatedAt))

    return { tenant, job, property, reports: reportRows }
  })
}
