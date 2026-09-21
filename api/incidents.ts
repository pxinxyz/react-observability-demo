import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildIncidents, resolveScenario } from '../simulator'
import type { IncidentsResponse } from '../simulator'
import { methodNotAllowed, queryParam, requestUrl, sendJson } from './_lib/http'

/**
 * GET /api/incidents?scenario=<id>
 *
 * The incident feed: open and historical incidents, each with a timeline and an
 * impact estimate. Derived from the active scenario, so switching scenarios
 * rewrites the estate's recent history.
 *
 * Fabricated, like everything else under `simulator/`.
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === 'OPTIONS') return sendJson(res, 204, null)
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET', 'OPTIONS'])

  const url = requestUrl(req)
  const scenario = resolveScenario(queryParam(url, 'scenario'))

  const body: IncidentsResponse = buildIncidents(scenario, Date.now())

  // Incident timelines move on a two-minute bucket, so a longer cache is safe.
  sendJson(res, 200, body, 30)
}
