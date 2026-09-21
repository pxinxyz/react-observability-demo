import { useState } from 'react'
import * as Collapsible from '@radix-ui/react-collapsible'
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Server,
  Siren,
  TrendingUp,
  User,
  Zap,
} from 'lucide-react'
import type { Incident, IncidentEvent } from '@simulator/types'
import {
  Badge,
  EmptyState,
  Panel,
  PanelHeader,
  ProvenanceTag,
} from '@/components/ui/primitives'
import { incidentStatusTone, severityTone } from '@/lib/telemetry'
import { cn, formatDuration, formatNumber, formatPercent, formatRelative, formatTimestamp } from '@/lib/utils'

/**
 * The incident feed.
 *
 * SIMULATED — these incidents never happened. Timelines and impact estimates are
 * derived from the active scenario in `simulator/engine.ts`.
 *
 * Severity uses the conventional sev1–sev4 ladder because that is what an
 * on-call engineer actually reads; a bespoke three-colour scheme would look
 * tidier and communicate less.
 */

const ACTOR_ICON: Record<string, typeof User> = {
  system: Zap,
  alertmanager: Siren,
  'on-call': User,
}

export function IncidentFeed({
  incidents,
  compact = false,
  limit,
}: {
  incidents: Incident[]
  /** Trims the card down for the Overview page. */
  compact?: boolean
  limit?: number
}) {
  const [expanded, setExpanded] = useState<string | null>(incidents[0]?.id ?? null)

  const visible = typeof limit === 'number' ? incidents.slice(0, limit) : incidents

  if (visible.length === 0) {
    return (
      <Panel>
        <PanelHeader
          icon={Siren}
          title="Incidents"
          actions={<ProvenanceTag kind="simulated" />}
        />
        <EmptyState
          icon={Siren}
          title="No incidents in the window"
          description="Clean run. Pick a scenario that degrades something to see the feed populate."
        />
      </Panel>
    )
  }

  const openCount = incidents.filter((incident) => incident.status !== 'resolved').length

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        icon={Siren}
        title="Incidents"
        subtitle={`${openCount} open · ${incidents.length} in the last 24h`}
        actions={<ProvenanceTag kind="simulated" />}
      />

      <ul className="divide-y divide-[var(--color-edge)]">
        {visible.map((incident) => {
          const isOpen = expanded === incident.id
          const severity = severityTone(incident.severity)
          const status = incidentStatusTone(incident.status)

          return (
            <li key={incident.id}>
              <Collapsible.Root
                open={isOpen}
                onOpenChange={(next) => setExpanded(next ? incident.id : null)}
              >
                <Collapsible.Trigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                      isOpen ? 'bg-raised/60' : 'hover:bg-raised/40',
                    )}
                  >
                    <span className="mt-0.5 shrink-0 text-subtle">
                      {isOpen ? (
                        <ChevronDown className="size-3.5" aria-hidden />
                      ) : (
                        <ChevronRight className="size-3.5" aria-hidden />
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={severity} mono>
                          {incident.severity.toUpperCase()}
                        </Badge>
                        <Badge tone={status}>{incident.status}</Badge>
                        <span className="font-mono text-[10px] text-subtle">{incident.id}</span>
                      </span>

                      <span className="mt-1.5 block text-sm font-medium leading-snug text-ink">
                        {incident.title}
                      </span>

                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" aria-hidden />
                          {formatRelative(incident.startedAt)} · {incident.durationMinutes}m
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Server className="size-3" aria-hidden />
                          {incident.serviceIds.length} services
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <TrendingUp className="size-3" aria-hidden />
                          peak {formatPercent(incident.impact.peakErrorRate)} errors
                        </span>
                      </span>
                    </span>
                  </button>
                </Collapsible.Trigger>

                <Collapsible.Content>
                  <div className="border-t border-edge/60 bg-canvas/40 px-4 py-3">
                    {!compact ? (
                      <p className="text-xs leading-relaxed text-muted">{incident.summary}</p>
                    ) : null}

                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Field label="Started" value={formatTimestamp(incident.startedAt)} />
                      <Field label="Detected" value={formatTimestamp(incident.detectedAt)} />
                      <Field
                        label="Resolved"
                        value={
                          incident.resolvedAt ? formatTimestamp(incident.resolvedAt) : 'still open'
                        }
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {incident.serviceIds.map((serviceId) => (
                        <Badge key={serviceId} tone="neutral" mono>
                          {serviceId}
                        </Badge>
                      ))}
                    </div>

                    <div className="mt-4">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">
                        Timeline
                      </div>
                      <ol className="mt-2 space-y-0">
                        {incident.timeline.map((event, index) => (
                          <TimelineRow
                            key={`${event.at}-${index}`}
                            event={event}
                            isLast={index === incident.timeline.length - 1}
                          />
                        ))}
                      </ol>
                    </div>

                    <div className="mt-3 rounded border border-edge bg-panel/60 px-3 py-2">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">
                        Impact
                      </div>
                      <div className="tnum mt-1 text-xs text-muted">
                        ~{formatNumber(incident.impact.affectedRequests)} requests affected at a
                        peak error rate of {formatPercent(incident.impact.peakErrorRate)}
                      </div>
                    </div>
                  </div>
                </Collapsible.Content>
              </Collapsible.Root>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-subtle">{label}</div>
      <div className="tnum mt-0.5 font-mono text-[11px] text-muted">{value}</div>
    </div>
  )
}

function TimelineRow({ event, isLast }: { event: IncidentEvent; isLast: boolean }) {
  const Icon = ACTOR_ICON[event.actor] ?? User

  return (
    <li className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-edge-strong bg-raised">
          <Icon className="size-2.5 text-subtle" aria-hidden />
        </span>
        {!isLast ? <span className="w-px flex-1 bg-edge" /> : null}
      </div>

      <div className={cn('min-w-0 pb-3', isLast && 'pb-0')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] text-subtle">
            {new Date(event.at).toLocaleTimeString('en-US', { hour12: false })}
          </span>
          <Badge tone="neutral">{event.actor}</Badge>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{event.note}</p>
      </div>
    </li>
  )
}

/** Compact one-line summary used in the Overview header strip. */
export function IncidentTicker({ incidents }: { incidents: Incident[] }) {
  const active = incidents.filter((incident) => incident.status !== 'resolved')
  if (active.length === 0) return null

  const worst = active[0]!
  const tone = severityTone(worst.severity)

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs',
        tone === 'crit'
          ? 'border-crit/40 bg-crit/10 text-crit'
          : 'border-warn/40 bg-warn/10 text-warn',
      )}
    >
      <Siren className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate font-medium">{worst.title}</span>
      <span className="tnum shrink-0 text-subtle">
        {formatDuration(worst.durationMinutes * 60_000)}
      </span>
    </div>
  )
}
