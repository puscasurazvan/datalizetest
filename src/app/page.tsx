import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/modules/auth"

/**
 * `/` is a pure redirect gate, outside both the `(auth)` and `(app)` route
 * groups — those groups own their own auth requirements, this page only
 * decides which one a visitor lands in.
 */
export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() })

  redirect(session ? "/datasets" : "/sign-in")
}
