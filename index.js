/**
 * dsh-balance-bar — Host half.
 *
 * The host adds one read-only route so the browser half can obtain the true
 * Beijing-day token total from the local widget ledgers. The browser cannot
 * read those files directly; this route only exposes the aggregate, never the
 * raw file or any credential. The ledger with the most events for today wins
 * (whale and xiaoke keep separate files, so the files must not be summed).
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Services required before the route can be mounted. */
export const inject = ['webServer']

const ROUTE_PATH = '/dsh-balance-bar/usage.json'
const LEDGER_FILES = ['.dshw-usage.json', '.dshxk-usage.json']
const BEIJING_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function usageDir() {
  return typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function errorText(error) {
  return String((error && error.message) || error).slice(0, 240)
}

function summarize(data, day) {
  const events = Array.isArray(data && data.events) ? data.events : []
  let tokens = 0
  let count = 0
  let latest = 0
  for (const event of events) {
    if (event === null || typeof event !== 'object' || event.day !== day) continue
    const value = Number(event.tokens)
    if (!Number.isFinite(value) || value < 0) continue
    tokens += value
    count += 1
    const timestamp = Number(event.ts)
    if (Number.isFinite(timestamp) && timestamp > latest) latest = timestamp
  }
  return { tokens, count, latest }
}

/**
 * Mount the aggregate usage route.
 * @param ctx - host plugin context carrying the webServer service.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        const day = BEIJING_DAY.format(new Date())
        const dir = usageDir()
        const candidates = []
        const errors = []
        for (const file of LEDGER_FILES) {
          try {
            const data = JSON.parse(await readFile(join(dir, file), 'utf8'))
            candidates.push({ file, ...summarize(data, day) })
          } catch (error) {
            errors.push(`${file}: ${errorText(error)}`)
          }
        }
        if (candidates.length === 0) {
          sendJson(res, 200, { ok: false, error: errors.join('; ') || 'no usage ledger found' })
          return
        }
        candidates.sort((a, b) => b.count - a.count || b.latest - a.latest)
        const best = candidates[0]
        sendJson(res, 200, {
          ok: true,
          day,
          tokens: best.count > 0 ? best.tokens : null,
          events: best.count,
          source: best.file,
        })
      } catch (error) {
        sendJson(res, 200, { ok: false, error: errorText(error) })
      }
    },
  }), 'dsh-balance-bar: usage route')
}
