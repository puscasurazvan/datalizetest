"use client"

import { TriangleAlert } from "lucide-react"
import Link from "next/link"

import { Brand } from "@/components/brand"

import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"

export interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * The refusal treatment (DESIGN.md "Refusal card, not a blank pane" and
 * "Refusal surface"): a rendering failure is stated in full, not hidden
 * behind a blank screen — a rose border, a bleeding wash blob, and the
 * warning icon the product uses for every other refusal.
 *
 * `error.message` is never rendered — it can carry server internals — only
 * `error.digest`, the opaque id Next.js attaches for cross-referencing
 * server logs, and only when Next actually set one.
 */
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-space-lg bg-canvas px-gutter-mobile py-space-3xl">
      <div className="flex w-full max-w-sm flex-col gap-space-xl">
        <div className="flex justify-center">
          <Brand />
        </div>
        <Card className="relative overflow-hidden border-refused/40 shadow-[0_4px_32px_rgba(105,0,5,0.35)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-8 -right-8 size-32 rounded-full bg-refused-wash blur-3xl"
          />
          <CardHeader className="items-center gap-space-sm border-b border-hairline py-space-lg text-center">
            <TriangleAlert strokeWidth={1.5} className="size-8 text-refused" />
            <h1 className="text-headline-md text-ink">Something went wrong</h1>
          </CardHeader>
          <CardContent className="flex flex-col gap-space-md text-center">
            <p className="text-body-sm text-ink-muted">
              We couldn&apos;t complete this request. Try again, or head back to your datasets.
            </p>
            {error.digest ? (
              <div className="rounded-xl border border-hairline bg-chrome/80 p-space-sm shadow-inner">
                <p className="font-mono text-code-sm text-ink-faint">
                  Reference for support: {error.digest}
                </p>
              </div>
            ) : null}
          </CardContent>
          <CardFooter className="flex justify-center gap-space-sm border-t border-hairline pt-space-base">
            <Button onClick={reset}>Try again</Button>
            <Link href="/datasets" className={buttonVariants({ variant: "outline" })}>
              Back to datasets
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
