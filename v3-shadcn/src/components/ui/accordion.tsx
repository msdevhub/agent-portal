import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

interface AccordionContextValue {
  value: string | null
  setValue: (value: string) => void
  collapsible: boolean
}

interface AccordionItemContextValue {
  value: string
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null)
const AccordionItemContext = React.createContext<AccordionItemContextValue | null>(null)

function useAccordionContext() {
  const context = React.useContext(AccordionContext)
  if (!context) {
    throw new Error("Accordion components must be used within <Accordion>.")
  }
  return context
}

function useAccordionItemContext() {
  const context = React.useContext(AccordionItemContext)
  if (!context) {
    throw new Error("Accordion item components must be used within <AccordionItem>.")
  }
  return context
}

function Accordion({
  value,
  defaultValue,
  onValueChange,
  collapsible = false,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string | null) => void
  collapsible?: boolean
}) {
  const [internalValue, setInternalValue] = React.useState<string | null>(defaultValue ?? null)
  const currentValue = value ?? internalValue

  const setValue = React.useCallback((nextValue: string) => {
    const resolvedValue = collapsible && currentValue === nextValue ? null : nextValue
    if (value === undefined) {
      setInternalValue(resolvedValue)
    }
    onValueChange?.(resolvedValue)
  }, [collapsible, currentValue, onValueChange, value])

  return (
    <AccordionContext.Provider value={{ value: currentValue, setValue, collapsible }}>
      <div data-slot="accordion" className={cn("space-y-2 sm:space-y-3", className)} {...props}>
        {children}
      </div>
    </AccordionContext.Provider>
  )
}

function AccordionItem({
  className,
  value,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  return (
    <AccordionItemContext.Provider value={{ value }}>
      <div
        data-slot="accordion-item"
        className={cn("overflow-hidden rounded-xl border border-zinc-800/80 bg-[#18181b] sm:rounded-2xl", className)}
        {...props}
      />
    </AccordionItemContext.Provider>
  )
}

function AccordionTrigger({ className, children, ...props }: React.ComponentProps<"button">) {
  const accordion = useAccordionContext()
  const item = useAccordionItemContext()
  const isOpen = accordion.value === item.value

  return (
    <button
      type="button"
      data-slot="accordion-trigger"
      data-state={isOpen ? "open" : "closed"}
      className={cn(
        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-zinc-900/40 sm:gap-3 sm:px-4 sm:py-4 sm:hover:bg-zinc-900/60",
        className
      )}
      onClick={() => accordion.setValue(item.value)}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronDown
        className={cn(
          "h-4 w-4 shrink-0 text-zinc-500 transition-transform",
          isOpen && "rotate-180"
        )}
      />
    </button>
  )
}

function AccordionContent({ className, children, ...props }: React.ComponentProps<"div">) {
  const accordion = useAccordionContext()
  const item = useAccordionItemContext()
  const isOpen = accordion.value === item.value

  if (!isOpen) return null

  return (
    <div
      data-slot="accordion-content"
      className={cn("border-t border-zinc-800/70 px-3 py-2 sm:px-4 sm:py-4", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
