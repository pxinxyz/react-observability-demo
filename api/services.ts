import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildServices, buildSummary, resolveScenario } from '../simulator'
import type { ServicesResponse } from '../simulator'
import { methodNotAllowed, queryParam, requestUrl, sendJson } from './_lib/http'

/**
 * GET /api/services?scenario=<id>
 *
 * The service catalogue plus a live snapshot of each service's health,
 * latency, saturation and error budget.
 *
 * The scenario is supplied by the caller rather than held in server state,
 * because serverless functions have no reliable shared memory. The browser owns
 * "which scenario am I looking at" and passes it down; see `src/api/client.ts`.
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === 'OPTIONS') return sendJson(res, 204, null)
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET', 'OPTIONS'])

  const url = requestUrl(req)
  const scenario = resolveScenario(queryParam(url, 'scenario'))
  const now = Date.now()

  const services = buildServices(scenario, now)

  const body: ServicesResponse = {
    scenarioId: scenario.id,
    generatedAt: new Date(now).toISOString(),
    services,
    summary: buildSummary(scenario, services, 60, now),
  }

  // Short cache: the estate only changes every 15s, so a CDN hit is still fresh.
  sendJson(res, 200, body, 10)
}
