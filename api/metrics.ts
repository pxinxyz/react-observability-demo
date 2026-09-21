import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildMetrics, buildServices, resolveScenario } from '../simulator/index.js'
import type { MetricsResponse } from '../simulator/index.js'
import { methodNotAllowed, numberParam, queryParam, requestUrl, sendJson } from './_lib/http.js'

/**
 * GET /api/metrics?scenario=<id>&window=<minutes>&step=<seconds>
 *
 * Prometheus-style time series for the fabricated estate.
 *
 * These are *not* read back from the running Prometheus inside the LGTM stack.
 * They are generated here. Prometheus in that stack holds the metrics the
 * browser genuinely exported about itself — see `/api/README` and the top-level
 * README for where the line sits.
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

  const windowMinutes = numberParam(url, 'window', 30, 5, 360)
  const stepSeconds = numberParam(url, 'step', 30, 10, 300)

  const body: MetricsResponse = buildMetrics(
    scenario,
    buildServices(scenario, now),
    windowMinutes,
    stepSeconds,
    now,
  )

  sendJson(res, 200, body, 15)
}
