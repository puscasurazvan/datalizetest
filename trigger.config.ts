import { config } from "dotenv"
import { defineConfig } from "@trigger.dev/sdk/v3"

// Same precedent as drizzle.config.ts: .env.local (falling back to .env)
// loaded explicitly, since the Trigger.dev CLI runs this file outside
// Next.js's own env loading.
config({ path: [".env.local", ".env"], quiet: true })

const projectId = process.env.TRIGGER_PROJECT_ID

if (!projectId) {
  throw new Error(
    "TRIGGER_PROJECT_ID is required to run the Trigger.dev CLI (dev/deploy). Copy .env.example to .env.local and set it, or run without Trigger.dev configured — the app itself falls back to InlineDispatcher (src/modules/jobs/index.ts) whenever TRIGGER_SECRET_KEY is unset, so this file is only read by the Trigger.dev CLI, never by the Next.js server.",
  )
}

export default defineConfig({
  project: projectId,
  // `trigger/*.ts` (repo root, sibling to `src/`) is where import.profile
  // and import.load's task definitions live (src/modules/imports/CLAUDE.md's
  // two-phase pipeline) — the CLI's own default directory-detection also
  // finds a folder literally named `trigger`, but this is explicit rather
  // than relying on that.
  dirs: ["./trigger"],
  // `import.profile` and `import.load` both rely on a real retry actually
  // happening: profile.ts's `isProfilable` and load.ts's catch both exist
  // specifically to let a transient failure (a dropped S3 body, a
  // statement-timeout) be retried rather than left permanently FAILED.
  // Trigger.dev's own default (3 attempts, exponential backoff) is a
  // reasonable baseline; pinned explicitly here rather than left implicit,
  // since the retry-driven code paths above depend on more than one
  // attempt existing at all.
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 60_000,
      factor: 2,
      randomize: true,
    },
  },
  machine: "small-1x",
  // Project-level ceiling; both tasks already set their own, tighter
  // `maxDuration` (trigger/import-profile.ts: 300s, trigger/import-load.ts:
  // 900s, the larger of the two — docs/decisions/06 #16). This is the
  // outer bound the SDK requires at the config level.
  maxDuration: 900,
})
