import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildServices, buildTraces, resolveScenario } from '../simulator'
import type { TracesResponse } from '../simulator'
import { methodNotAllowed, numberParam, queryParam, requestUrl, sendJson } from './_lib/http'

/**
 * GET /api/traces?scenario=<id>&limit=<n>
 *
 * Synthesised distributed traces for the fabricated estate, shaped like real
 * OTLP traces so the same waterfall component can render them.
 *
 * The TraceViewer shows these alongside the *real* spans this browser emitted,
 * and labels which is which. These are the fake ones.
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
  const limit = Math.round(numberParam(url, 'limit', 12, 1, 50))

  const body: TracesResponse = buildTraces(scenario, buildServices(scenario, now), limit, now)

  sendJson(res, 200, body, 15)
}
