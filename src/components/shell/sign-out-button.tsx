"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { authClient } from "@/modules/auth/client"

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleSignOut() {
    setPending(true)
    await authClient.signOut()
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <Button variant="secondary" disabled={pending} onClick={() => void handleSignOut()}>
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  )
}
