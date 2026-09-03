import type { VariantProps } from "class-variance-authority"

import { Badge, type badgeVariants } from "@/components/ui/badge"

import { SpecimenSection } from "./specimen-section"

type Variant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

const VARIANTS: readonly Variant[] = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "link",
  "destructive",
  "verified",
  "caution",
]

export function BadgeSection() {
  return (
    <SpecimenSection
      title="Badges"
      description="Every variant, including the material states — verified and caution never carry meaning by colour alone, so they pair with a word."
    >
      <div className="flex flex-wrap items-center gap-2">
        {VARIANTS.map((variant) => (
          <Badge key={variant} variant={variant}>
            {variant}
          </Badge>
        ))}
      </div>
    </SpecimenSection>
  )
}
