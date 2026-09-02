import { toNextJsHandler } from "better-auth/next-js"

import { auth } from "@/modules/auth"

/**
 * Better Auth's own HTTP boundary (sign-up/sign-in/session/organization
 * endpoints) — a Route Handler is correct here per src/app/CLAUDE.md ("auth
 * callbacks" are one of the named exceptions to the Server Action default).
 */
export const { GET, POST } = toNextJsHandler(auth)
