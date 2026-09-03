import type { ReactNode } from "react"

import { Brand } from "@/components/brand"

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-space-lg bg-canvas px-gutter-mobile py-space-3xl">
      <div className="flex w-full max-w-sm flex-col gap-space-xl">
        <div className="flex justify-center">
          <Brand />
        </div>
        {children}
      </div>
      <p className="font-mono text-label-mono uppercase tracking-wider text-ink-faint">
        An account is required to continue
      </p>
    </div>
  )
}
