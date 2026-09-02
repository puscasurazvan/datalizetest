import type { Metadata } from "next"
import { Familjen_Grotesk, Newsreader, Sometype_Mono } from "next/font/google"
import "./globals.css"

/**
 * All three faces are TABULAR BY DEFAULT — every digit shares one advance with no
 * font-feature-settings applied. That is deliberate: a number column cannot start
 * shimmering because someone forgot `tabular-nums`, including inside a chart
 * library that renders into its own SVG. Prose opts OUT with `proportional-nums`.
 */
const sans = Familjen_Grotesk({
  variable: "--font-familjen-grotesk",
  subsets: ["latin"],
})

// Display only — headings, KPI figures, the wordmark. Not preloaded: it appears on
// a handful of elements, and the optical-size axis is deliberately not requested
// because it more than doubles the file for a face this rarely used.
const display = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "600"],
  preload: false,
})

// Column IDs, error codes, raw values. Dotted zero and no ligatures in the served
// file, so `->` in a value can never merge into one glyph.
const mono = Sometype_Mono({
  variable: "--font-sometype-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  preload: false,
})

export const metadata: Metadata = {
  title: {
    default: "Datalize",
    template: "%s · Datalize",
  },
  description:
    "Datalize is a multi-tenant analytics workspace for exploring and reporting on your data.",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
