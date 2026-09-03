import type { VariantProps } from "class-variance-authority"

import { Button, type buttonVariants } from "@/components/ui/button"

import { SpecimenSection } from "./specimen-section"

type Variant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>

const VARIANTS: readonly Variant[] = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
]

export function ButtonSection() {
  return (
    <SpecimenSection
      title="Buttons"
      description="Every variant, plus the disabled state each one shares."
    >
      <div className="flex flex-wrap items-center gap-3">
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled>Disabled</Button>
        <Button variant="outline" disabled>
          Disabled
        </Button>
      </div>
    </SpecimenSection>
  )
}
