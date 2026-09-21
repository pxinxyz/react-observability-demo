import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown, FlaskConical, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/primitives'
import { useScenarios, useSimulate } from '@/hooks/useTelemetry'
import { useScenario } from '@/state/scenario'
import { severityTone } from '@/lib/telemetry'
import { cn } from '@/lib/utils'

/**
 * Scenario picker.
 *
 * This is the app's one write operation. Selecting a scenario POSTs to
 * `/api/simulate`, which returns the whole resulting estate in a single
 * response — so the dashboard flips to the new world atomically instead of
 * showing six panels refreshing at six different moments.
 *
 * It is also the most convenient way to generate a trace: the POST is a real
 * span, and the scenario switch adds another.
 */
export function ScenarioPicker() {
  const { scenarioId } = useScenario()
  const { data, isLoading } = useScenarios()
  const simulate = useSimulate()

  const scenarios = data?.scenarios ?? []
  const active = scenarios.find((scenario) => scenario.id === scenarioId)

  return (
    <div className="flex items-center gap-2">
      <Select.Root
        value={scenarioId}
        onValueChange={(value) => simulate.mutate(value)}
        disabled={isLoading || simulate.isPending}
      >
        <Select.Trigger
          aria-label="Active scenario"
          className={cn(
            'inline-flex min-w-[13rem] items-center justify-between gap-2 rounded border border-edge-strong bg-raised px-2.5 py-1.5',
            'text-xs text-ink transition-colors hover:border-accent/50 focus:outline-none',
            'data-[placeholder]:text-subtle',
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {simulate.isPending ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" aria-hidden />
            ) : (
              <FlaskConical className="size-3.5 shrink-0 text-subtle" aria-hidden />
            )}
            <Select.Value placeholder="Select a scenario">
              <span className="truncate">{active?.name ?? scenarioId}</span>
            </Select.Value>
          </span>
          <Select.Icon>
            <ChevronDown className="size-3.5 shrink-0 text-subtle" aria-hidden />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="z-50 max-h-[min(28rem,70vh)] w-[min(24rem,90vw)] overflow-hidden rounded-lg border border-edge-strong bg-panel shadow-2xl"
          >
            <Select.Viewport className="scroll-thin max-h-[min(28rem,70vh)] overflow-y-auto p-1">
              {scenarios.map((scenario) => (
                <Select.Item
                  key={scenario.id}
                  value={scenario.id}
                  className={cn(
                    'relative cursor-pointer rounded px-2 py-2 pr-7 outline-none',
                    'data-[highlighted]:bg-raised',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Select.ItemText>
                      <span className="text-xs font-medium text-ink">{scenario.name}</span>
                    </Select.ItemText>
                    {scenario.expectedSeverity ? (
                      <Badge tone={severityTone(scenario.expectedSeverity)} mono>
                        {scenario.expectedSeverity.toUpperCase()}
                      </Badge>
                    ) : (
                      <Badge tone="ok">nominal</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-subtle">
                    {scenario.description}
                  </p>
                  <Select.ItemIndicator className="absolute right-2 top-2.5">
                    <Check className="size-3.5 text-accent" aria-hidden />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  )
}

/** The active scenario's longer explanation, shown under page headers. */
export function ScenarioNarrative() {
  const { scenarioId } = useScenario()
  const { data } = useScenarios()
  const scenario = data?.scenarios.find((entry) => entry.id === scenarioId)
  if (!scenario) return null

  return (
    <p className="max-w-3xl text-xs leading-relaxed text-subtle">
      <span className="font-medium text-muted">{scenario.name}.</span> {scenario.narrative}
    </p>
  )
}
