import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

import { SpecimenSection } from "./specimen-section"

// Hoisted rather than inlined, matching src/components/ui/dialog.tsx's own
// `render` props — a fresh element every render is what react-perf's
// jsx-no-jsx-as-prop rule flags.
const dialogTriggerButton = <Button variant="outline" />
const tooltipTriggerButton = <Button variant="ghost" />

export function OverlaySection() {
  return (
    <SpecimenSection
      title="Dialog, tooltip, skeleton"
      description="A dialog trigger, a hover tooltip, and a loading skeleton."
    >
      <div className="flex flex-wrap items-center gap-6">
        <Dialog>
          <DialogTrigger render={dialogTriggerButton}>Change timezone</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change workspace timezone</DialogTitle>
              <DialogDescription>
                Future imports read naive timestamps in the new timezone. Past Dataset Versions are
                unaffected.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton>
              <Button>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={tooltipTriggerButton}>Δ02</TooltipTrigger>
            <TooltipContent>Superseded by Δ03 on 2026-08-04</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
    </SpecimenSection>
  )
}
