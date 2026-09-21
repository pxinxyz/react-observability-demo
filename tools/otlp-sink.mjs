#!/usr/bin/env node
/**
 * A tiny OTLP/HTTP sink.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What this is for
 *
 * The full verification path for this project is `docker compose up -d`, which
 * runs a real OpenTelemetry Collector plus Grafana, Prometheus, Tempo and Loki.
 * That is the right way to check the claims in the README.
 *
 * But Docker is not always available — no daemon, no virtualisation support, a
 * locked-down machine, a CI runner. This script is the fallback: it listens on
 * the standard OTLP/HTTP port, accepts whatever the browser exports, and prints
 * what it received. If spans show up here, the instrumentation and the export
 * pipeline are genuinely working; all that is missing is the backend.
 *
 * It is deliberately dependency-free — Node's standard library only — so it runs
 * on a fresh clone with nothing installed.
 *
 *   node tools/otlp-sink.mjs
 *   # then, in another shell:
 *   VITE_OTLP_ENDPOINT=http://localhost:4318 npm run dev
 *   # open http://localhost:5173 and click around; watch this terminal
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 4318)
const HOST = process.env.HOST ?? '127.0.0.1'

/** OTLP/JSON encodes 64-bit integers as strings, to avoid precision loss. */
const nanosToMs = (value) => {
  if (value === undefined || value === null) return null
  return Number(BigInt(value) / 1_000_000n)
}

/** Flatten OTLP's `{key, value:{stringValue|intValue|boolValue|doubleValue}}`. */
function attributes(list) {
  const out = {}
  for (const item of list ?? []) {
    const value = item.value ?? {}
    if (value.stringValue !== undefined) out[item.key] = value.stringValue
    else if (value.boolValue !== undefined) out[item.key] = value.boolValue
    else if (value.intValue !== undefined) out[item.key] = Number(value.intValue)
    else if (value.doubleValue !== undefined) out[item.key] = value.doubleValue
    else if (value.arrayValue !== undefined) {
      out[item.key] = (value.arrayValue.values ?? []).map((v) => v.stringValue ?? v.intValue).join(',')
    }
    else out[item.key] = JSON.stringify(value)
  }
  return out
}

const reset = '\u001b[0m'
const dim = '\u001b[2m'
const bold = '\u001b[1m'
const cyan = '\u001b[36m'
const green = '\u001b[32m'
const yellow = '\u001b[33m'
const red = '\u001b[31m'
const magenta = '\u001b[35m'

let received = { traces: 0, metrics: 0, logs: 0 }

function reportTraces(body) {
  for (const resourceSpans of body.resourceSpans ?? []) {
    const resource = attributes(resourceSpans.resource?.attributes)
    const service = resource['service.name'] ?? 'unknown_service'

    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      const scope = scopeSpans.scope?.name ?? 'unknown'
      for (const span of scopeSpans.spans ?? []) {
        received.traces += 1
        const start = nanosToMs(span.startTimeUnixNano)
        const end = nanosToMs(span.endTimeUnixNano)
        const durationMs = start !== null && end !== null ? (end - start).toFixed(1) : '?'

        const failed = span.status?.code === 2
        const marker = failed ? `${red}✗${reset}` : `${green}✓${reset}`

        console.log(
          `${marker} ${bold}${span.name}${reset} ${dim}${durationMs}ms${reset}  ` +
            `${cyan}${service}${reset} ${dim}via ${scope}${reset}`,
        )
        console.log(
          `  ${dim}trace=${span.traceId} span=${span.spanId}` +
            `${span.parentSpanId ? ` parent=${span.parentSpanId}` : ' (root)'}${reset}`,
        )

        const attrs = attributes(span.attributes)
        const keys = Object.keys(attrs)
        if (keys.length > 0) {
          const preview = keys
            .slice(0, 6)
            .map((k) => `${k}=${attrs[k]}`)
            .join('  ')
          console.log(`  ${dim}${preview}${keys.length > 6 ? `  (+${keys.length - 6} more)` : ''}${reset}`)
        }

        for (const event of span.events ?? []) {
          console.log(`  ${magenta}event${reset} ${event.name}`)
        }
      }
    }
  }
}

function reportMetrics(body) {
  for (const resourceMetrics of body.resourceMetrics ?? []) {
    for (const scopeMetrics of resourceMetrics.scopeMetrics ?? []) {
      for (const metric of scopeMetrics.metrics ?? []) {
        received.metrics += 1
        const kind = metric.sum ? 'sum' : metric.gauge ? 'gauge' : metric.histogram ? 'histogram' : '?'
        const points =
          metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? metric.histogram?.dataPoints ?? []

        let summary = ''
        if (kind === 'histogram') {
          const count = points.reduce((total, p) => total + Number(p.count ?? 0), 0)
          const sum = points.reduce((total, p) => total + Number(p.sum ?? 0), 0)
          summary = `n=${count} mean=${count > 0 ? (sum / count).toFixed(2) : '—'}`
        } else {
          summary = `value=${points.reduce((total, p) => total + Number(p.asDouble ?? p.asInt ?? 0), 0)}`
        }

        console.log(
          `${green}✓${reset} ${bold}${metric.name}${reset} ${dim}${kind} ${summary}${reset}`,
        )
      }
    }
  }
}

function reportLogs(body) {
  for (const resourceLogs of body.resourceLogs ?? []) {
    const resource = attributes(resourceLogs.resource?.attributes)
    const service = resource['service.name'] ?? 'unknown_service'

    for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
      for (const record of scopeLogs.logRecords ?? []) {
        received.logs += 1
        const severity = record.severityText ?? 'INFO'
        const colour = severity === 'ERROR' ? red : severity === 'WARN' ? yellow : dim
        const body = record.body?.stringValue ?? JSON.stringify(record.body ?? '')

        console.log(
          `${colour}${severity.padEnd(5)}${reset} ${body}  ${dim}${service}` +
            `${record.traceId ? ` trace=${record.traceId}` : ''}${reset}`,
        )
      }
    }
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

const server = createServer(async (request, response) => {
  // The browser posts cross-origin (app on :5173, collector on :4318), so the
  // sink has to answer preflights the way a real collector does.
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  response.setHeader('access-control-allow-headers', '*')
  response.setHeader('access-control-max-age', '86400')

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end()
    return
  }

  const path = (request.url ?? '/').split('?')[0]

  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'text/plain' }).end('Use POST')
    return
  }

  if (!['/v1/traces', '/v1/metrics', '/v1/logs'].includes(path)) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end(`Unknown signal: ${path}`)
    return
  }

  let body
  try {
    body = JSON.parse(await readBody(request))
  } catch (error) {
    console.error(`${red}Could not parse ${path}:${reset} ${error.message}`)
    response.writeHead(400).end('{}')
    return
  }

  const label = path.slice('/v1/'.length)
  console.log(`\n${bold}── ${label} ──${reset}`)

  if (path === '/v1/traces') reportTraces(body)
  else if (path === '/v1/metrics') reportMetrics(body)
  else reportLogs(body)

  // An empty JSON object is the OTLP/JSON success response.
  response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
})

server.listen(PORT, HOST, () => {
  console.log(`${bold}OTLP sink listening on http://${HOST}:${PORT}${reset}`)
  console.log(`${dim}Waiting for /v1/traces, /v1/metrics and /v1/logs…`)
  console.log(`Point the app at it with VITE_OTLP_ENDPOINT=http://${HOST}:${PORT}${reset}`)
  console.log(`${dim}This is a stand-in for the collector, not a replacement for it.`)
  console.log(`It stores nothing and forwards nothing.${reset}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(
      `\n${bold}Received ${received.traces} spans, ${received.metrics} metrics, ${received.logs} log records.${reset}`,
    )
    server.close(() => process.exit(0))
  })
}
