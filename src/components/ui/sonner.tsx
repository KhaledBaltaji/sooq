"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Use --surface (cards/dialogs) instead of --elevated (hover state) so toasts
// stand out against the page background. Deep shadow + visible border lift the
// toast off the page. richColors gives success/error/warning their own
// variant-colored backgrounds so users can tell them apart at a glance.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      richColors
      closeButton
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--text)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-md)",
          "--toast-shadow":
            "0 10px 30px -5px rgba(0,0,0,0.35), 0 4px 10px -3px rgba(0,0,0,0.25)",
        } as React.CSSProperties
      }
      toastOptions={{
        style: {
          boxShadow: "var(--toast-shadow)",
          borderWidth: "1px",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
