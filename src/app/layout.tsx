import type { Metadata } from "next"
import { Geist, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { cn } from "@/lib/utils"

/**
 * Both faces are TABULAR BY DEFAULT — every digit shares one advance with no
 * font-feature-settings applied. That is deliberate: a number column cannot start
 * shimmering because someone forgot `tabular-nums`, including inside a chart
 * library that renders into its own SVG. Prose opts OUT with `proportional-nums`.
 */
const sans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
})

// Column IDs, error codes, checksums, raw values. Legitimate here as data and
// measurement — a figure a reader has to check reads in the face built to be
// checked, where 0, O and o cannot be confused.
const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "Datalize",
    template: "%s · Datalize",
  },
  description:
    "Datalize is a multi-tenant analytics workspace for exploring and reporting on your data.",
}

/**
 * `dark` is not a toggle. The world has one surface (DESIGN.md); the class is
 * here so shadcn's `dark:` utilities resolve against it rather than never
 * firing.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn("dark", "h-full", "antialiased", sans.variable, mono.variable, "font-sans")}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
