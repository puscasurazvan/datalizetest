import { notFound } from "next/navigation"

import {
  ImportSheet,
  RefusalsSheet,
  ResultSheet,
  RevisionSheet,
} from "@/components/drawing/fixture-sheets"
import { env } from "@/shared/env"

/**
 * The design reference: every sheet rendered against the seeded fixture, so
 * a change to a token or a primitive can be seen rather than imagined.
 *
 * Development only. It ships no real data and sits outside the `(app)` route
 * group's auth, so it must not exist in production — `notFound()` removes it
 * rather than redirecting, which would advertise that the route is there.
 */
export default function DesignPage() {
  if (env().NODE_ENV === "production") {
    notFound()
  }

  return (
    <main className="mx-auto max-w-[1120px] px-5 pb-24">
      <header className="border-b border-hairline py-14">
        <h1 className="font-display max-w-[18ch] text-[clamp(34px,6vw,60px)] leading-[1.03] tracking-[-0.02em]">
          Datalize reads as a drawing.
        </h1>
        <p className="mt-5 max-w-[62ch] text-[15px] text-muted-foreground">
          An analyst has to defend the number they send their CFO. A technical drawing exists for
          the same reason: every dimension carries its revision, its tolerance, and the initials of
          whoever checked it. Figures below are real aggregates of the 1,000-row seeded fixture.
        </p>
      </header>

      <div className="flex flex-col gap-10 pt-10">
        <ImportSheet />
        <ResultSheet />
        <RevisionSheet />
        <RefusalsSheet />
      </div>
    </main>
  )
}
