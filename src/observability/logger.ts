import { context, trace } from '@opentelemetry/api'
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import type { Logger } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import type { LogRecordProcessor, ReadWriteLogRecord } from '@opentelemetry/sdk-logs'
import type { Context } from '@opentelemetry/api'
import { observabilityConfig } from './config'
import { instrumentExporter } from './exportStats'
import type { AttributeValue, LogRecordSnapshot } from './types'
import { buildResource } from './tracing'

/**
 * Logs.
 *
 * Same shape as spans: a real OTLP log pipeline, plus an in-memory tee so the UI
 * can show the stream without querying Loki. Log records emitted inside an active
 * span automatically carry that span's trace and span ids, which is what makes
 * "jump from a log line to its trace" possible.
 */

const LOGGER_NAME = 'react-observability-demo'
const MAX_LOGS = 200

function normalizeAttributes(source: Readonly<Record<string, unknown>> | undefined): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {}
  if (!source) return out
  for (const [key, raw] of Object.entries(source)) {
    if (raw === undefined || raw === null) continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      out[key] = raw
    } else {
      try {
        out[key] = JSON.stringify(raw)
      } catch {
        out[key] = String(raw)
      }
    }
  }
  return out
}

function bodyToString(body: unknown): string {
  if (body === undefined || body === null) return ''
  if (typeof body === 'string') return body
  if (typeof body === 'number' || typeof body === 'boolean') return String(body)
  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

function hrTimeToMs(hrTime: readonly [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1e6
}

class LogStore {
  private records: LogRecordSnapshot[] = []
  private listeners = new Set<() => void>()

  add(record: LogRecordSnapshot): void {
    this.records = [record, ...this.records].slice(0, MAX_LOGS)
    for (const listener of this.listeners) listener()
  }

  /** Stable identity between mutations, for `useSyncExternalStore`. */
  getSnapshot = (): LogRecordSnapshot[] => this.records

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  clear(): void {
    this.records = []
    for (const listener of this.listeners) listener()
  }
}

export const logStore = new LogStore()

/** Tees emitted records into `logStore`. Mirrors the span store's role. */
export class UiLogProcessor implements LogRecordProcessor {
  onEmit(record: ReadWriteLogRecord, _context?: Context): void {
    try {
      const spanContext = record.spanContext
      logStore.add({
        timeMs: hrTimeToMs(record.hrTime),
        severityNumber: record.severityNumber ?? SeverityNumber.UNSPECIFIED,
        severityText: record.severityText ?? severityName(record.severityNumber),
        body: bodyToString(record.body),
        attributes: normalizeAttributes(record.attributes),
        traceId: spanContext?.traceId ?? null,
        spanId: spanContext?.spanId ?? null,
        scopeName: record.instrumentationScope?.name ?? LOGGER_NAME,
      })
    } catch {
      // Never let UI bookkeeping break the logging pipeline.
    }
  }

  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

function severityName(severity: SeverityNumber | undefined): string {
  if (severity === undefined) return 'UNSPECIFIED'
  if (severity >= SeverityNumber.FATAL) return 'FATAL'
  if (severity >= SeverityNumber.ERROR) return 'ERROR'
  if (severity >= SeverityNumber.WARN) return 'WARN'
  if (severity >= SeverityNumber.INFO) return 'INFO'
  if (severity >= SeverityNumber.DEBUG) return 'DEBUG'
  return 'TRACE'
}

let logger: Logger | null = null

export function initLogs(): LoggerProvider {
  const processors: LogRecordProcessor[] = [new UiLogProcessor()]

  if (observabilityConfig.configured && observabilityConfig.endpoints.logs) {
    const exporter = instrumentExporter(
      new OTLPLogExporter({
        url: observabilityConfig.endpoints.logs,
        headers: observabilityConfig.headers,
      }),
      'logs',
    )
    processors.push(new BatchLogRecordProcessor({ exporter, scheduledDelayMillis: 2_000 }))
  }

  const provider = new LoggerProvider({
    resource: buildResource(),
    processors,
  })

  logs.setGlobalLoggerProvider(provider)
  logger = logs.getLogger(LOGGER_NAME, observabilityConfig.serviceVersion)
  return provider
}

function emit(severityNumber: SeverityNumber, body: string, attributes: Record<string, AttributeValue>): void {
  if (!logger) return
  logger.emit({
    severityNumber,
    severityText: severityName(severityNumber),
    body,
    attributes,
    // Capturing the active context is what links a log line to its trace.
    context: context.active(),
  })
}

/**
 * The app's logger. Writes to the console as well as OTLP, because a demo where
 * you cannot see anything in devtools is a worse demo.
 */
export const appLogger = {
  debug(body: string, attributes: Record<string, AttributeValue> = {}): void {
    emit(SeverityNumber.DEBUG, body, attributes)
  },
  info(body: string, attributes: Record<string, AttributeValue> = {}): void {
    emit(SeverityNumber.INFO, body, attributes)
    console.info(`[otel] ${body}`, attributes)
  },
  warn(body: string, attributes: Record<string, AttributeValue> = {}): void {
    emit(SeverityNumber.WARN, body, attributes)
    console.warn(`[otel] ${body}`, attributes)
  },
  error(body: string, attributes: Record<string, AttributeValue> = {}): void {
    emit(SeverityNumber.ERROR, body, attributes)
    console.error(`[otel] ${body}`, attributes)
  },
}

/** Currently active trace id, for correlating UI actions with exported traces. */
export function activeTraceId(): string | null {
  return trace.getActiveSpan()?.spanContext().traceId ?? null
}
