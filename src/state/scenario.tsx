import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_SCENARIO_ID } from '@simulator/scenarios'
import { recordInteraction } from '@/observability'
import { withSpan } from '@/observability'

/**
 * Which scenario the app is currently looking at.
 *
 * This lives in the browser rather than on the server on purpose. Serverless
 * functions have no dependable shared memory — module-scope state works on a warm
 * instance and silently resets on a cold one, which is the worst kind of bug for
 * a demo. So the client owns the selection and passes it to every endpoint as a
 * query parameter. What you see is always what you asked for.
 */

interface ScenarioContextValue {
  scenarioId: string
  setScenario: (id: string) => void
  isPending: boolean
  beginTransition: () => void
  endTransition: () => void
}

const ScenarioContext = createContext<ScenarioContextValue | null>(null)

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [scenarioId, setScenarioId] = useState<string>(DEFAULT_SCENARIO_ID)
  const [pendingCount, setPendingCount] = useState(0)

  const setScenario = useCallback((id: string) => {
    setScenarioId((current) => {
      if (current === id) return current
      // A scenario switch is a user action worth counting, and worth a span:
      // it is the clearest example of "interact with the app, get a trace".
      void withSpan(
        'scenario.switch',
        { 'app.scenario.from': current, 'app.scenario.to': id },
        (span) => {
          span.addEvent('scenario.changed', { to: id })
          recordInteraction('switch-scenario', id)
          return id
        },
      )
      return id
    })
  }, [])

  const beginTransition = useCallback(() => setPendingCount((count) => count + 1), [])
  const endTransition = useCallback(
    () => setPendingCount((count) => Math.max(0, count - 1)),
    [],
  )

  const value = useMemo<ScenarioContextValue>(
    () => ({ scenarioId, setScenario, isPending: pendingCount > 0, beginTransition, endTransition }),
    [scenarioId, setScenario, pendingCount, beginTransition, endTransition],
  )

  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>
}

export function useScenario(): ScenarioContextValue {
  const context = useContext(ScenarioContext)
  if (!context) throw new Error('useScenario must be used inside a <ScenarioProvider>')
  return context
}
