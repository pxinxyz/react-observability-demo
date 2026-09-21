import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, ExternalLink, X } from 'lucide-react'
import { Badge, Button, ProvenanceTag } from '@/components/ui/primitives'
import { cn, formatClock, formatDuration, formatNumber } from '@/lib/utils'
import { position, type TraceViewerTrace, type WaterfallSpan } from './model'
import { SpanDetailPanel } from './SpanDetailPanel'
import { SpanWaterfall, TimelineRuler } from './SpanWaterfall'

/**
 * The trace drawer.
 *
 * The bottom of the drill-down: fleet → telemetry → incident → trace → span.
 * Opens over the dashboard rather than navigating, so you keep the context you
 * were looking at while you inspect.
 *
 * Focus management, escape handling, scroll locking and `aria-modal` all come
 * from Radix Dialog rather than being reimplemented — which is the reason to
 * use the primitive even though the visual treatment is entirely bespoke.
 */
export function TraceDrawer({
  trace,
  initialSpanId,
  open,
  onOpenChange,
}: {
  trace: TraceViewerTrace | null
  /** Span to focus on open. Falls back to the root span. */
  initialSpanId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Reset the selection whenever a different trace is opened.
  useEffect(() => {
    if (!open || !trace) return
    setSelectedId(initialSpanId ?? trace.spans[0]?.spanId ?? null)
  }, [open, trace, initialSpanId])

  const rows = useMemo(() => (trace ? position(trace.spans) : []), [trace])
  const selected = rows.find((row) => row.spanId === selectedId) ?? rows[0] ?? null

  if (!trace) return null

  async function copyTraceId() {
    try {
      await navigator.clipboard.writeText(trace!.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // Clipboard can be denied; the id is on screen either way.
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full max-w-[min(60rem,95vw)] flex-col',
            'border-l border-edge bg-panel shadow-2xl focus:outline-none',
          )}
        >
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={trace.status === 'error' ? 'crit' : 'ok'}>
                  {trace.status === 'error' ? 'error' : 'ok'}
                </Badge>
                <Badge tone="neutral" mono>
                  {formatDuration(trace.durationMs)}
                </Badge>
                <Badge tone="neutral" mono>
                  {formatNumber(trace.spans.length)} spans
                </Badge>
                <ProvenanceTag kind={trace.origin} />
              </div>
              <Dialog.Title className="mt-1.5 truncate text-base font-medium text-ink">
                {trace.title}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 flex flex-wrap items-center gap-x-3 text-2xs text-subtle">
                <span className="font-mono">{formatClock(trace.startTimeMs)}</span>
                <span>{trace.subtitle}</span>
              </Dialog.Description>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void copyTraceId()}
                title="Copy trace id"
                className="inline-flex items-center gap-1.5 rounded border border-edge px-2 py-1 font-mono text-2xs text-subtle transition-colors hover:border-edge-strong hover:text-muted"
              >
                {copied ? <Check className="size-3 text-ok" aria-hidden /> : <Copy className="size-3" aria-hidden />}
                {trace.id.slice(0, 16)}
              </button>
              <Dialog.Close asChild>
                <Button variant="outline" size="sm" title="Close (Esc)">
                  <X className="size-3.5" aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="scroll-thin min-h-0 overflow-auto border-b border-edge lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between gap-2 px-4 py-2">
                <span className="text-2xs font-medium uppercase tracking-wider text-subtle">
                  Waterfall
                </span>
                <span className="text-2xs text-subtle">
                  Select a span to inspect it
                </span>
              </div>
              <TimelineRuler durationMs={trace.durationMs} />
              <SpanWaterfall
                trace={trace}
                selectedSpanId={selected?.spanId ?? null}
                onSelectSpan={(span: WaterfallSpan) => setSelectedId(span.spanId)}
              />
            </div>

            <aside className="scroll-thin min-h-0 overflow-auto px-4 py-3">
              {selected ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 truncate text-sm font-medium text-ink" title={selected.name}>
                      {selected.name}
                    </h3>
                  </div>
                  <SpanDetailPanel span={selected} trace={trace} className="mt-2" />
                </>
              ) : (
                <p className="text-xs text-subtle">No spans in this trace.</p>
              )}
            </aside>
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-edge px-4 py-2 text-2xs text-subtle">
            <span>
              Press <kbd className="rounded border border-edge px-1 font-mono">Esc</kbd> to close
            </span>
            <a
              href={
                trace.origin === 'real'
                  ? 'https://opentelemetry.io/docs/concepts/signals/traces/'
                  : '#'
              }
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                'inline-flex items-center gap-1 transition-colors hover:text-muted',
                trace.origin !== 'real' && 'pointer-events-none opacity-0',
              )}
            >
              What is a span?
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
