"use client"

export interface GlobalErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

/*
 * Replaces the root layout when the root layout itself throws, so it must
 * supply its own `<html>`/`<body>` and cannot rely on anything the root
 * layout would otherwise provide — including `globals.css`, which may not
 * have loaded. That is why this is the one file in the app where a raw hex
 * colour is correct rather than a token: the token custom properties live
 * in `globals.css`, and this page has to render a readable page without it.
 *
 * The styles are module constants rather than inline literals so each render
 * passes the same object — the same reason the rest of the app hoists array
 * and object props.
 */
const PAGE = {
  margin: 0,
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "4rem 1rem",
  background: "#131315",
  color: "#e5e1e4",
  fontFamily: "system-ui, sans-serif",
} as const

const PLATE = { width: "100%", maxWidth: "24rem", textAlign: "center" } as const
const TITLE = { fontSize: "1.125rem", fontWeight: 600, margin: "0 0 0.75rem" } as const
const BODY = { fontSize: "0.875rem", color: "#bcc9cd", margin: "0 0 1rem" } as const
const DIGEST = {
  fontFamily: "monospace",
  fontSize: "11px",
  color: "#869397",
  margin: "0 0 1.5rem",
} as const
const ACTIONS = { display: "flex", justifyContent: "center", gap: "0.75rem" } as const
const CONTROL = {
  borderRadius: "0.5rem",
  padding: "0.5rem 1rem",
  fontSize: "0.875rem",
  fontWeight: 500,
} as const
const RETRY = {
  ...CONTROL,
  background: "#06b6d4",
  color: "#003640",
  border: "none",
  cursor: "pointer",
} as const
const BACK = {
  ...CONTROL,
  background: "transparent",
  color: "#e5e1e4",
  border: "1px solid #3d494c",
  textDecoration: "none",
} as const

/**
 * Same rule as `error.tsx`: `error.message` can carry server internals, so
 * only `error.digest` (Next's opaque cross-reference id) is ever shown, and
 * only when Next actually set one.
 */
export default function GlobalError({ error, reset }: GlobalErrorPageProps) {
  return (
    <html lang="en" className="dark">
      <body style={PAGE}>
        <div style={PLATE}>
          <h1 style={TITLE}>Something went wrong</h1>
          <p style={BODY}>Datalize couldn&apos;t load. Try again, or reload the page.</p>
          {error.digest ? <p style={DIGEST}>Reference for support: {error.digest}</p> : null}
          <div style={ACTIONS}>
            <button type="button" onClick={reset} style={RETRY}>
              Try again
            </button>
            {/*
              A plain anchor, not `next/link`: this component replaces the
              root layout because the root layout itself threw, so the
              Next.js router this app relies on cannot be assumed to still
              be intact.
            */}
            {/* oxlint-disable-next-line next/no-html-link-for-pages */}
            <a href="/datasets" style={BACK}>
              Back to datasets
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
