import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, queryKeys } from '@/api/client'
import { useScenario } from '@/state/scenario'

/**
 * The incident feed.
 *
 * Incident timelines in the simulator move on a two-minute bucket and the API
 * caches for 30s, so polling any faster than this would only burn requests.
 */
export function useIncidents() {
  const { scenarioId } = useScenario()

  return useQuery({
    queryKey: queryKeys.incidents(scenarioId),
    queryFn: () => api.getIncidents(scenarioId),
    refetchInterval: 30_000,
    staleTime: 25_000,
    placeholderData: keepPreviousData,
  })
}
