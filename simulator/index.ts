/**
 * The simulated estate.
 *
 * FABRICATED DATA. See the header comment in `types.ts` before you believe
 * anything this module produces.
 *
 * This lives at the repository root rather than under `src/` because it is
 * shared by two consumers that must agree exactly:
 *
 *   - `api/`  — the Vercel functions that serve it over HTTP
 *   - `src/`  — the React app, which imports the *types* so the client boundary
 *               is typed against the same contract the server implements
 *
 * It is deliberately not a service: no state, no clock of its own, no I/O.
 * Every function takes `now` and returns plain JSON-serialisable objects.
 */
export type * from './types.js'

export { SERVICE_CATALOG, SERVICE_BY_ID, EDGE_SERVICE_ID } from './catalog.js'
export { SCENARIOS, DEFAULT_SCENARIO_ID, resolveScenario, isScenarioId } from './scenarios.js'
export {
  buildServices,
  buildSummary,
  buildMetrics,
  buildTraces,
  buildIncidents,
  buildEstate,
} from './engine.js'
