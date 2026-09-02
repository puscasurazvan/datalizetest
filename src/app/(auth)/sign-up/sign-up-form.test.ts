import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const dir = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(dir, "sign-up-form.tsx"), "utf8")

describe("SignUpForm navigation effect", () => {
  // src/components/CLAUDE.md: "`useEffect` is for synchronising with something
  // outside React ... say in a comment what external thing it synchronises
  // with." This asserts the justification exists, not just that the effect
  // runs, so a future author can't drop the comment and stay green.
  it("documents the navigation side effect the useEffect exists to synchronise with", () => {
    const lines = source.split("\n")
    const effectLineIndex = lines.findIndex((line) => line.includes("useEffect(() => {"))
    expect(effectLineIndex).toBeGreaterThan(-1)

    let i = effectLineIndex - 1
    const commentLines: string[] = []
    while (i >= 0) {
      const line = lines[i]?.trim()
      if (line === undefined || !line.startsWith("//")) break
      commentLines.unshift(line)
      i -= 1
    }

    expect(commentLines.length).toBeGreaterThan(0)
    const commentText = commentLines.join(" ").toLowerCase()
    expect(commentText).toMatch(/navigation/)
    expect(commentText).toMatch(/side effect/)
  })
})
