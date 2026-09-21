import { useEffect, useRef } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { Button, Panel } from '@/components/ui/primitives'
import { OverviewPage } from '@/pages/Overview'
import { TracesPage } from '@/pages/Traces'
import { MetricsPage } from '@/pages/Metrics'
import { IncidentsPage } from '@/pages/Incidents'
import { ObservabilityPage } from '@/pages/Observability'
import { recordRouteRender } from '@/observability'

/**
 * Times each route transition and records it as a histogram.
 *
 * This is the smallest honest example of instrumenting your own UI: the app
 * measures how long its own navigation took and reports it through the same
 * pipeline as everything else. Because it is a real instrument, the number shows
 * up both in the Metrics page and in Prometheus.
 */
function RouteObserver() {
  const location = useLocation()
  const navigationStartedAt = useRef(performance.now())

  useEffect(() => {
    const elapsed = performance.now() - navigationStartedAt.current
    recordRouteRender(location.pathname, elapsed)
    // The next transition's clock starts when this one finishes rendering.
    navigationStartedAt.current = performance.now()
  }, [location.pathname])

  return null
}

export function App() {
  return (
    <>
      <RouteObserver />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="traces" element={<TracesPage />} />
          <Route path="metrics" element={<MetricsPage />} />
          <Route path="incidents" element={<IncidentsPage />} />
          <Route path="observability" element={<ObservabilityPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  )
}

function NotFoundPage() {
  return (
    <Panel className="mx-auto mt-12 flex max-w-lg flex-col items-center gap-3 px-6 py-12 text-center">
      <Compass className="size-6 text-subtle" aria-hidden />
      <h2 className="text-base font-semibold text-ink">No such route</h2>
      <p className="text-sm leading-relaxed text-subtle">
        That URL is not part of the dashboard. The 404 is still a real page view though — the route
        observer recorded it as a metric and the router change as a span.
      </p>
      <Link to="/">
        <Button variant="solid" size="sm">
          Back to overview
        </Button>
      </Link>
    </Panel>
  )
}
