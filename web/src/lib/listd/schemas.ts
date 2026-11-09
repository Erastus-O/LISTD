import { z } from 'zod'

export const QuoteLineSchema = z.object({
  d: z.string().trim().min(1).max(300),
  q: z.number().positive().max(1000),
  u: z.number().int().min(-10_000_000).max(10_000_000),
  tag: z.enum(['svc', 'urgency', 'materials', 'credit', 'portfolio']).default('svc'),
})

export const ProRoleSchema = z.enum(['CLERK', 'CLEANER', 'TRADES'])
