import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2.5 py-0.5 font-mono text-[11px] tracking-[0.08em] whitespace-nowrap uppercase transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-refused aria-invalid:ring-refused/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-hairline bg-surface-high text-ink-muted [a]:hover:bg-surface-high/80",
        secondary: "border-hairline bg-surface-high text-ink-muted [a]:hover:bg-surface-high/80",
        destructive: "border-refused/40 bg-refused-wash text-refused [a]:hover:bg-refused-wash/70",
        verified: "border-verified/40 bg-verified-wash text-verified [a]:hover:bg-verified-wash/70",
        caution: "border-caution/40 bg-caution-wash text-caution [a]:hover:bg-caution-wash/70",
        outline: "border-hairline-strong bg-transparent text-ink [a]:hover:bg-surface-high",
        ghost: "border-transparent text-ink-muted [a]:hover:bg-surface-high",
        link: "border-transparent text-ink underline-offset-4 [a]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
