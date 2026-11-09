# Next 16 — findings that diverge from training-data baseline

Captured during Task #2 of [M-Pre](../../Docs/LISTD_M-Pre_Tasks.md). Source: `node_modules/next/dist/docs/`. Re-check the bundled docs before writing each new piece of code; this file is a memo, not a substitute.

## Renames

- **`middleware.ts` → `proxy.ts`** at the project root (or under `src/`). Functionality identical; named `proxy` to discourage misuse.
- **Role:** Proxy is for header/redirect modification and *optimistic* auth checks. It is **not** a session-management or authorization solution. Real auth lives in route handlers, server actions, and a Data Access Layer.

## Cache Components (opt-in, new caching model)

Enabled with `cacheComponents: true` in `next.config.ts`. With it on:

- **`use cache` directive** at the top of an async function/component caches its return value. Cache key includes args + closed-over values.
- **`cacheLife('hours' | 'days' | …)`** and **`cacheTag('posts')`** from `next/cache` control TTL and invalidation; `updateTag('posts')` invalidates.
- **Partial Prerendering (PPR)** is the default: static shell + streamed Suspense fallbacks for uncached/runtime data.
- Components that read `cookies()`, `headers()`, `searchParams`, dynamic `params`, or do non-deterministic ops (`Math.random`, `Date.now`, `crypto.randomUUID`) **must** be wrapped in `<Suspense>` or made deterministic — otherwise dev/build errors with `Uncached data was accessed outside of <Suspense>`.
- For non-deterministic ops, call `connection()` from `next/server` first to defer to request time.
- `'use cache'` cannot live directly inside a Route Handler body — extract to a helper.
- **GET Route Handlers follow the page model** when Cache Components is on: prerendered when no uncached/runtime data is touched.

If Cache Components is **off**, follow `02-guides/caching-without-cache-components.md`: route segment config (`export const dynamic = 'force-static'` etc.), `fetch` cache options, `revalidate` exports.

**Decision pending (M-Pre task #15):** enable Cache Components for LISTD or stay on legacy. Recommendation when we get there: enable it — most LISTD pages are either fully auth-gated (uncached + Suspense) or fully public (cached), which is the model PPR is built for.

## Authentication pattern (App Router)

The doc lists Supabase as a recommended auth library — our existing Supabase Auth integration is the path of least resistance.

Required structure:

1. **Session source** — Supabase Auth cookie/JWT.
2. **Data Access Layer** at e.g. `src/lib/dal.ts`:
   ```ts
   import 'server-only'
   import { cache } from 'react'
   export const verifySession = cache(async () => { /* read cookie, verify, return { userId, role } or redirect */ })
   ```
   `cache()` memoizes per render pass — multiple components calling `verifySession()` hit the work once.
3. **Every route handler / server action / server component** that needs auth calls `verifySession()` at the top. No relying on layouts (they don't re-render on every navigation due to Partial Rendering — a security pitfall).
4. **Optional** `proxy.ts` for optimistic redirects on protected paths — read cookie only, no DB calls (Proxy runs on every prefetch).

This maps cleanly to our M-Pre tasks #7 (auth middleware = DAL + thin Proxy) and #11–13 (each ported edge function calls `verifySession()` + role check at the top, replacing the existing edge-function auth pattern).

## Route Handlers

- File: `app/.../route.ts`. Cannot coexist with `page.ts` at the same segment.
- Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`. Unsupported method → 405.
- **Not cached by default**, except `GET` if you opt in (see Cache Components section).
- **Typed params:** `RouteContext<'/users/[id]'>` is generated during `next dev`/`next build`/`next typegen`. Use it in the `ctx` parameter — no manual `{ params: { id: string } }` typing needed.
- Use `NextRequest` / `NextResponse` from `next/server` for advanced features (cookies, redirects, rewrites).

## Other items worth knowing

- **`unstable_instant`** export per route validates that `<Suspense>` boundaries are positioned for instant client navigations. The error overlay points at the offending component. Worth turning on for high-traffic pages.
- **`@next/env`** package loads `.env*` files outside the Next runtime — needed for `drizzle.config.ts` to see `DATABASE_URL`.
- **`/src` folder gotcha:** `.env*` files must live at the project root (`Listd-NEXT/.env.local`), **not** inside `src/`. Next will not load them from `src/`.
- Inline AI hints appear in the docs as MDX comments — they flag specific patterns where AI agents commonly get it wrong.

## Files we should re-read when we hit the relevant tasks

- Task #15 (caching): `02-guides/caching-without-cache-components.md` and `02-guides/cdn-caching.md`
- Task #14 (Vercel Cron): `02-guides/deploying-to-platforms.md`
- Task #9 (Tailwind v4): `02-guides/tailwind-v3-css.md` exists; check what differs for v4
- Task #11–13 port: `01-getting-started/15-route-handlers.md` + `03-api-reference/03-file-conventions/route` for `RouteContext` typing
- Task #10 (route migration): `01-getting-started/03-layouts-and-pages.md`, `04-linking-and-navigating.md`
