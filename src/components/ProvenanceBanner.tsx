import type { ReactNode } from 'react'
import { Panel, ProvenanceTag } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

/**
 * The banner that sits above a panel and states, in plain words, whether what
 * follows is real telemetry or fabricated data.
 *
 * It exists as a component rather than as prose in the README because the
 * distinction is the entire point of the project, and a reader should not have
 * to hold it in their head while scrolling. If a panel's provenance is ambiguous
 * on screen, that is a bug.
 */
export function ProvenanceBanner({
  tone,
  title,
  body,
  actions,
}: {
  tone: 'real' | 'simulated'
  title: string
  body: ReactNode
  actions?: ReactNode
}) {
  return (
    <Panel
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 px-4 py-3',
        tone === 'real' ? 'border-ok/25' : 'border-info/25',
      )}
    >
      <div className="flex min-w-0 max-w-4xl items-start gap-2.5">
        <div className="mt-0.5">
          <ProvenanceTag kind={tone} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-subtle">{body}</p>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </Panel>
  )
}
