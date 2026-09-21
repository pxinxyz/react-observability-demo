import { useEffect, useMemo } from 'react'
import { Siren, TrendingDown, TrendingUp } from 'lucide-react'
import { IncidentFeed } from '@/components/IncidentFeed'
import { ProvenanceBanner } from '@/components/ProvenanceBanner'
import { ScenarioNarrative } from '@/components/ScenarioPicker'
import { EmptyState, Panel, PanelHeader, ProvenanceTag, Stat } from '@/components/ui/primitives'
import { useIncidents } from '@/hooks'
import { recordInteraction } from '@/observability'
import { severityTone } from '@/lib/telemetry'
import { formatNumber, formatPercent } from '@/lib/utils'

export function IncidentsPage() {
  const incidents = useIncidents()

  useEffect(() => {
    recordInteraction('view-page', 'incidents')
  }, [])

  const all = incidents.data?.incidents ?? []

  const stats = useMemo(() => {
    const open = all.filter((incident) => incident.status !== 'resolved')
    const resolved = all.filter((incident) => incident.status === 'resolved')
    const worst = open[0] ?? null
    const totalAffected = all.reduce(
      (sum, incident) => sum + incident.impact.affectedRequests,
      0,
    )
    const meanDuration =
      all.length === 0
        ? 0
        : all.reduce((sum, incident) => sum + incident.durationMinutes, 0) / all.length

    return { open, resolved, worst, totalAffected, meanDuration }
  }, [all])

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ScenarioNarrative />
      </div>

      <ProvenanceBanner
        tone="simulated"
        title="These incidents never happened"
        body={
          <>
            Titles, timelines, severities and impact estimates are all derived from the active
            scenario by <code className="font-mono">simulator/engine.ts</code>. There is no
            Alertmanager, no on-call rotation and no production system behind this page. It exists so
            the dashboard has a realistic operational surface without anyone needing to break
            something real.
          </>
        }
      />

      {all.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Panel className="p-4">
            <Stat
              label="Open"
              value={String(stats.open.length)}
              tone={stats.open.length > 0 ? 'crit' : 'ok'}
              hint={
                stats.worst
                  ? `worst: ${stats.worst.severity.toUpperCase()} · ${stats.worst.title.slice(0, 40)}${stats.worst.title.length > 40 ? '…' : ''}`
                  : 'nothing active'
              }
            />
          </Panel>
          <Panel className="p-4">
            <Stat
              label="Resolved"
              value={String(stats.resolved.length)}
              tone="ok"
              hint="in the last 24 hours"
            />
          </Panel>
          <Panel className="p-4">
            <Stat
              label="Mean duration"
              value={`${Math.round(stats.meanDuration)}m`}
              hint="started → resolved"
            />
          </Panel>
          <Panel className="p-4">
            <Stat
              label="Requests affected"
              value={formatNumber(stats.totalAffected)}
              hint="summed estimated impact"
            />
          </Panel>
        </div>
      ) : null}

      {incidents.isError ? (
        <Panel className="p-4">
          <p className="text-sm text-crit">Failed to load incidents: {incidents.error.message}</p>
        </Panel>
      ) : (
        <IncidentFeed incidents={all} />
      )}

      <Panel className="overflow-hidden">
        <PanelHeader
          icon={Siren}
          title="Severity ladder"
          subtitle="How the generated incidents map onto the usual on-call language."
          actions={<ProvenanceTag kind="simulated" />}
        />
        <div className="grid gap-px bg-edge sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['sev1', 'Total outage or data loss on a revenue path. Page immediately, all hands.'],
              ['sev2', 'Major degradation with a customer-visible impact. Page the on-call.'],
              ['sev3', 'Partial or internal impact with a workaround. Ticket and schedule.'],
              ['sev4', 'Cosmetic or informational. Handle in business hours.'],
            ] as const
          ).map(([severity, description]) => (
            <div key={severity} className="bg-panel px-4 py-3">
              <div className="flex items-center gap-1.5">
                {severity === 'sev1' || severity === 'sev2' ? (
                  <TrendingUp className="size-3 text-subtle" aria-hidden />
                ) : (
                  <TrendingDown className="size-3 text-subtle" aria-hidden />
                )}
                <span
                  className={
                    severityTone(severity) === 'crit'
                      ? 'font-mono text-sm font-semibold text-crit'
                      : severityTone(severity) === 'warn'
                        ? 'font-mono text-sm font-semibold text-warn'
                        : 'font-mono text-sm font-semibold text-muted'
                  }
                >
                  {severity.toUpperCase()}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-subtle">{description}</p>
            </div>
          ))}
        </div>
      </Panel>

      {all.length === 0 && !incidents.isLoading ? (
        <Panel>
          <EmptyState
            icon={Siren}
            title="No incidents"
            description="The incidents endpoint returned an empty feed for this scenario."
          />
        </Panel>
      ) : null}

      <p className="text-xs leading-relaxed text-subtle">
        Impact estimates assume a fixed 420 req/s on the affected path and are computed as
        peak error rate × duration × request rate. They are illustrative, not measured. The peak
        error rates shown here ({formatPercent(stats.worst?.impact.peakErrorRate ?? 0)}) come from
        the same seeded generator as everything else on this page.
      </p>
    </>
  )
}
