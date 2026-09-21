import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The version lives in `package.json` and nowhere else.
 *
 * It used to be duplicated across package.json, .env.example, the README and a
 * fallback inside config.ts, so a release meant editing four files and getting
 * four chances to miss one. Injecting it at build time makes package.json the
 * single source of truth, and the exported `service.version` attribute can no
 * longer drift from the published version.
 */
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string }

/**
 * The routes that exist as Vercel functions in `api/`.
 * Kept in sync with the files on disk by `api/README` discipline rather than
 * by globbing, so a typo fails loudly in dev instead of 404-ing silently.
 */
const API_ROUTES = ['services', 'metrics', 'traces', 'incidents', 'simulate'] as const

/**
 * Serve the Vercel serverless functions from the Vite dev server.
 *
 * This is what makes `git clone && npm run dev` produce a working app without
 * needing `vercel dev`, a Vercel account, or a network connection.
 *
 * The handlers are written against Node's plain `IncomingMessage`/`ServerResponse`,
 * which is exactly what Connect hands us here and exactly what the Vercel Node.js
 * runtime hands them in production. One signature, two runtimes, no adapter layer.
 */
function serverlessApi(): Plugin {
  return {
    name: 'demo:serverless-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '/'
        if (!url.startsWith('/api/')) return next()

        const route = url.split('?')[0]!.slice('/api/'.length).replace(/\/+$/, '')
        if (!(API_ROUTES as readonly string[]).includes(route)) return next()

        void (async () => {
          try {
            // ssrLoadModule gives us on-the-fly TS + HMR for the handlers.
            const mod = (await server.ssrLoadModule(`/api/${route}.ts`)) as {
              default: (req: unknown, res: unknown) => Promise<void> | void
            }
            await mod.default(req, res)
          } catch (error) {
            server.ssrFixStacktrace(error as Error)
            server.config.logger.error(
              `[api] /api/${route} threw: ${(error as Error).message}`,
            )
            if (!res.headersSent) {
              res.statusCode = 500
              res.setHeader('content-type', 'application/json; charset=utf-8')
            }
            res.end(
              JSON.stringify({
                error: 'dev_api_handler_failed',
                route,
                detail: (error as Error).message,
              }),
            )
          }
        })()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serverlessApi()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@simulator': fileURLToPath(new URL('./simulator', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    // The OTel SDK is genuinely large; make the split explicit rather than
    // letting Rollup guess at chunk boundaries.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@opentelemetry')) return 'otel-sdk'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'charts'
          }
          return undefined
        },
      },
    },
  },
})
