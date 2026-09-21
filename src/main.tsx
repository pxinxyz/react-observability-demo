import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Tooltip from '@radix-ui/react-tooltip'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { ScenarioProvider } from './state/scenario'
import { initObservability } from './observability'
import './index.css'

/**
 * Instrument first, render second.
 *
 * `initObservability()` registers the tracer provider and patches fetch, the
 * document-load lifecycle and click handling *before* React mounts, so the very
 * first paint is already observed. Doing this inside a `useEffect` would miss the
 * page load, which is the single most interesting trace a frontend produces.
 */
initObservability()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The estate is generated, not read from something fragile. One retry rides
      // out a cold serverless start; more would only add latency to a demo.
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
      // Background tabs should not keep polling.
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
    mutations: {
      retry: 0,
    },
  },
})

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container #root was not found in index.html')
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={200} skipDelayDuration={300}>
        <ScenarioProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ScenarioProvider>
      </Tooltip.Provider>
    </QueryClientProvider>
  </StrictMode>,
)
