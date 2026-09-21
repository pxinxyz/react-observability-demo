import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  DEFAULT_SCENARIO_ID,
  SCENARIOS,
  buildEstate,
  isScenarioId,
  resolveScenario,
} from '../simulator/index.js'
import type { ScenariosResponse, SimulationResult } from '../simulator/index.js'
import {
  methodNotAllowed,
  queryParam,
  readJsonBody,
  requestUrl,
  sendError,
  sendJson,
} from './_lib/http.js'

/**
 * /api/simulate — the scenario control surface.
 *
 *   GET  /api/simulate            → the catalogue of available scenarios
 *   POST /api/simulate {id}       → the whole estate under that scenario
 *
 * Deliberately stateless. An earlier design kept "the active scenario" in module
 * scope, which works on a warm serverless instance and silently fails on a cold
 * one — the worst possible bug class for a demo. Instead the browser owns the
 * selection (`ScenarioProvider` in the app) and passes `?scenario=` to every
 * other endpoint, so what you see is always what you asked for.
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === 'OPTIONS') return sendJson(res, 204, null)

  if (req.method === 'GET') {
    const scenario = resolveScenario(queryParam(requestUrl(req), 'scenario'))
    const body: ScenariosResponse = {
      generatedAt: new Date().toISOString(),
      defaultScenarioId: DEFAULT_SCENARIO_ID,
      scenarios: [...SCENARIOS],
    }
    return sendJson(res, 200, { ...body, activeScenarioId: scenario.id }, 60)
  }

  if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST', 'OPTIONS'])

  let requestedId: unknown
  try {
    const body = await readJsonBody<{ scenarioId?: unknown }>(req)
    requestedId = body.scenarioId
  } catch {
    return sendError(res, 400, 'invalid_body', 'Expected a JSON body: { "scenarioId": string }')
  }

  if (typeof requestedId !== 'string' || !isScenarioId(requestedId)) {
    return sendError(
      res,
      400,
      'unknown_scenario',
      `Unknown scenarioId. Expected one of: ${SCENARIOS.map((s) => s.id).join(', ')}`,
    )
  }

  const { scenario, services, summary } = buildEstate(requestedId)

  const result: SimulationResult = { scenario, services, summary }
  sendJson(res, 200, result)
}
