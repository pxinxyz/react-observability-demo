import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryKeys } from '@/api/client'
import { appLogger, recordInteraction } from '@/observability'
import { useScenario } from '@/state/scenario'

/**
 * Telemetry reads: metrics, traces and the scenario control surface.
 *
 * All of them take the active scenario from context, so every cached entry is
 * namespaced by scenario and switching scenarios refetches instead of serving
 * another world's data.
 */

export function useMetrics(options: { windowMinutes?: number; stepSeconds?: number } = {}) {
  const { scenarioId } = useScenario()
  const windowMinutes = options.windowMinutes ?? 30
  const stepSeconds = options.stepSeconds ?? 30

  return useQuery({
    queryKey: queryKeys.metrics(scenarioId, windowMinutes, stepSeconds),
    queryFn: () => api.getMetrics(scenarioId, { windowMinutes, stepSeconds }),
    refetchInterval: 20_000,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  })
}

export function useTraces(limit = 12) {
  const { scenarioId } = useScenario()

  return useQuery({
    queryKey: queryKeys.traces(scenarioId, limit),
    queryFn: () => api.getTraces(scenarioId, limit),
    refetchInterval: 30_000,
    staleTime: 20_000,
    placeholderData: keepPreviousData,
  })
}

/** The menu of scenarios. Changes rarely, so it is effectively static. */
export function useScenarios() {
  return useQuery({
    queryKey: queryKeys.scenarios(),
    queryFn: () => api.getScenarios(),
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/**
 * Switch the estate into a scenario.
 *
 * The response is a complete estate in one shot, which is used to seed the cache
 * immediately — otherwise switching scenarios would leave every panel showing the
 * previous world until its own query happened to refetch.
 */
export function useSimulate() {
  const queryClient = useQueryClient()
  const { setScenario, beginTransition, endTransition } = useScenario()

  return useMutation({
    mutationFn: (scenarioId: string) => {
      beginTransition()
      return api.simulate(scenarioId).finally(endTransition)
    },
    onSuccess: (result) => {
      const { scenario, services, summary } = result
      setScenario(scenario.id)
      recordInteraction('simulate', scenario.id)

      // Seed everything this response can satisfy, then let the rest refetch.
      queryClient.setQueryData(queryKeys.services(scenario.id), {
        scenarioId: scenario.id,
        generatedAt: summary.generatedAt,
        services,
        summary,
      })

      void queryClient.invalidateQueries({ queryKey: ['metrics', scenario.id] })
      void queryClient.invalidateQueries({ queryKey: ['traces', scenario.id] })
      void queryClient.invalidateQueries({ queryKey: ['incidents', scenario.id] })

      appLogger.info(`scenario switched to ${scenario.id}`, {
        'app.scenario.id': scenario.id,
        'app.scenario.services_total': services.length,
        'app.scenario.services_critical': summary.services.critical,
      })
    },
    onError: (error) => {
      appLogger.error(`scenario switch failed: ${error.message}`, {
        'app.scenario.error': error.message,
      })
    },
  })
}
