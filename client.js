/**
 * dsh-balance-bar — Client half.
 *
 * The host provides no slot between the sidebar brand row and the new-session
 * button, so this module inserts its own node into the sidebar DOM and keeps it
 * mounted across React re-renders with a document-wide MutationObserver.
 * No Harness Client UI package is imported.
 */
window.__ModuleLoader__.load({
  id: 'dsh-balance-bar',
  factory() {
    const STYLE_ID = 'dsh-balance-bar-style'
    const MARKER = 'data-my-balance-attach'
    // 单一数据源：本插件的宿主半。余额来自 DSH 账户服务，峰谷由宿主按官方规则计算，
    // 今日 token 由宿主持久化日志汇总 —— 不再依赖 dsh-whale-widget / dsh-xiaoke-widget。
    const DATA_URL = '/dsh-balance-bar/usage.json'
    const REFRESH_MS = 60_000
    const REQUEST_TIMEOUT_MS = 20_000
    const BEIJING_CLOCK = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })

    const CSS = `
.dsh-balance-bar {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 2px 12px 10px;
  font-family: inherit;
  color: var(--dsw-alias-label-primary);
  cursor: default;
  user-select: none;
  overflow: hidden;
}
.dsh-balance-bar__head {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-balance-bar__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-deep-diving, #5686fe);
}
.dsh-balance-bar__label {
  white-space: nowrap;
}
.dsh-balance-bar__amount {
  flex: none;
  font-size: 14px;
  line-height: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}
.dsh-balance-bar__amount[data-tone="warn"] {
  color: #f59e0b;
}
.dsh-balance-bar__amount[data-tone="danger"] {
  color: #e5484d;
}
.dsh-balance-bar__extra {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsh-balance-bar__period {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsh-balance-bar__sep {
  color: var(--dsw-alias-label-secondary);
  opacity: 0.65;
}
.dsh-balance-bar__peak {
  color: var(--dsw-alias-label-secondary);
}
.dsh-balance-bar__peak[data-state="idle"] {
  color: #22a06b;
}
.dsh-balance-bar__peak[data-state="peak"] {
  color: #f59e0b;
}
.dsh-balance-bar__switch {
  color: var(--dsw-alias-label-secondary);
}
[data-sidebar-collapsed="true"] [data-my-balance-attach] {
  display: none !important;
}
`

    const ZH = {
      balance: '\u4F59\u989D:',
      today: '\u4ECA\u65E5',
      tokenUnit: 'tok',
      idle: '\u7A7A\u95F2\u65F6\u6BB5',
      peak: '\u9AD8\u5CF0\u65F6\u6BB5',
    }
    const EN = {
      balance: 'Balance:',
      today: 'Today',
      tokenUnit: 'tok',
      idle: 'Idle',
      peak: 'Peak',
    }

    function toFiniteNumber(value) {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
      }
      return null
    }

    function formatMoney(value) {
      return value === null ? '\u2014' : `\u00A5${value.toFixed(2)}`
    }

    function formatBalance(value) {
      return value === null ? '\u2014' : `${value.toFixed(2)}\uFFE5`
    }

    function formatTokens(value) {
      if (value === null) return '\u2014'
      return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value))}`
    }

    function formatCountdown(epochSeconds) {
      if (epochSeconds === null) return { countdown: '', text: '' }
      const target = epochSeconds * 1000
      if (!Number.isFinite(target)) return { countdown: '', text: '' }
      const totalSeconds = Math.max(0, Math.ceil((target - Date.now()) / 1000))
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      const countdown = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      const clock = BEIJING_CLOCK.format(new Date(target))
      return { countdown, text: `${countdown} (${clock})` }
    }

    function createTranslator(ctx) {
      const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
      if (!locale || typeof locale.bind !== 'function') {
        return { translate: (key) => ZH[key] ?? key, dispose: () => {} }
      }
      const disposers = []
      for (const [id, dict] of [['zh', ZH], ['en', EN]]) {
        try {
          if (typeof locale.register === 'function') disposers.push(locale.register('dsh-balance-bar', id, dict))
        } catch {
          // A previous generation already owns this namespace; its disposer
          // removes it on HMR. Falling through keeps the bar usable.
        }
      }
      let translate
      try {
        const bound = locale.bind('dsh-balance-bar')
        translate = (key) => {
          try {
            const value = bound(key)
            return typeof value === 'string' && value !== '' && value !== key ? value : (ZH[key] ?? key)
          } catch {
            return ZH[key] ?? key
          }
        }
      } catch {
        translate = (key) => ZH[key] ?? key
      }
      return {
        translate,
        dispose: () => {
          for (const disposer of disposers) {
            try { disposer() } catch { /* already removed */ }
          }
        },
      }
    }

    function createNode(doc, tag, className, text) {
      const node = doc.createElement(tag)
      if (className) node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }

    function mount(ctx) {
      const doc = document
      let disposed = false
      let root = null
      let label = null
      let amount = null
      let today = null
      let tokens = null
      let peak = null
      let switchEl = null
      let styleEl = null
      let observer = null
      let resizeObserver = null
      let interval = null
      let countdownTimer = null
      let countdownExpiredAt = 0
      let ensureTimer = null
      let quickTimer = null
      let inFlight = false
      let controller = null
      let timeoutTimer = null
      const locale = createTranslator(ctx)
      const t = locale.translate
      const state = {
        balance: null,
        todayUsage: null,
        isPeak: null,
        nextChangeAt: null,
        todayTokens: null,
        todayScanned: false,
        tokens: null,
        error: '',
      }

      function ensureStyle() {
        const existing = doc.getElementById(STYLE_ID)
        if (existing) return existing
        const style = doc.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        doc.head.appendChild(style)
        return style
      }

      function findAnchor() {
        const direct = doc.querySelector('button[class*="newSession"]')
        if (direct) return direct
        const any = doc.querySelector('[class*="newSession"]')
        return any ? (any.closest('button') || any) : null
      }

      function build() {
        const node = doc.createElement('div')
        node.className = 'dsh-balance-bar'
        node.setAttribute(MARKER, 'true')
        node.setAttribute('role', 'group')

        const head = createNode(doc, 'div', 'dsh-balance-bar__head')
        const dot = createNode(doc, 'span', 'dsh-balance-bar__dot')
        dot.setAttribute('aria-hidden', 'true')
        label = createNode(doc, 'span', 'dsh-balance-bar__label', t('balance'))
        amount = createNode(doc, 'span', 'dsh-balance-bar__amount', '\u2014')
        head.append(dot, label, amount)

        const extra = createNode(doc, 'div', 'dsh-balance-bar__extra')
        today = createNode(doc, 'span', 'dsh-balance-bar__today')
        const sep1 = createNode(doc, 'span', 'dsh-balance-bar__sep', '\u00B7')
        sep1.setAttribute('aria-hidden', 'true')
        tokens = createNode(doc, 'span', 'dsh-balance-bar__tokens')
        extra.append(today, sep1, tokens)

        const period = createNode(doc, 'div', 'dsh-balance-bar__period')
        peak = createNode(doc, 'span', 'dsh-balance-bar__peak', '\u2014')
        switchEl = createNode(doc, 'span', 'dsh-balance-bar__switch')
        switchEl.hidden = true
        period.append(peak, switchEl)

        node.append(head, extra, period)
        return node
      }

      function ensureMounted() {
        if (disposed) return
        const anchor = findAnchor()
        if (!anchor || !anchor.parentElement) return
        const existing = doc.querySelector(`[${MARKER}]`)
        if (existing && existing !== root) {
          if (root && root.isConnected) root.remove()
          root = existing
        }
        if (!root) {
          root = build()
          styleEl = ensureStyle()
        }
        if (root.parentElement !== anchor.parentElement || root.nextElementSibling !== anchor) {
          anchor.parentElement.insertBefore(root, anchor)
        }
      }

      function scheduleEnsure() {
        if (disposed || ensureTimer !== null) return
        ensureTimer = window.setTimeout(() => {
          ensureTimer = null
          ensureMounted()
        }, 60)
      }

      function updateCountdown() {
        if (!switchEl || disposed) return
        const formatted = state.isPeak === null || state.nextChangeAt === null
          ? { countdown: '', text: '' }
          : formatCountdown(state.nextChangeAt)
        switchEl.hidden = formatted.text === ''
        switchEl.textContent = formatted.text
        if (formatted.countdown === '00:00:00') {
          const now = Date.now()
          if (now - countdownExpiredAt > 10_000 && !inFlight) {
            countdownExpiredAt = now
            refresh()
          }
        }
      }

      function render() {
        if (!root || disposed) return
        label.textContent = t('balance')

        const balanceText = formatBalance(state.balance)
        amount.textContent = balanceText
        amount.dataset.tone = state.balance === null ? 'normal' : state.balance <= 1 ? 'danger' : state.balance <= 5 ? 'warn' : 'normal'

        // 今日花费：扫描已完成但没有记录时显示 ¥0.00；扫描尚未完成才显示「—」。
        const todayCost = state.todayScanned && state.todayUsage === null ? 0 : state.todayUsage
        const todayTokens = state.todayScanned && state.tokens === null ? 0 : state.tokens
        today.textContent = `${t('today')} ${formatMoney(todayCost)}`
        tokens.textContent = todayTokens === null ? '\u2014' : `${formatTokens(todayTokens)} ${t('tokenUnit')}`
        tokens.title = ''

        if (state.isPeak === true) {
          peak.textContent = t('peak')
          peak.dataset.state = 'peak'
        } else if (state.isPeak === false) {
          peak.textContent = t('idle')
          peak.dataset.state = 'idle'
        } else {
          peak.textContent = '\u2014'
          peak.dataset.state = 'unknown'
        }

        updateCountdown()
        const switchText = switchEl.textContent

        root.title = state.error
        const tokenText = todayTokens === null ? '\u2014' : `${formatTokens(todayTokens)} ${t('tokenUnit')}`
        const switchSuffix = switchText === '' ? '' : ` ${switchText}`
        root.setAttribute('aria-label', `${t('balance')} ${balanceText}, ${t('today')} ${formatMoney(state.todayUsage)}, ${tokenText}, ${peak.textContent}${switchSuffix}`)
      }

      async function fetchJson(url, signal) {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
        try {
          return await response.json()
        } catch {
          return null
        }
      }

      function failureText(result) {
        if (result.status === 'rejected') {
          const reason = result.reason
          const message = reason && reason.message ? reason.message : String(reason)
          return message.length > 200 ? message.slice(0, 200) : message
        }
        const value = result.value
        if (value && typeof value === 'object') {
          const message = value.error || value.message
          if (typeof message === 'string' && message !== '') return message.slice(0, 200)
        }
        return '\u4F59\u989D\u63A5\u53E3\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u6570\u636E'
      }

      async function refresh() {
        if (disposed || inFlight) return
        inFlight = true
        controller = new AbortController()
        timeoutTimer = window.setTimeout(() => controller && controller.abort(), REQUEST_TIMEOUT_MS)
        try {
          const result = await Promise.allSettled([fetchJson(DATA_URL, controller.signal)])
          if (disposed) return
          const response = result[0]
          const data = response.status === 'fulfilled' ? response.value : null

          if (data && typeof data === 'object') {
            // 余额：宿主已经从 DSH 账户服务取到；ok:false 表示未登录或查询失败。
            const balance = toFiniteNumber(data.balance)
            state.balance = data.ok === true && balance !== null ? balance : null
            state.error = data.ok === true ? '' : String(data.error || '\u4F59\u989D\u4E0D\u53EF\u7528')
            // 峰谷：宿主按官方规则算好，前端不再推算。
            state.isPeak = typeof data.isPeak === 'boolean' ? data.isPeak : null
            state.nextChangeAt = toFiniteNumber(data.peakNextChangeAt)
            // 今日累计 token 与花费：宿主汇总本机会话日志并按当时价格计费。
            state.todayTokens = toFiniteNumber(data.todayTokens)
            state.tokens = state.todayTokens
            state.todayUsage = toFiniteNumber(data.todayUsage)
            // 扫描完成（非 pending）才允许把「没有记录」显示成 0。
            state.todayScanned = data.todayPending !== true
            // 首次扫描尚未完成 → 稍后快速重试，不能当成「今天没用过」显示 0。
            if (data.todayPending === true) scheduleQuickRefresh()
          } else {
            state.balance = null
            state.todayUsage = null
            state.isPeak = null
            state.nextChangeAt = null
            state.todayTokens = null
            state.todayScanned = false
            state.tokens = null
            state.error = response.status === 'rejected' ? failureText(response) : '\u4F59\u989D\u63A5\u53E3\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u6570\u636E'
          }

          render()
        } finally {
          if (timeoutTimer !== null) {
            window.clearTimeout(timeoutTimer)
            timeoutTimer = null
          }
          controller = null
          inFlight = false
        }
      }

      /** 首次日志扫描未完成时，短暂等待后立即重试，而不是等到 60 秒后的常规轮询。 */
      function scheduleQuickRefresh() {
        if (disposed || quickTimer !== null) return
        quickTimer = window.setTimeout(() => {
          quickTimer = null
          if (!disposed && !doc.hidden) refresh()
        }, 2500)
      }

      function startInterval() {
        if (disposed || interval !== null) return
        interval = window.setInterval(() => {
          if (!doc.hidden) refresh()
        }, REFRESH_MS)
      }

      function stopInterval() {
        if (interval === null) return
        window.clearInterval(interval)
        interval = null
      }

      function startCountdown() {
        if (disposed || countdownTimer !== null) return
        countdownTimer = window.setInterval(updateCountdown, 1000)
      }

      function stopCountdown() {
        if (countdownTimer === null) return
        window.clearInterval(countdownTimer)
        countdownTimer = null
      }

      function onVisibilityChange() {
        if (doc.hidden) {
          stopInterval()
          stopCountdown()
        } else {
          updateCountdown()
          refresh()
          startInterval()
          startCountdown()
        }
      }

      styleEl = ensureStyle()
      ensureMounted()
      render()
      refresh()
      if (!doc.hidden) {
        startInterval()
        startCountdown()
      }

      observer = new MutationObserver(scheduleEnsure)
      observer.observe(doc.documentElement, { childList: true, subtree: true })

      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(scheduleEnsure)
        resizeObserver.observe(doc.documentElement)
      }

      doc.addEventListener('visibilitychange', onVisibilityChange)

      const unsubscribeLocale = (() => {
        const service = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        if (!service || typeof service.subscribe !== 'function') return () => {}
        try {
          return service.subscribe(() => render())
        } catch {
          return () => {}
        }
      })()

      return () => {
        disposed = true
        stopInterval()
        stopCountdown()
        if (ensureTimer !== null) {
          window.clearTimeout(ensureTimer)
          ensureTimer = null
        }
        if (quickTimer !== null) {
          window.clearTimeout(quickTimer)
          quickTimer = null
        }
        if (timeoutTimer !== null) {
          window.clearTimeout(timeoutTimer)
          timeoutTimer = null
        }
        if (controller !== null) {
          try { controller.abort() } catch { /* already aborted */ }
          controller = null
        }
        if (observer) {
          observer.disconnect()
          observer = null
        }
        if (resizeObserver) {
          resizeObserver.disconnect()
          resizeObserver = null
        }
        doc.removeEventListener('visibilitychange', onVisibilityChange)
        try { unsubscribeLocale() } catch { /* already gone */ }
        locale.dispose()
        if (root && root.isConnected) root.remove()
        root = null
        styleEl = doc.getElementById(STYLE_ID)
        if (styleEl && styleEl.isConnected) styleEl.remove()
      }
    }

    return {
      apply(ctx) {
        ctx.effect(() => mount(ctx))
      },
    }
  },
})
