import type { ReactNode } from "react"

/**
 * One labelled section of the specimen page: a heading, a one-line
 * description of what the section demonstrates, and its content. Shared
 * across every section file here rather than repeated eight times.
 */
export function SpecimenSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-hairline pt-8">
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      </div>
      {children}
    </section>
  )
}
