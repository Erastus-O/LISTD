# Signature fonts

Three handwriting faces backing the **Style** tab of the adopt-signature
panel (`src/components/signature/adopt-signature.tsx`) — the signer's typed
name rendered as a mark, DocuSign's "select a style" flow.

| File | Family | Source | Licence |
|---|---|---|---|
| `signature-caveat.woff2` | Caveat 600 | [Google Fonts](https://fonts.google.com/specimen/Caveat) | SIL Open Font License 1.1 |
| `signature-dancing.woff2` | Dancing Script 600 | [Google Fonts](https://fonts.google.com/specimen/Dancing+Script) | SIL Open Font License 1.1 |
| `signature-sacramento.woff2` | Sacramento 400 | [Google Fonts](https://fonts.google.com/specimen/Sacramento) | SIL Open Font License 1.1 |

The OFL permits redistribution and embedding, including in a commercial
product, provided the fonts aren't sold on their own — self-hosting here is
squarely within it.

**Latin subset only.** Each file is the `latin` slice Google serves (the
last `@font-face` block in its CSS response), which is why they're ~25–50 KB
rather than a few hundred. A signer whose name needs Cyrillic or Greek
glyphs will see the fallback face in the Style tab; the **Draw** tab is
always available and has no such limit.

**Self-hosted deliberately.** Pulling these from `fonts.gstatic.com` at
render time would leak every signer's visit to a third party at the exact
moment they sign a legal document, and would put the signature panel at the
mercy of a CDN. They're declared in `globals.css` with `font-display: swap`
and are only ever requested when the panel actually renders.

To refresh, take the last `.woff2` URL from:

```
curl -A "<a browser UA>" "https://fonts.googleapis.com/css2?family=Caveat:wght@600&display=swap"
```
