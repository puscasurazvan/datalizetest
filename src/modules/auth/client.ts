"use client"

import { organizationClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

/**
 * Browser-side Better Auth client. This is the ONLY auth import a Client
 * Component may use — `@/modules/auth` (the server instance in `./auth.ts`)
 * pulls in `@/db/client` and, transitively, `pg`, which cannot ship to the
 * browser. `baseURL` is omitted deliberately: the client talks to the
 * same-origin `/api/auth/*` route handler (src/app/api/auth/[...all]), so
 * there is nothing here for `env()` (server-only) to supply.
 *
 * The `organization` plugin must be registered on both sides to match
 * `src/modules/auth/auth.ts` — omitting it here would make `authClient`
 * lack `.organization.*` and the `useListOrganizations` /
 * `useActiveOrganization` hooks the app shell depends on.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient()],
})

export type AuthClient = typeof authClient
