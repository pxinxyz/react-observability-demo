/// <reference types="vite/client" />

/**
 * Injected at build time from `package.json` by `vite.config.ts`, so the
 * `service.version` resource attribute can never drift from the published
 * version.
 */
declare const __APP_VERSION__: string

/**
 * Every knob this app has. One env var is the whole integration:
 * `VITE_OTLP_ENDPOINT`. Everything else has a sane default.
 */
interface ImportMetaEnv {
  /** Base OTLP/HTTP endpoint, e.g. `http://localhost:4318`. Empty => export disabled. */
  readonly VITE_OTLP_ENDPOINT?: string
  /** Optional `key=value,key2=value2` headers, e.g. Grafana Cloud basic auth. */
  readonly VITE_OTLP_HEADERS?: string
  /** `service.name` resource attribute. Defaults to `react-observability-demo`. */
  readonly VITE_SERVICE_NAME?: string
  /** `service.version` resource attribute. Defaults to the build version. */
  readonly VITE_SERVICE_VERSION?: string
  /** `deployment.environment.name` resource attribute. Defaults to the Vite mode. */
  readonly VITE_DEPLOYMENT_ENVIRONMENT?: string
  /** Head sampler ratio, 0..1. Defaults to `1`. */
  readonly VITE_TRACES_SAMPLE_RATE?: string
  /** Metric export interval in ms. Defaults to `10000`. */
  readonly VITE_METRIC_EXPORT_INTERVAL?: string
  /** Optional link to your Grafana, surfaced in the UI as "open in Grafana". */
  readonly VITE_GRAFANA_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
