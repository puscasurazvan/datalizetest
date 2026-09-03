"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { importSampleAction } from "@/modules/imports/sample-action"

const SAMPLES = [
  { id: "transactions_stripe", label: "Stripe transactions" },
  { id: "customers_saaS", label: "Customers" },
  { id: "events_product", label: "Product events" },
] as const

/**
 * Runs a sample CSV through the real import pipeline and navigates to the
 * Dataset it produced. Nothing is faked: the click does upload, profile,
 * confirm and load, so a failure here is a failure of the pipeline itself.
 *
 * The import runs inside the request, so the button stays busy for as long
 * as the load takes — a second or two for the committed ~1,000-row files.
 */
export function ImportSampleButtons() {
  const router = useRouter()
  const [runningId, setRunningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(sampleId: string) {
    setError(null)
    setRunningId(sampleId)
    try {
      const { datasetId } = await importSampleAction(sampleId)
      router.push(`/datasets/${datasetId}`)
    } catch {
      setError("That sample could not be imported. Check the server log for the reason.")
      setRunningId(null)
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {error !== null ? (
        <p role="alert" className="text-[13px] text-refused">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {SAMPLES.map((sample, index) => (
          <Button
            key={sample.id}
            variant={index === 0 ? "default" : "outline"}
            disabled={runningId !== null}
            // `Button` is an unmemoized wrapper around a native <button>, so a
            // fresh closure per row defeats no memoization.
            // oxlint-disable-next-line react-perf/jsx-no-new-function-as-prop
            onClick={() => void run(sample.id)}
          >
            {runningId === sample.id ? "Importing…" : sample.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
