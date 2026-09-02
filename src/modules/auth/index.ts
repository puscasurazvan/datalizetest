/**
 * Public surface of src/modules/auth. Other modules import the Better Auth
 * instance and its inferred types from here, never from ./auth directly.
 */
import type { auth as authInstance } from "./auth"

export { auth } from "./auth"

export type Session = typeof authInstance.$Infer.Session
export type ActiveOrganization = typeof authInstance.$Infer.ActiveOrganization
export type Organization = typeof authInstance.$Infer.Organization
export type Member = typeof authInstance.$Infer.Member
export type Invitation = typeof authInstance.$Infer.Invitation
