/**
 * One-click sign-in as a seeded local user, for development only.
 *
 * This is deliberately NOT an authentication bypass. It establishes a
 * session the only way anything in this codebase can — Better Auth's own
 * `signInEmail`, with a real password, for a real user row that gets a
 * personal Organization from the same `user.create.after` hook every other
 * signup goes through. Nothing here mints a session, and nothing in
 * `createRequestContext` or the tenant path can tell that the user arrived
 * this way. A flag that skipped authentication would put a branch in the
 * request path that must never exist; this puts none.
 *
 * Two gates, and the outer one is the real one: `env.ts` refuses to parse
 * at all when `DEV_SIGN_IN` is set with `NODE_ENV=production`, so a
 * production deployment cannot boot with this reachable — the check below
 * is the second line, not the first. When it is off, the route answers 404
 * rather than 403: a disabled route should not confirm it exists.
 *
 * A Route Handler rather than a Server Action because signing in needs a
 * real HTTP response to carry `set-cookie`, which a Server Component render
 * cannot do — the same reason the auth callbacks in `api/auth` are Route
 * Handlers (src/app/CLAUDE.md, "Route Handlers elsewhere").
 */
import { NextResponse } from "next/server"

import { auth } from "@/modules/auth"
import { devSignInEnabled, env } from "@/shared/env"

const DEV_USER = {
  email: "demo@datalize.test",
  password: "datalize-demo-1234",
  name: "Demo Analyst",
} as const

export async function GET(): Promise<Response> {
  if (!devSignInEnabled()) {
    return new NextResponse(null, { status: 404 })
  }

  // Idempotent: the first call creates the user (and, through the signup
  // hook, their personal workspace); every later call falls through to the
  // sign-in below. A failure here is not fatal — an existing user is the
  // expected steady state, and a real problem surfaces from signInEmail.
  try {
    await auth.api.signUpEmail({ body: DEV_USER })
  } catch {
    // Already exists.
  }

  const { headers, response } = await auth.api.signInEmail({
    body: { email: DEV_USER.email, password: DEV_USER.password },
    returnHeaders: true,
  })

  if (!response) {
    return NextResponse.json({ error: "Development sign-in failed." }, { status: 500 })
  }

  const redirect = NextResponse.redirect(new URL("/datasets", env().BETTER_AUTH_URL))
  const sessionCookie = headers.get("set-cookie")
  if (sessionCookie !== null) {
    redirect.headers.set("set-cookie", sessionCookie)
  }
  return redirect
}
