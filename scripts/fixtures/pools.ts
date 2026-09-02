// Small value pools shared by more than one fixture generator, so the
// customer- and country-shaped columns look consistent across fixtures
// without each generator inventing its own list.

export const FULL_NAMES = [
  "Alex Kim",
  "Sam Lee",
  "Jo Park",
  "Max Ng",
  "Ana Cruz",
  "Ray Diaz",
  "Mia Chen",
  "Tom Bell",
  "Zoe Fox",
  "Ken Ito",
  "Ivy Shaw",
  "Noa Fisher",
  "Eli Grant",
  "Lea Munoz",
  "Cy Adler",
] as const

export const COUNTRIES = ["US", "GB", "DE", "FR", "CA", "AU"] as const

export const EMAIL_DOMAINS = ["example.com", "acme.io", "mailbox.dev", "corp.test"] as const

/** Turns "Alex Kim" into "alexkim" for building a deterministic email local-part. */
export function slugifyName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z]/g, "")
}
