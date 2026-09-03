"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"

/**
 * Toaster, trimmed from the shadcn default in two ways that matter here.
 *
 * `next-themes` is not a dependency: this app resolves light and dark from
 * `prefers-color-scheme` in globals.css, so `theme="system"` is the honest
 * value and there is no provider to read.
 *
 * The shadcn original sets sonner's CSS custom properties through an inline
 * `style` object cast to `CSSProperties`, and passes `theme` through a second
 * cast. Both are forbidden (CLAUDE.md "No casts"), so the custom properties
 * live in globals.css under `.toaster` instead — which is also where the rest
 * of this design system's tokens are.
 */
const toasterIcons = {
  success: <CircleCheckIcon className="size-4" />,
  info: <InfoIcon className="size-4" />,
  warning: <TriangleAlertIcon className="size-4" />,
  error: <OctagonXIcon className="size-4" />,
  loading: <Loader2Icon className="size-4 animate-spin" />,
}

const toasterOptions = { classNames: { toast: "cn-toast" } }

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      icons={toasterIcons}
      toastOptions={toasterOptions}
      {...props}
    />
  )
}

export { Toaster }
