"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { PENDING_CLASS } from "@/components/ui/pending"

/**
 * The pill-group nav from the design. Order follows the mock; the items whose
 * feature does not exist yet ship inert at full geometry rather than being cut,
 * so the nav is the designed nav (DESIGN.md "Not built yet"). They are spans,
 * never anchors — a dead link is worse than a disabled control.
 *
 * The inert items are the ones that fold away on a narrow viewport, never the
 * real destinations: this nav is the only route back to the Datasets index from
 * a Dataset, so hiding it wholesale below a breakpoint strands the reader on
 * whatever screen they landed on.
 */
const NAV_ITEMS = [
  { label: "Dashboard", href: null },
  { label: "Query Builder", href: null },
  { label: "Datasets", href: "/datasets" },
  { label: "Audit Vault", href: null },
  { label: "Settings", href: "/settings" },
] as const

const ITEM =
  "rounded-full px-space-md py-space-2xs text-body-sm whitespace-nowrap transition-colors"

/** Inert items are decoration until their feature exists — they yield the space first. */
const PENDING_ITEM = "hidden xl:block"

export function PrimaryNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="flex items-center gap-space-xs rounded-full bg-surface p-space-2xs"
    >
      {NAV_ITEMS.map((item) => {
        if (item.href === null) {
          return (
            <span
              key={item.label}
              aria-disabled="true"
              title={`${item.label} is not available yet`}
              className={`${ITEM} ${PENDING_ITEM} ${PENDING_CLASS}`}
            >
              {item.label}
            </span>
          )
        }

        const active = pathname.startsWith(item.href)

        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? `${ITEM} bg-surface-highest text-ink shadow-sm`
                : `${ITEM} text-ink-muted hover:bg-surface-high hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`
            }
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
