/**
 * dsh-balance-bar — Host half.
 *
 * Serves one read-only aggregate route so the browser half can render the bar
 * without touching any other plugin:
 *
 * - balance comes from DSH's own `deepseekAccount` service (the signed-in
 *   account wallet plus granted bonus wallet, summed like the platform does);
 * - peak / off-peak comes from the official DeepSeek pricing rules kept below,
 *   so the bar no longer depends on dsh-whale-widget or dsh-xiaoke-widget;
 * - today's token total is folded from this Host's own session logs, so it is
 *   independent of the companion widgets as well.
 *
 * The route never exposes credentials or raw session data.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Services required before the route can be mounted. */
export const inject = ['webServer']

const ROUTE_PATH = '/dsh-balance-bar/usage.json'

/* --------------------------------------------------------------- pricing rules */

/**
 * 官方计费规则（北京时间）。
 * - 高峰：周一至周五 09:00–12:00、14:00–18:00（不含中国法定节假日）；
 * - 其余时段，包括周末与法定节假日全天，均为空闲（谷价）；
 * - 2026-08-23 起周末全天按谷价计费；
 * - 2026-09-19 起法定节假日全天按谷价计费。
 */
const PEAK_HOURS = [[9, 12], [14, 18]]
const BEIJING_OFFSET_MS = 8 * 3600 * 1000
const WEEKEND_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000)
const HOLIDAY_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 8, 18, 16, 0, 0) / 1000)

/**
 * 法定节假日放假日（全天谷价）。只列放假日，调休上班日都落在周末，本就按谷价。
 * 每年国务院公布次年安排后在这里补下一年的日期。
 */
const HOLIDAY_VALLEY = {
  '2026-01-01': 1, '2026-01-02': 1, '2026-01-03': 1,
  '2026-02-15': 1, '2026-02-16': 1, '2026-02-17': 1, '2026-02-18': 1, '2026-02-19': 1,
  '2026-02-20': 1, '2026-02-21': 1, '2026-02-22': 1, '2026-02-23': 1,
  '2026-04-04': 1, '2026-04-05': 1, '2026-04-06': 1,
  '2026-05-01': 1, '2026-05-02': 1, '2026-05-03': 1, '2026-05-04': 1, '2026-05-05': 1,
  '2026-06-19': 1, '2026-06-20': 1, '2026-06-21': 1,
  '2026-09-25': 1, '2026-09-26': 1, '2026-09-27': 1,
  '2026-10-01': 1, '2026-10-02': 1, '2026-10-03': 1, '2026-10-04': 1,
  '2026-10-05': 1, '2026-10-06': 1, '2026-10-07': 1,
}

/** 北京时间的日历日 key（YYYY-MM-DD）。 */
function beijingDayKey(ms) {
  return new Date(ms + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 官方模型基础价（元 / 百万 token），形如 { 缓存命中, 未命中输入, 输出 }。
 * DeepSeek-V4.1-Flash 即 deepseek-flash：空闲时段为命中 0.02 / 未命中 1 / 输出 4，
 * 高峰时段在此基础上约减半（官方峰谷定价）。
 */
const VALLEY_PRICE = { cacheRead: 0.02, uncached: 1, output: 4 }
const PEAK_PRICE = { cacheRead: 0.01, uncached: 0.5, output: 2 }

function isPeakAt(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n)) return false
  const shifted = new Date(n * 1000 + BEIJING_OFFSET_MS)
  if (n >= WEEKEND_VALLEY_FROM_SEC) {
    const weekday = shifted.getUTCDay()
    if (weekday === 0 || weekday === 6) return false
  }
  if (n >= HOLIDAY_VALLEY_FROM_SEC && HOLIDAY_VALLEY[shifted.toISOString().slice(0, 10)]) return false
  const hour = shifted.getUTCHours()
  return PEAK_HOURS.some(([start, end]) => hour >= start && hour < end)
}

/** 下一个峰谷切换时刻（epoch 秒）；与 isPeakAt 完全同源。 */
function nextPeakChangeAt(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n)) return null
  const current = isPeakAt(n)
  const dayStart = Math.floor((n + 8 * 3600) / 86400) * 86400
  for (let day = 0; day <= 12; day++) {
    for (const edge of [0, 9, 12, 14, 18]) {
      const candidate = dayStart + day * 86400 + edge * 3600 - 8 * 3600
      if (candidate <= n + 1) continue
      if (isPeakAt(candidate) !== current) return candidate
    }
  }
  return null
}

/* ------------------------------------------------------------------- helpers */

function homeDir() {
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

function toFiniteNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/* ---------------------------------------------------------------- account */

function clientMetadata() {
  return {
    version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
    locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/**
 * 从 DSH 自带的账户服务读取钱包余额。
 * 账户服务是可选依赖：没登录或服务缺席时返回错误文本，由前端降级显示「—」。
 */
async function readAccountBalance(ctx) {
  const account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : undefined
  if (!account || typeof account.getBalance !== 'function') {
    return { ok: false, error: '\u5F53\u524D DSH \u6CA1\u6709\u8D26\u53F7\u670D\u52A1' }
  }
  let state = null
  try {
    state = typeof account.getState === 'function' ? await account.getState() : null
  } catch {
    state = null
  }
  if (state && state.status === 'signed-out') {
    return { ok: false, error: '\u5C1A\u672A\u767B\u5F55 DeepSeek \u8D26\u53F7' }
  }
  let details = null
  try {
    details = await account.getBalance(clientMetadata())
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
  // getBalance 直接返回 balance 对象：{ status, value, bonusWallets }。
  // 兼容未来可能包一层 details.balance 的形状。
  const result = details && details.balance ? details.balance : details
  if (!result || result.status !== 'ready') {
    const status = result ? String(result.status) : 'none'
    return { ok: false, error: `\u8D26\u53F7\u4F59\u989D\u67E5\u8BE2\u5931\u8D25 (status=${status})` }
  }
  const wallets = Array.isArray(result.value) ? result.value : []
  const bonus = Array.isArray(result.bonusWallets) ? result.bonusWallets : []
  // 与平台口径一致：充值余额 + 赠金余额；多币种时优先人民币。
  const pick = (list, currency) => list.find((wallet) => wallet && wallet.currency === currency)
  const currency = pick(wallets, 'CNY') ? 'CNY' : pick(bonus, 'CNY') ? 'CNY' : wallets[0] ? wallets[0].currency : 'CNY'
  const recharge = toFiniteNumber(pick(wallets, currency)?.balance) ?? 0
  const granted = toFiniteNumber(pick(bonus, currency)?.balance) ?? 0
  const total = recharge + granted
  return {
    ok: true,
    balance: Number(total.toFixed(6)),
    currency,
    recharge,
    bonus: granted,
    updatedAt: new Date().toISOString(),
  }
}

/* ------------------------------------------------------------ today's tokens */

function usageDir() {
  return homeDir()
}

function usageFiles() {
  return ['.dshw-usage.json', '.dshxk-usage.json']
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
 * 今日累计 token：优先读本机会话日志（不依赖任何小组件）。
 * 日志里的 assistant/message 事件带真实 usage，按北京时间当天过滤后求和。
 */
function sessionRoots() {
  const roots = []
  const explicit = typeof process.env.DSH_SESSIONS_DIR === 'string' ? process.env.DSH_SESSIONS_DIR.trim() : ''
  if (explicit) roots.push(explicit)
  roots.push(join(homeDir(), 'sessions'))
  return roots
}

let todayTokensCache = { at: 0, day: '', value: null, cost: null, source: '' }

/** 读取 DSH 会话日志（可能是 zstd 分帧压缩的 JSONL）并返回其中的事件行。 */
async function readSessionEvents(file) {
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return []
  }
  // 压缩日志：按 zstd 魔数切帧逐段解压。
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const raw = await readFile(file)
  const offsets = []
  for (let i = 0; i <= raw.length - 4; i++) {
    if (raw[i] === magic[0] && raw[i + 1] === magic[1] && raw[i + 2] === magic[2] && raw[i + 3] === magic[3]) offsets.push(i)
  }
  if (offsets.length > 0) {
    const { zstdDecompressSync } = await import('node:zlib')
    let decoded = ''
    for (let k = 0; k < offsets.length; k++) {
      const start = offsets[k]
      const end = k + 1 < offsets.length ? offsets[k + 1] : raw.length
      try {
        decoded += zstdDecompressSync(raw.subarray(start, end)).toString('utf8')
      } catch {
        // 跳过损坏帧
      }
    }
    if (decoded !== '') text = decoded
  }
  const events = []
  for (const line of text.split('\n')) {
    if (!line || !line.includes('assistant/message')) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // 跳过坏行
    }
  }
  return events
}

async function readTodayTokens() {
  const now = Date.now()
  const day = beijingDayKey(now)
  if (todayTokensCache.day === day && now - todayTokensCache.at < 25_000) {
    return { tokens: todayTokensCache.value, cost: todayTokensCache.cost, source: todayTokensCache.source }
  }

  // 本机会话日志：assistant/message 事件带真实 usage，按北京时区当天过滤求和。
  // 每条请求按其发生时刻的峰谷价格计费，因此换模型、跨峰谷都不会错算。
  try {
    const { readdir } = await import('node:fs/promises')
    let tokens = 0
    let cost = 0
    let priced = 0
    let scanned = 0
    for (const root of sessionRoots()) {
      if (!existsSync(root)) continue
      let projects = []
      try {
        projects = await readdir(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const project of projects) {
        if (!project.isDirectory()) continue
        const projectDir = join(root, project.name)
        let sessions = []
        try {
          sessions = await readdir(projectDir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const session of sessions) {
          if (!session.isDirectory()) continue
          for (const name of ['session.v4.jsonl.zstd', 'session.v4.jsonl', 'session.jsonl']) {
            const file = join(projectDir, session.name, name)
            if (!existsSync(file)) continue
            scanned += 1
            for (const event of await readSessionEvents(file)) {
              if (event.type !== 'assistant/message' || !event.data || !event.data.usage) continue
              const time = toFiniteNumber(event.time)
              if (time === null || beijingDayKey(time) !== day) continue
              const usage = event.data.usage
              const value = toFiniteNumber(usage.totalTokens)
                ?? ((toFiniteNumber(usage.inputTokens) ?? 0)
                  + (toFiniteNumber(usage.outputTokens) ?? 0)
                  + (toFiniteNumber(usage.cacheReadTokens) ?? 0))
              if (value === null || value <= 0) continue
              tokens += value
              priced += 1
              // 按该请求发生时刻的高峰 / 空闲单价计费
              const price = isPeakAt(Math.floor(time / 1000)) ? PEAK_PRICE : VALLEY_PRICE
              cost += (
                (toFiniteNumber(usage.cacheReadTokens) ?? 0) * price.cacheRead
                + (toFiniteNumber(usage.inputTokens) ?? 0) * price.uncached
                + (toFiniteNumber(usage.outputTokens) ?? 0) * price.output
              ) / 1e6
            }
          }
        }
      }
    }
    if (scanned > 0 && tokens > 0) {
      const rounded = Number(cost.toFixed(6))
      todayTokensCache = { at: now, day, value: tokens, cost: rounded, source: 'session-logs' }
      return { tokens, cost: rounded, source: 'session-logs' }
    }
  } catch {
    // 落到小组件账本兜底
  }

  // 2) 兜底：小组件账本（若存在）
  const candidates = []
  for (const file of usageFiles()) {
    try {
      const data = JSON.parse(await readFile(join(usageDir(), file), 'utf8'))
      candidates.push({ file, ...summarize(data, day) })
    } catch {
      // 文件不存在就跳过
    }
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.count - a.count || b.latest - a.latest)
    const best = candidates[0]
    const value = best.count > 0 ? best.tokens : null
    todayTokensCache = { at: now, day, value, cost: null, source: best.file }
    return { tokens: value, cost: null, source: best.file }
  }

  todayTokensCache = { at: now, day, value: null, cost: null, source: '' }
  return { tokens: null, cost: null, source: '' }
}

/* ------------------------------------------------------------------ route */

/**
 * 首次扫描会话日志较慢（数秒），所以：
 * - 有当日缓存时立即返回缓存值，并在后台异步刷新；
 * - 没有缓存时最多等待一小段时间，拿不到就先返回 null 并继续在后台算。
 * 这样接口永远不会把浏览器端的请求拖到超时。
 */
let todayTokensInFlight = null

function startTodayTokensRefresh() {
  if (todayTokensInFlight) return todayTokensInFlight
  todayTokensInFlight = readTodayTokens()
    .catch(() => null)
    .finally(() => {
      todayTokensInFlight = null
    })
  return todayTokensInFlight
}

async function currentTodayTokens() {
  const day = beijingDayKey(Date.now())
  if (todayTokensCache.day === day && todayTokensCache.value !== null) {
    // 有当日缓存：直接返回，同时后台刷新
    startTodayTokensRefresh()
    return { tokens: todayTokensCache.value, cost: todayTokensCache.cost, source: todayTokensCache.source }
  }
  // 没有当日缓存：最多等 8 秒（首次全量扫描较慢），超时先回 null，后台继续算
  const pending = startTodayTokensRefresh()
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000))
  const raced = await Promise.race([pending, timeout])
  if (raced === 'timeout') {
    return {
      tokens: todayTokensCache.day === day ? todayTokensCache.value : null,
      cost: todayTokensCache.day === day ? todayTokensCache.cost : null,
      source: todayTokensCache.source,
      pending: true,
    }
  }
  return raced || { tokens: null, cost: null, source: '' }
}

async function handleUsage(ctx, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  const nowSec = Math.floor(Date.now() / 1000)
  const isPeak = isPeakAt(nowSec)
  const nextChange = nextPeakChangeAt(nowSec)

  const [account, today] = await Promise.all([
    readAccountBalance(ctx),
    currentTodayTokens().catch((error) => ({ tokens: null, cost: null, source: '', error: errorText(error) })),
  ])

  sendJson(res, 200, {
    ok: account.ok === true,
    ...(account.ok === true
      ? {
          balance: account.balance,
          currency: account.currency,
          rechargeBalance: account.recharge,
          bonusBalance: account.bonus,
          updatedAt: account.updatedAt,
        }
      : { error: account.error || '\u4F59\u989D\u4E0D\u53EF\u7528' }),
    isPeak,
    peakNextChangeAt: nextChange,
    todayTokens: today.tokens,
    todayUsage: today.cost ?? null,
    todayTokensSource: today.source,
    // 首次扫描尚未完成时告知前端「稍后重试」，避免把它当成「今天没用过」。
    todayPending: today.pending === true,
    serverTime: nowSec,
  })
}

/**
 * Mount the aggregate route.
 * @param ctx - host plugin context carrying the webServer service.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (req, res) => handleUsage(ctx, req, res),
  }), 'dsh-balance-bar: usage route')
}

// 供测试与诊断使用（不注册任何对外接口）。
export const internals = { isPeakAt, nextPeakChangeAt, beijingDayKey }
