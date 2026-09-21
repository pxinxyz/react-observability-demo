import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Database,
  HardDrive,
  Layers,
  Radio,
  Search,
  Server,
  Waypoints,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ServiceKind, ServiceSnapshot } from '@simulator/types'
import {
  Badge,
  Button,
  EmptyState,
  Meter,
  ProvenanceTag,
  StatusDot,
  Panel,
  PanelHeader,
  type Tone,
} from '@/components/ui/primitives'
import { budgetTone, healthTone, saturationTone, SERVICE_KIND_LABEL } from '@/lib/telemetry'
import { cn, formatCompact, formatDuration, formatPercent, formatRelative } from '@/lib/utils'
import { useDebounce } from '@/hooks/useDebounce'

/**
 * The service catalogue.
 *
 * SIMULATED. Every row describes a service that does not exist, generated from
 * `simulator/`. The panel says so on its face rather than only in the README.
 *
 * It is still a real table: sorting, filtering and selection are driven by the
 * same query the rest of the dashboard uses, so the interaction is genuine even
 * though the data is not.
 */

const KIND_ICON: Record<ServiceKind, LucideIcon> = {
  gateway: Radio,
  api: Server,
  worker: Layers,
  datastore: Database,
  cache: Zap,
  queue: Waypoints,
}

type SortKey = 'name' | 'tier' | 'requestRate' | 'errorRate' | 'p95Ms' | 'saturation' | 'budget'
type SortDirection = 'asc' | 'desc'

interface Column {
  key: SortKey
  label: string
  align: 'left' | 'right'
  hint?: string
  /** Sort ascending by default — good for names, wrong for latencies. */
  defaultDirection?: SortDirection
}

const COLUMNS: readonly Column[] = [
  { key: 'name', label: 'Service', align: 'left' },
  { key: 'tier', label: 'Tier', align: 'left', hint: 'Dependency depth. Tier 1 is closest to the edge.' },
  { key: 'requestRate', label: 'Traffic', align: 'right', defaultDirection: 'desc' },
  { key: 'errorRate', label: 'Errors', align: 'right', defaultDirection: 'desc' },
  { key: 'p95Ms', label: 'p50 / p95 / p99', align: 'right', defaultDirection: 'desc' },
  { key: 'saturation', label: 'Saturation', align: 'right', defaultDirection: 'desc' },
  { key: 'budget', label: 'Error budget', align: 'right' },
]

function sortValue(service: ServiceSnapshot, key: SortKey): number | string {
  switch (key) {
    case 'name':
      return service.name
    case 'tier':
      return service.tier
    case 'requestRate':
      return service.requestRate
    case 'errorRate':
      return service.errorRate
    case 'p95Ms':
      return service.p95Ms
    case 'saturation':
      return service.saturation
    case 'budget':
      return service.slo.budgetRemaining
    default:
      return 0
  }
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return null
  const Icon = direction === 'asc' ? ArrowUp : ArrowDown
  return <Icon className="size-3" aria-hidden />
}

export function ServiceTable({
  services,
  isLoading,
  onSelect,
  selectedId,
}: {
  services: ServiceSnapshot[]
  isLoading?: boolean
  onSelect?: (serviceId: string | null) => void
  selectedId?: string | null
}) {
  const [sortKey, setSortKey] = useState<SortKey>('tier')
  const [direction, setDirection] = useState<SortDirection>('asc')
  const [rawFilter, setRawFilter] = useState('')
  const filter = useDebounce(rawFilter, 200)

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const filtered = needle
      ? services.filter(
          (service) =>
            service.name.toLowerCase().includes(needle) ||
            service.kind.includes(needle) ||
            service.language.toLowerCase().includes(needle),
        )
      : services

    const sorted = [...filtered].sort((a, b) => {
      const left = sortValue(a, sortKey)
      const right = sortValue(b, sortKey)
      const comparison =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) - Number(right)
      return direction === 'asc' ? comparison : -comparison
    })

    // Ties broken deterministically, otherwise equal-tier rows shuffle on refetch.
    return sorted
  }, [services, filter, sortKey, direction])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    const column = COLUMNS.find((c) => c.key === key)
    setSortKey(key)
    setDirection(column?.defaultDirection ?? 'asc')
  }

  const degradedCount = services.filter((s) => s.health !== 'healthy').length

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <PanelHeader
        icon={Server}
        title="Fleet"
        subtitle={`${services.length} services · ${degradedCount} outside nominal`}
        actions={
          <>
            <ProvenanceTag kind="simulated" />
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <input
                value={rawFilter}
                onChange={(event) => setRawFilter(event.target.value)}
                placeholder="Filter…"
                aria-label="Filter services"
                className="w-36 rounded border border-edge bg-canvas/60 py-1 pl-7 pr-2 text-xs text-ink placeholder:text-subtle focus:border-accent/50 focus:outline-none"
              />
            </div>
          </>
        }
      />

      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-panel/95 backdrop-blur">
            <tr className="border-b border-edge">
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  title={column.hint}
                  className={cn(
                    'whitespace-nowrap px-3 py-2 font-medium text-subtle',
                    column.align === 'right' && 'text-right',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded transition-colors hover:text-ink',
                      column.align === 'right' && 'flex-row-reverse',
                      sortKey === column.key && 'text-ink',
                    )}
                  >
                    {column.label}
                    <SortIcon active={sortKey === column.key} direction={direction} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((service) => {
              const Icon = KIND_ICON[service.kind]
              const isSelected = selectedId === service.id
              const tone: Tone = healthTone(service.health)

              return (
                <tr
                  key={service.id}
                  onClick={() => onSelect?.(isSelected ? null : service.id)}
                  className={cn(
                    'cursor-pointer border-b border-edge/60 transition-colors',
                    isSelected ? 'bg-raised' : 'hover:bg-raised/60',
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Icon className="size-3.5 shrink-0 text-subtle" aria-hidden />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <StatusDot tone={tone} pulse={service.health === 'critical'} />
                          {/*
                            Health is encoded as dot colour, which is invisible to a
                            screen reader and ambiguous for a colour-blind reader. The
                            label is hidden visually but present in the accessibility
                            tree, so the row reads as "critical inventory-api".
                          */}
                          <span className="sr-only">{service.health}</span>
                          <span className="truncate font-medium text-ink">{service.name}</span>
                          <ChevronRight
                            className={cn(
                              'size-3 text-subtle transition-transform',
                              isSelected && 'rotate-90',
                            )}
                            aria-hidden
                          />
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-subtle">
                          {SERVICE_KIND_LABEL[service.kind]} · {service.language} · v
                          {service.version}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-2 text-subtle">
                    <Badge tone="neutral" mono>
                      T{service.tier}
                    </Badge>
                  </td>

                  <td className="tnum px-3 py-2 text-right text-muted">
                    {formatCompact(service.requestRate)}
                    <span className="ml-0.5 text-subtle">/s</span>
                  </td>

                  <td className="tnum px-3 py-2 text-right">
                    <span
                      className={cn(
                        service.errorRate >= 0.05
                          ? 'text-crit'
                          : service.errorRate >= 0.01
                            ? 'text-warn'
                            : 'text-muted',
                      )}
                    >
                      {formatPercent(service.errorRate)}
                    </span>
                  </td>

                  <td className="tnum px-3 py-2 text-right text-muted">
                    <span className="text-ink">{formatDuration(service.p50Ms)}</span>
                    <span className="mx-1 text-subtle">/</span>
                    {formatDuration(service.p95Ms)}
                    <span className="mx-1 text-subtle">/</span>
                    {formatDuration(service.p99Ms)}
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <span className="tnum w-9 text-right text-muted">
                        {formatPercent(service.saturation, 0)}
                      </span>
                      <Meter
                        value={service.saturation}
                        tone={saturationTone(service.saturation)}
                        className="w-14"
                      />
                    </div>
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <span className="tnum w-9 text-right text-muted">
                        {formatPercent(service.slo.budgetRemaining, 0)}
                      </span>
                      <Meter
                        value={service.slo.budgetRemaining}
                        tone={budgetTone(service.slo.budgetRemaining)}
                        className="w-14"
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {rows.length === 0 && !isLoading ? (
          <EmptyState
            icon={HardDrive}
            title="No services match that filter"
            description={`Nothing in the catalogue matches “${filter}”. Clear the filter to see all ${services.length} services.`}
            action={
              <Button variant="outline" size="sm" onClick={() => setRawFilter('')}>
                Clear filter
              </Button>
            }
          />
        ) : null}
      </div>

      {selectedId ? <ServiceDetail service={services.find((s) => s.id === selectedId)} /> : null}
    </Panel>
  )
}

function ServiceDetail({ service }: { service?: ServiceSnapshot }) {
  if (!service) return null

  const dependencies = service.dependsOn.length > 0 ? service.dependsOn : null

  return (
    <div className="border-t border-edge bg-canvas/40 px-4 py-3">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">
            Last deploy
          </div>
          <div className="mt-1 text-xs text-muted">
            {formatRelative(service.lastDeployAt)}
            <span className="ml-1.5 font-mono text-[10px] text-subtle">
              {new Date(service.lastDeployAt).toISOString().slice(0, 16).replace('T', ' ')}
            </span>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">
            Instances
          </div>
          <div className="tnum mt-1 text-xs text-muted">{service.instances} replicas</div>
        </div>

        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">
            Availability SLO
          </div>
          <div className="tnum mt-1 text-xs text-muted">
            target {(service.slo.target * 100).toFixed(2)}%
            <span className="mx-1.5 text-subtle">·</span>
            observed {formatPercent(1 - service.errorRate, 3)}
          </div>
        </div>
      </div>

      {dependencies ? (
        <div className="mt-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">
            Calls
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {dependencies.map((dependency) => (
              <Badge key={dependency} tone="neutral" mono>
                {dependency}
              </Badge>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 text-[11px] text-subtle">
          Leaf service — calls nothing downstream.
        </div>
      )}
    </div>
  )
}
