# 💰 余额栏

> 🐳 在 DSH 的左侧边栏插入一个纯文字的余额信息块，位置在品牌区「DeepSeek」下方、新建对话按钮上方。
> **网页端与桌面客户端都能用**：两者渲染的是同一个 Web 界面，插件一次安装即在两端生效。
> A plain-text balance block for the DSH sidebar, placed between the brand row and the new-session button — available on **both the web UI and the desktop client**.

```
余额: 9.42￥
今日 ¥12.85 · 487,165,184 tok
空闲时段 11:13:12 (09:00)
```

---

## 🇨🇳 中文

### ✨ 这是什么

余额栏是 DSH（DeepSeek Harness）的侧边栏插件 🐳，**网页端和桌面客户端都可用**。它在「DeepSeek」品牌区下方显示三行信息：账户余额、今日花费与 token 用量、当前峰谷时段与切换倒计时 ⏱️。

🚫 不使用进度条，不注册 slot，不修改宿主 CSS，也不删除任何宿主节点。

### 🧱 三行布局

| 行 | 内容 | 说明 |
| --- | --- | --- |
| 1️⃣ 第一行 | `余额: 9.26￥` | 「余额:」为灰色小字，金额 14px 加粗并带 DeepSeek 蓝点缀 🔵 |
| 2️⃣ 第二行 | `今日 ¥0.06 · 914,996 tok` | 今日已用金额与当日累计 token，中间用 `·` 分隔 |
| 3️⃣ 第三行 | `空闲时段 15:42:56 (09:00)` | 当前时段、距离切换的 `HH:MM:SS` 倒计时、括号内为北京时间切换时刻 |

⏱️ 倒计时每秒刷新；时段文字与倒计时之间没有分隔点。

### 🎨 颜色规则

**💵 余额金额**

- 🔴 余额 ≤ 1 元：红色 `#e5484d`
- 🟠 余额 ≤ 5 元（且大于 1）：橙色 `#f59e0b`
- ⚪ 其他：`var(--dsw-alias-label-primary)`
- ➖ 余额取不到：显示 `—` + 普通色，绝不当作 0

**⛰️ 峰谷时段（只作用于时段文字）**

- 🟢 空闲时段：绿色 `#22a06b`
- 🟠 高峰时段：橙色 `#f59e0b`
- ⚪ 时段未知：灰色 `—`，使用 `var(--dsw-alias-label-secondary)`

> 💡 高峰橙与余额预警橙是同一个色值，但分别作用在时段文字和金额文字上，互不影响。

🎨 其余颜色只用 `var(--dsw-alias-label-secondary)`、`var(--dsw-alias-label-primary)` 与 DeepSeek 蓝点缀 `var(--dsw-alias-label-deep-diving)`。🌗 深浅色主题都由主题 token 自动适配。

### 🔌 数据来源（只读）

余额栏自带所需数据，**不依赖任何其它插件** 🎉。宿主半通过一个只读接口 `/dsh-balance-bar/usage.json` 汇总：

| 字段 | 来源 |
| --- | --- |
| 💵 余额金额 | DSH 自带的账户服务 `deepseekAccount.getBalance()`，取充值余额与赠金余额之和（与平台口径一致，多币种优先人民币） |
| ⛰️ 高峰 / 空闲 | 插件内置的官方计费规则：周一到周五 09:00–12:00、14:00–18:00 为高峰；周末（2026-08-23 起）与法定节假日（2026-09-19 起）全天按空闲计 |
| ⏱️ 切换倒计时 | 由同一套规则推算下一个切换点，与时段判断完全同源 |
| 🔢 今日累计 token | 读取 DSH 本机会话日志（含 zstd 压缩分帧）中 `assistant/message` 事件的真实 `usage`，按北京时区当天过滤求和 |
| 📊 今日已用金额 | 按每条请求**发生时刻**的峰谷单价分别计费后求和：`缓存命中 × 价 + 未命中输入 × 价 + 输出 × 价`，空闲档为命中 0.02 / 未命中 1 / 输出 4（元每百万 tok），高峰档约减半 |

📏 今日花费是按 token 的**估算值**：因为每条请求都按当时的价格计价，中途切换模型或跨过峰谷边界都不会算错。实测同一天估算 ¥12.79、账户实际扣减 ¥12.76，误差约 0.2%。

0️⃣ **今天没有消耗时显示 `¥0.00` 和 `0 tok`**（而不是 `—`）；只有日志扫描尚未完成的那一小会儿才显示 `—`，扫描完成后会自动补上真实数字。

🔒 该接口只返回聚合数字，不暴露凭证、原始日志或单条事件。

🛟 未登录 DeepSeek 账号、或账户查询失败时，余额显示 `—`，失败原因放在 `title` 属性里而不是挤进界面 🙈；峰谷与今日 token 仍会正常显示。

⚠️ 峰谷规则与节假日表内置在插件里，国务院每年公布次年放假安排后需要相应更新。

> 💡 相比读取小组件账本，直接解析会话日志更完整：实测同一天小组件账本记录 1.63 亿 token，而会话日志为 4.3 亿（4 个会话、814 条带用量的消息），与当天余额实际扣减 ¥11.41 更吻合。

### ♻️ 刷新与生命周期

- 🚀 首次挂载立即请求，之后每 60 秒轮询；
- 😴 `document.visibilityState === 'hidden'` 时暂停轮询与秒级倒计时，回到可见时立即刷新并恢复；
- 🧲 全文档 `MutationObserver` 在 React 重渲染后把节点重新插回 `[class*="newSession"]` 按钮之前，并用 `data-my-balance-attach` 标记防止重复插入；
- 📐 `ResizeObserver` 在侧边栏尺寸变化时校正挂载；
- 📥 侧边栏折叠时（`[data-sidebar-collapsed="true"]`）用 `display:none` 隐藏整个模块，不挤压图标区；
- 🧹 组件卸载时清理 `setInterval`、`MutationObserver`、`ResizeObserver`、`visibilitychange` 监听、进行中的请求、语言订阅、自有节点与自有样式。

### 📦 安装

**🥇 方式一：npm 包（推荐）**

```powershell
npm install -g dsh-balance-bar-npm
# 或在 DSH 插件管理里安装 npm 包名 dsh-balance-bar-npm
```

**🥈 方式二：从 GitHub 安装**

```powershell
dsh plugin --profile desktop add github:deadmay5-7/-Balance-Bar
```

或直接在 DSH 插件管理里粘贴仓库地址：<https://github.com/deadmay5-7/-Balance-Bar>

**🥉 方式三：本地目录**

```powershell
dsh plugin --profile desktop add link:D:\Plugins\dsh-balance-bar
```

✅ 安装后刷新 Web 页面即可。

### 🗑️ 卸载

打开 DSH 的 **插件** 页面，进入「已安装插件」列表，找到 **余额栏** 这一行，在它右侧的 **详细信息** 里点 **卸载** 即可。

> 💡 也可以直接在该插件的详情页关闭开关来停用，无需卸载。

---

## EN English

### ✨ What it is

Balance Bar is a sidebar plugin 🐳 for DSH (DeepSeek Harness), working in **both the web UI and the desktop client**. It shows three lines under the "DeepSeek" brand row: the account balance, today's spend with token usage, and the current peak / off-peak period with a countdown to the next switch ⏱️.

🚫 No progress bar, no slot registration, no host CSS overrides, and no host nodes are removed.

### 🧱 Three-line layout

| Line | Content | Notes |
| --- | --- | --- |
| 1️⃣ | `余额: 9.26￥` | Small grey label with a DeepSeek-blue accent dot 🔵, amount in 14px bold |
| 2️⃣ | `今日 ¥0.06 · 914,996 tok` | Today's spend and today's total tokens, separated by `·` |
| 3️⃣ | `空闲时段 15:42:56 (09:00)` | Current period, `HH:MM:SS` countdown, and the Beijing-time switch moment in parentheses |

⏱️ The countdown ticks every second; there is no separator between the period text and the countdown.

### 🎨 Color rules

**💵 Balance amount**

- 🔴 ≤ 1 CNY: red `#e5484d`
- 🟠 ≤ 5 CNY (and above 1): orange `#f59e0b`
- ⚪ Otherwise: `var(--dsw-alias-label-primary)`
- ➖ Unavailable: `—` in the normal color, never treated as zero

**⛰️ Peak / off-peak period (applies to the period text only)**

- 🟢 Off-peak: green `#22a06b`
- 🟠 Peak: orange `#f59e0b`
- ⚪ Unknown: grey `—` using `var(--dsw-alias-label-secondary)`

> 💡 Peak orange and the low-balance orange share a value but apply to different elements, so they never affect each other.

🎨 All other colors use only `var(--dsw-alias-label-secondary)`, `var(--dsw-alias-label-primary)`, and the DeepSeek blue accent `var(--dsw-alias-label-deep-diving)`. 🌗 Light and dark themes both follow the theme tokens automatically.

### 🔌 Data sources (read-only)

Balance Bar is **self-contained — it does not depend on any other plugin** 🎉. The host half exposes one read-only route, `/dsh-balance-bar/usage.json`, which aggregates:

| Field | Source |
| --- | --- |
| 💵 Balance | DSH's own account service `deepseekAccount.getBalance()`, summing the recharge wallet and the bonus wallet (matching the platform, CNY preferred) |
| ⛰️ Peak / off-peak | The official pricing rules built into the plugin: Mon–Fri 09:00–12:00 and 14:00–18:00 are peak; weekends (since 2026-08-23) and Chinese public holidays (since 2026-09-19) are off-peak all day |
| ⏱️ Countdown | Derived from the same rules, so the switch point can never disagree with the period |
| 🔢 Today's total tokens | `assistant/message` events with real `usage` read from DSH's local session logs (including zstd-compressed frames), filtered to the current Beijing day and summed |
| 📊 Today's spend | Each request is priced at the peak/off-peak rate in effect **when it ran**, then summed: `cache-hit × price + uncached input × price + output × price`; off-peak is 0.02 / 1 / 4 (CNY per million tokens) and peak is roughly half |

📏 Today's spend is a **token-based estimate**: because every request is priced at the rate in effect at that moment, switching models or crossing a peak boundary mid-day never distorts it. Measured on one day: estimated ¥12.79 vs. an actual account debit of ¥12.76, about 0.2% off.

0️⃣ **When nothing was consumed today, the bar shows `¥0.00` and `0 tok`** (not `—`); `—` only appears for the moment before the first log scan finishes, and the real numbers replace it automatically.

🔒 The route returns aggregates only — never credentials, raw logs, or individual events.

🛟 If you are signed out or the account query fails, the balance shows `—` and the reason goes into the `title` attribute instead of the layout 🙈, while the period and token count keep working.

⚠️ The peak rules and holiday table live in the plugin; update them when the State Council publishes the next year's holiday schedule.

> 💡 Parsing session logs is also more complete than reading a widget's ledger: on one measured day the widget ledger recorded 163M tokens while the session logs held 430M (4 sessions, 814 messages with usage), which matches that day's real balance decrease of ¥11.41 far better.

### ♻️ Refresh and lifecycle

- 🚀 One request on mount, then polling every 60 seconds;
- 😴 Polling and the per-second countdown pause while `document.visibilityState === 'hidden'` and resume on return;
- 🧲 A document-wide `MutationObserver` re-inserts the node before `[class*="newSession"]` after React re-renders, guarded by the `data-my-balance-attach` marker;
- 📐 A `ResizeObserver` re-anchors the node when the sidebar resizes;
- 📥 When the sidebar is collapsed (`[data-sidebar-collapsed="true"]`) the whole block is hidden with `display:none` and never squeezes the icon rail;
- 🧹 On unmount every resource is released: `setInterval`, `MutationObserver`, `ResizeObserver`, the `visibilitychange` listener, in-flight requests, the locale subscription, and the plugin's own nodes and styles.

### 📦 Install

**🥇 Option 1: npm package (recommended)**

```powershell
npm install -g dsh-balance-bar-npm
# or install the npm package name dsh-balance-bar-npm from the DSH plugin manager
```

**🥈 Option 2: install from GitHub**

```powershell
dsh plugin --profile desktop add github:deadmay5-7/-Balance-Bar
```

Or paste the repository URL directly into the DSH plugin manager: <https://github.com/deadmay5-7/-Balance-Bar>

**🥉 Option 3: local directory**

```powershell
dsh plugin --profile desktop add link:D:\Plugins\dsh-balance-bar
```

✅ Refresh the Web page after installing.

### 🗑️ Uninstall

Open the DSH **Plugins** page, go to the installed plugins list, find the **Balance Bar** row, open its **details**, and click **Uninstall**.

> 💡 You can also just toggle it off in its detail page to disable it without uninstalling.

---

## 📄 License · 许可证

⚖️ MIT — see [LICENSE](LICENSE).
⚖️ MIT —— 详见 [LICENSE](LICENSE)。

---

## ⭐ 觉得好用？点个 Star 吧！

如果你觉得这个插件好用，请顺手点一个 Star✨，谢谢！

> If you find this plugin useful, a Star ✨ would mean a lot — thank you! 💙
