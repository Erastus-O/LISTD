/**
 * Stub for the `server-only` guard package under Vitest.
 *
 * `server-only` throws on import outside a React Server Component, which
 * is exactly its job in the app and exactly wrong in a unit test: it puts
 * every server module — the PDF renderer, the pricing matrix, the
 * schedulers — out of reach of tests. Aliased in `vitest.config.ts`.
 */
export {}
