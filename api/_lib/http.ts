import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Minimal HTTP helpers shared by every function in `api/`.
 *
 * These are written against Node's own `IncomingMessage` / `ServerResponse`
 * rather than any Vercel-specific type, because that is the one signature that
 * works unchanged in both runtimes this project runs in:
 *
 *   - production: the Vercel Node.js runtime
 *   - development: the Vite dev-server middleware in `vite.config.ts`
 *
 * The upshot is that `api/` has no framework, no dependency, and no adapter.
 */

const MAX_BODY_BYTES = 64 * 1024

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  cacheSeconds = 0,
): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader(
    'cache-control',
    cacheSeconds > 0
      ? `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 4}`
      : 'no-store',
  )
  // The demo is a public artefact; letting people curl these endpoints from
  // anywhere is a feature, not a leak. Nothing here is real.
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.end(payload)
}

export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, status, { error: code, message })
}

export function methodNotAllowed(res: ServerResponse, allowed: readonly string[]): void {
  res.setHeader('allow', allowed.join(', '))
  sendError(res, 405, 'method_not_allowed', `Allowed methods: ${allowed.join(', ')}`)
}

/** Parse the request URL, tolerating a missing host (Vite middleware omits it). */
export function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
}

export function queryParam(url: URL, key: string): string | null {
  const value = url.searchParams.get(key)
  return value === null || value === '' ? null : value
}

/**
 * Read a float query param, clamped to a range.
 * Invalid input falls back to `fallback` rather than erroring — these are
 * read-only demo endpoints and a bad `?limit=` should not be a 400.
 */
export function numberParam(
  url: URL,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = queryParam(url, key)
  if (raw === null) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  // Vercel's Node runtime sometimes pre-parses the body for us.
  const maybeParsed = (req as IncomingMessage & { body?: unknown }).body
  if (maybeParsed !== undefined && maybeParsed !== null) {
    if (typeof maybeParsed === 'string') return JSON.parse(maybeParsed) as T
    return maybeParsed as T
  }

  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buf)
  }

  if (size === 0) return {} as T
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}
