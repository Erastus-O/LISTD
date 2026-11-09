import React from 'react'

/**
 * Server-rendered injection of the admin/agency-pasted marketing snippets
 * (from /admin/seo) into the PUBLIC pages.
 *
 * Why server-rendered (not a client effect): head tags must be in the HTML
 * the server sends, so they show in `view-source` and are seen by crawlers
 * that don't run JS — Google's site-verification check reads the raw HTML,
 * so a client-injected <meta> would never verify. React 19 hoists <meta>,
 * <link>, <title> and external <script> elements into <head> wherever they
 * render in the tree, which is exactly what we need.
 *
 *   slot="head"    → the snippet is parsed into real elements; meta/link and
 *                    external scripts hoist to <head>, inline scripts run in
 *                    place. All of it is in the server HTML (view-source).
 *   slot="bodyEnd" → rendered verbatim just before </body>. Scripts present
 *                    in server-delivered HTML execute on parse (unlike
 *                    runtime innerHTML), so no re-creation dance is needed.
 *
 * SECURITY: this is raw HTML from a trusted staff role ('admin'/'marketing')
 * gated at the save API, injected into public pages only. Never rendered in
 * the authenticated app.
 */
export function SiteScripts({
  html,
  slot,
}: {
  html: string
  slot: 'head' | 'bodyEnd'
}) {
  if (!html.trim()) return null

  if (slot === 'bodyEnd') {
    // Verbatim before </body>. Server-delivered <script>s execute on parse.
    return (
      <div
        style={{ display: 'contents' }}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  // Head: parse to elements so React 19 hoists meta/link/script into <head>.
  return <>{parseHeadNodes(html).map(renderNode)}</>
}

type ParsedNode = {
  tag: string
  attrs: Record<string, string | boolean>
  inner: string | null
}

/**
 * Extract the head-relevant tags (meta, link, base, title, style, script)
 * from a pasted snippet. Anything else (comments, stray text, noscript) is
 * ignored for the head slot — noscript belongs in the body slot anyway.
 */
function parseHeadNodes(html: string): ParsedNode[] {
  const nodes: ParsedNode[] = []
  // Paired tags (capture inner) OR void/self-closing tags.
  const re =
    /<(script|style|title)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(meta|link|base)\b([^>]*?)\/?>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (m[1]) {
      nodes.push({
        tag: m[1].toLowerCase(),
        attrs: parseAttrs(m[2]),
        inner: m[3] ?? '',
      })
    } else if (m[4]) {
      nodes.push({
        tag: m[4].toLowerCase(),
        attrs: parseAttrs(m[5]),
        inner: null,
      })
    }
  }
  return nodes
}

const RENAME: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  'http-equiv': 'httpEquiv',
  charset: 'charSet',
  tabindex: 'tabIndex',
  crossorigin: 'crossOrigin',
  referrerpolicy: 'referrerPolicy',
}
const BOOLEAN = new Set(['async', 'defer', 'nomodule', 'hidden'])

function parseAttrs(s: string): Record<string, string | boolean> {
  const attrs: Record<string, string | boolean> = {}
  const re =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const rawName = m[1]
    // `style` as a string crashes React SSR (it wants an object); tracking
    // tags never need it — drop it rather than risk the page.
    if (rawName.toLowerCase() === 'style') continue
    const name = RENAME[rawName.toLowerCase()] ?? rawName
    if (BOOLEAN.has(rawName.toLowerCase())) {
      attrs[name] = true
      continue
    }
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return attrs
}

function renderNode(node: ParsedNode, i: number): React.ReactNode {
  const props: Record<string, unknown> = { ...node.attrs, key: i }
  if (node.tag === 'script' || node.tag === 'style') {
    if (node.inner && node.inner.trim()) {
      props.dangerouslySetInnerHTML = { __html: node.inner }
    }
    return React.createElement(node.tag, props)
  }
  if (node.tag === 'title') {
    return React.createElement('title', props, node.inner ?? '')
  }
  // meta / link / base — void elements.
  return React.createElement(node.tag, props)
}
