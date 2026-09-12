import { execSync } from 'node:child_process'
import { query, type ModelInfo, type McpServerStatus, type AccountInfo } from '@anthropic-ai/claude-agent-sdk'
import { CLAUDE_BIN } from './config.js'

/**
 * Sonda da conta: um `query()` sem nenhuma mensagem responde aos control requests
 * (conta, modelos, janelas da subscription, MCPs) em ~1.5s sem gastar tokens.
 * Cacheado por 60s; qualquer falha degrada para `null` — o dashboard nunca cai
 * porque a API experimental do `/usage` mudou.
 */

export interface RateWindow {
  key: string
  label: string
  percent: number | null
  resetsAt: string | null
  scope?: string
  active?: boolean
  severity?: string
}

export interface AccountSnapshot {
  fetchedAt: number
  account: AccountInfo | null
  subscriptionType: string | null
  rateLimitsAvailable: boolean
  windows: RateWindow[]
  /** Objeto bruto do SDK, para quem quiser mais detalhe (extra_usage, spend…). */
  rateLimitsRaw: unknown
  models: Array<{ id: string; resolved?: string; label: string; description: string; effort?: string[] }>
  mcp: Array<{ name: string; status: McpServerStatus['status']; error?: string }>
  error?: string
}

let cache: AccountSnapshot | null = null
let inflight: Promise<AccountSnapshot> | null = null

function claudeBin(): string | undefined {
  if (CLAUDE_BIN) return CLAUDE_BIN
  try {
    return execSync('which claude', { encoding: 'utf8' }).trim() || undefined
  } catch {
    return undefined
  }
}

const LABELS: Record<string, string> = {
  session: 'janela de 5h',
  five_hour: 'janela de 5h',
  weekly_all: 'semana (todos os modelos)',
  seven_day: 'semana (todos os modelos)',
  weekly_scoped: 'semana',
}

function normalizeWindows(rl: any): RateWindow[] {
  if (!rl) return []
  const out: RateWindow[] = []
  if (Array.isArray(rl.limits) && rl.limits.length) {
    for (const l of rl.limits) {
      const scope = l.scope?.model?.display_name ?? l.scope?.surface ?? undefined
      out.push({
        key: `${l.kind}${scope ? ':' + scope : ''}`,
        label: scope ? `semana · ${scope}` : (LABELS[l.kind] ?? l.kind),
        percent: typeof l.percent === 'number' ? l.percent : null,
        resetsAt: l.resets_at ?? null,
        scope,
        active: Boolean(l.is_active),
        severity: l.severity,
      })
    }
    return out
  }
  for (const k of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']) {
    const w = rl[k]
    if (w) out.push({ key: k, label: LABELS[k] ?? k, percent: w.utilization ?? null, resetsAt: w.resets_at ?? null })
  }
  return out
}

async function probeOnce(cwd: string): Promise<AccountSnapshot> {
  const abort = new AbortController()
  // Prompt que nunca entrega mensagem: o processo sobe, responde aos controles e morre no abort.
  async function* silent() {
    await new Promise<void>((resolve) => abort.signal.addEventListener('abort', () => resolve()))
  }
  const snap: AccountSnapshot = {
    fetchedAt: Date.now(),
    account: null,
    subscriptionType: null,
    rateLimitsAvailable: false,
    windows: [],
    rateLimitsRaw: null,
    models: [],
    mcp: [],
  }
  const q = query({
    prompt: silent(),
    options: { cwd, pathToClaudeCodeExecutable: claudeBin(), abortController: abort, permissionMode: 'default' },
  })
  // Drena o stream (hooks do harness emitem eventos) sem bloquear os controles.
  void (async () => {
    try {
      for await (const _ of q) {
        /* descarta */
      }
    } catch {
      /* abort esperado */
    }
  })()
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('probe timeout')), 15_000))
  try {
    const [account, models, usage, mcp] = await Promise.race([
      Promise.all([
        q.accountInfo().catch(() => null),
        q.supportedModels().catch(() => [] as ModelInfo[]),
        (q as any).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?.({ skipBehaviors: true }).catch(() => null),
        q.mcpServerStatus().catch(() => [] as McpServerStatus[]),
      ]),
      timeout,
    ])
    snap.account = account
    snap.subscriptionType = usage?.subscription_type ?? account?.subscriptionType ?? null
    snap.rateLimitsAvailable = Boolean(usage?.rate_limits_available)
    snap.rateLimitsRaw = usage?.rate_limits ?? null
    snap.windows = normalizeWindows(usage?.rate_limits)
    snap.models = models.map((m) => ({
      id: m.value,
      resolved: m.resolvedModel,
      label: m.displayName,
      description: m.description,
      effort: m.supportedEffortLevels,
    }))
    snap.mcp = mcp.map((m) => ({ name: m.name, status: m.status, error: m.error }))
  } catch (err) {
    snap.error = err instanceof Error ? err.message : String(err)
  } finally {
    abort.abort()
    try {
      q.close()
    } catch {
      /* já fechado */
    }
  }
  return snap
}

export async function accountSnapshot(cwd: string, maxAgeMs = 60_000): Promise<AccountSnapshot> {
  if (cache && Date.now() - cache.fetchedAt < maxAgeMs) return cache
  if (inflight) return inflight
  inflight = probeOnce(cwd)
    .then((s) => {
      // Falha total mantém o último snapshot bom (com a marca de erro).
      cache = s.error && cache ? { ...cache, error: s.error } : s
      return cache
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Eventos `rate_limit_event` das sessões vivas atualizam a janela sem nova sonda. */
export function noteRateLimitEvent(info: { rateLimitType?: string; utilization?: number; resetsAt?: number }) {
  if (!cache || !info.rateLimitType) return
  const key = info.rateLimitType === 'five_hour' ? 'session' : info.rateLimitType === 'seven_day' ? 'weekly_all' : info.rateLimitType
  const w = cache.windows.find((x) => x.key === key || x.key === info.rateLimitType)
  if (w && typeof info.utilization === 'number') {
    w.percent = info.utilization <= 1 ? Math.round(info.utilization * 100) : Math.round(info.utilization)
    if (info.resetsAt) w.resetsAt = new Date(info.resetsAt * (info.resetsAt < 1e12 ? 1000 : 1)).toISOString()
  }
}
