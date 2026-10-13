import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Variants follow the Pravah design: default = primary (.btn.pri), outline = the
// standard bordered button (.btn), destructive = .btn.dng, ghost = .btn.ghost.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap no-underline transition-colors outline-none select-none cursor-pointer hover:no-underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-acc border-acc text-on-acc hover:bg-acc-2 hover:border-acc-2 hover:text-on-acc",
        outline: "border-border-2 bg-surface text-text hover:bg-surface-2 hover:text-text aria-expanded:bg-surface-2",
        secondary: "border-transparent bg-surface-2 text-text hover:bg-surface-3 hover:text-text",
        ghost: "border-transparent bg-transparent text-text-2 hover:bg-surface-2 hover:text-text aria-expanded:bg-surface-2",
        destructive: "border-bad-bd bg-surface text-bad hover:bg-bad-bg hover:text-bad",
        link: "border-transparent text-acc underline-offset-4 hover:underline px-0",
      },
      size: {
        default: "min-h-8 px-3 py-[5px] text-[13px] leading-[18px]",
        xs: "min-h-6 px-1.5 text-[11px] gap-1 [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-[26px] px-2 py-0.5 text-xs gap-1 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-11 px-4 py-2.5 text-sm",
        icon: "size-8 border-transparent bg-transparent text-text-2 hover:bg-surface-2 hover:text-text",
        "icon-xs": "size-6 border-transparent bg-transparent text-text-2 hover:bg-surface-2 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 border-transparent bg-transparent text-text-2 hover:bg-surface-2",
        "icon-lg": "size-11 border-transparent bg-transparent text-text-2 hover:bg-surface-2 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "outline",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
