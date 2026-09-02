"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { authClient } from "@/modules/auth/client"

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignOut() {
    setError(null)
    setPending(true)
    const { error: signOutError } = await authClient.signOut()
    if (signOutError) {
      // The session cookie is untouched on failure — navigating anyway
      // would show the sign-in screen for a user who is still signed in.
      setError(signOutError.message ?? "Could not sign you out. Try again.")
      setPending(false)
      return
    }
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" disabled={pending} onClick={() => void handleSignOut()}>
        {pending ? "Signing out…" : "Sign out"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
