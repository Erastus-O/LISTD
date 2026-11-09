import { getTableColumns, getTableName, is, sql } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as schema from './schema'

const tables = (Object.values(schema) as unknown[]).filter((v) => is(v, PgTable)) as PgTable[]

describe('database matches schema.ts', () => {
  it('has every table and column the code expects', async () => {
    const rows = (await db.execute(sql`
      select table_name, column_name from information_schema.columns where table_schema = 'public'
    `)) as unknown as { table_name: string; column_name: string }[]
    const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`))
    const missing: string[] = []
    for (const table of tables) {
      for (const column of Object.values(getTableColumns(table))) {
        const key = `${getTableName(table)}.${column.name}`
        if (!have.has(key)) missing.push(key)
      }
    }
    expect(tables.length).toBeGreaterThan(30)
    expect(missing).toEqual([])
  })
})
