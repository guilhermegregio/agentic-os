import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import {
  query,
  getSessionMessages,
  type ModelUsage,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { CLAUDE_BIN } from './config.js'
import { contextWindow as priceContextWindow, normalizeModel } from './pricing.js'
import { noteRateLimitEvent } from './probe.js'
import { getSettings } from './settings.js'
import * as store from './store.js'

// ---------------------------------------------------------------------------
// Eventos que a UI recebe (envelope sobre as SDKMessages + eventos próprios)
// ---------------------------------------------------------------------------
export type UiEventBody =
  | { kind: 'sdk'; msg: SDKMessage }
  | { kind: 'user_text'; text: string }
  | {
      kind: 'permission_request'
      id: string
      toolName: string
      input: Record<string, unknown>
      title?: string
      description?: string
      decisionReason?: string
      hasSuggestions: boolean
    }
  | { kind: 'permission_resolved'; id: string; behavior: 'allow' | 'deny' }
  | { kind: 'status'; state: SessionState }
  | { kind: 'usage'; usage: SessionUsage }
  | { kind: 'config'; permissionMode: string; model?: string }
  | { kind: 'history'; messages: HistoryMessage[] }
  | { kind: 'error'; error: string }

export type UiEvent = UiEventBody & { seq: number; ts: number }

/** Mensagem antiga importada de um transcript do CLI (`getSessionMessages`). */
export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: unknown
  uuid: string
}

export type SessionState = 'starting' | 'idle' | 'queued' | 'running' | 'closed' | 'handed-off' | 'error'

/** Contabilidade da sessão: o que o CLI reporta em `result.modelUsage`. */
export interface SessionUsage {
  costUsd: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Tokens que o modelo leu na última chamada = tamanho do contexto agora. */
  contextTokens: number
  contextWindow: number
  turns: number
  byModel: Array<{
    model: string
    costUsd: number
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    contextWindow: number
  }>
}

const emptyUsage = (): SessionUsage => ({
  costUsd: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  contextTokens: 0,
  contextWindow: 0,
  turns: 0,
  byModel: [],
})

// Fila assíncrona: vira o AsyncIterable<SDKUserMessage> que alimenta o query()
class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiters: Array<(v: IteratorResult<T>) => void> = []
  private done = false

  push(item: T) {
    const w = this.waiters.shift()
    if (w) w({ value: item, done: false })
    else this.items.push(item)
  }
  end() {
    this.done = true
    for (const w of this.waiters.splice(0)) w({ value: undefined as T, done: true })
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false })
        if (this.done) return Promise.resolve({ value: undefined as T, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      },
    }
  }
}

/**
 * Semáforo FIFO: quantos turnos podem rodar ao mesmo tempo. É o freio que impede
 * N sessões de disputarem CPU/RAM (cada turno é um processo `claude` + tools).
 */
class Semaphore {
  private active = 0
  private waiters: Array<() => void> = []
  constructor(private max: number) {}
  get running() {
    return this.active
  }
  get queued() {
    return this.waiters.length
  }
  get limit() {
    return this.max
  }
  setMax(n: number) {
    this.max = Math.max(1, n)
    this.drain()
  }
  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve) => this.waiters.push(resolve))
  }
  release() {
    this.active = Math.max(0, this.active - 1)
    this.drain()
  }
  /** Remove um esperador que desistiu (sessão fechada na fila). */
  cancel(w: () => void) {
    const i = this.waiters.indexOf(w)
    if (i >= 0) this.waiters.splice(i, 1)
  }
  private drain() {
    while (this.active < this.max && this.waiters.length) {
      this.active++
      this.waiters.shift()!()
    }
  }
}

function resolveClaudeBin(): string | undefined {
  if (CLAUDE_BIN) return CLAUDE_BIN
  try {
    return execSync('which claude', { encoding: 'utf8' }).trim() || undefined
  } catch {
    return undefined // cai no binário embutido do SDK
  }
}

export interface CreateSessionInput {
  /** Reusar o id de uma sessão gravada (revive) — senão gera um novo. */
  id?: string
  cwd?: string
  permissionMode?: PermissionMode
  model?: string
  resume?: string
  /** Com `resume`, cria um ramo novo em vez de continuar o original. */
  fork?: boolean
  /** Primeira mensagem, para abrir a sessão já com o turno rodando. */
  prompt?: string
  title?: string
  /** Continuação de uma sessão gravada: seq e contabilidade de onde parou. */
  seq?: number
  usage?: Partial<SessionUsage>
  createdAt?: number
  /** Sessão nascida no CLI: histórico importado antes do primeiro evento vivo. */
  importHistory?: boolean
}

type PendingPermission = {
  resolve: (r: PermissionResult) => void
  suggestions?: PermissionUpdate[]
  toolName: string
  input: Record<string, unknown>
}

/**
 * Uma sessão = um `query()` em streaming-input. O buffer de replay guarda só os
 * eventos duráveis: `stream_event` (os deltas de token) é emitido ao vivo mas
 * nunca guardado — o texto final chega inteiro na mensagem `assistant`, então
 * guardá-lo duplicaria a conversa em memória e em disco por nada.
 *
 * Tudo que entra no buffer vai para `events.jsonl`; é isso que faz a sessão
 * sobreviver a reload, troca de device e reinício do servidor.
 */
export class AgentSession {
  readonly id: string
  readonly createdAt: number
  readonly cwd: string
  permissionMode: PermissionMode
  model?: string
  sdkSessionId?: string
  state: SessionState = 'starting'
  title: string
  usage: SessionUsage = emptyUsage()
  /** Último `rate_limit_event` visto nesta sessão. */
  lastRateLimit?: unknown

  /** Eventos duráveis emitidos NESTE processo (o histórico anterior está no disco). */
  readonly events: UiEvent[] = []
  private seq: number
  private emitter = new EventEmitter()
  private input = new AsyncQueue<SDKUserMessage>()
  private pending = new Map<string, PendingPermission>()
  private pendingWrites: UiEvent[] = []
  private q?: Query
  private abort = new AbortController()
  private turnActive = false
  private holdsSlot = false
  private waiter?: () => void
  private metaTimer: NodeJS.Timeout | null = null
  private resumeOf?: string
  private closing = false
  /** Contabilidade acumulada ANTES deste processo (revive): `modelUsage` do CLI é por processo. */
  private base = { costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

  constructor(
    opts: CreateSessionInput,
    private gate: Semaphore,
  ) {
    this.id = opts.id ?? randomUUID()
    this.createdAt = opts.createdAt ?? Date.now()
    this.seq = opts.seq ?? 0
    this.cwd = opts.cwd ?? process.cwd()
    this.permissionMode = opts.permissionMode ?? 'default'
    this.model = opts.model
    this.title = opts.title?.slice(0, 90) || (opts.prompt ? opts.prompt.slice(0, 90) : 'nova sessão')
    this.usage = { ...emptyUsage(), ...(opts.usage ?? {}) }
    if (opts.seq) {
      const u = this.usage
      this.base = { costUsd: u.costUsd, input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite }
    }
    if (!this.usage.contextWindow) this.usage.contextWindow = priceContextWindow(opts.model)
    if (opts.resume && !opts.fork) this.sdkSessionId = opts.resume
    if (opts.resume) this.resumeOf = opts.resume
    this.emitter.setMaxListeners(500)
    void this.persistMeta()
    void this.start(opts)
  }

  private async start(opts: CreateSessionInput) {
    if (opts.importHistory && opts.resume) await this.importHistory(opts.resume)
    void this.run(opts)
    if (opts.prompt) void this.send(opts.prompt)
  }

  /** Sessão nascida no CLI: `resume` só traz o que vier daqui em diante — o passado vem do transcript. */
  private async importHistory(sdkSessionId: string) {
    try {
      const rows = await getSessionMessages(sdkSessionId, { dir: this.cwd })
      const messages: HistoryMessage[] = []
      for (const r of rows) {
        if (r.parent_tool_use_id || r.parent_agent_id) continue
        if (r.type !== 'user' && r.type !== 'assistant') continue
        const m = r.message as { role?: string; content?: unknown } | undefined
        if (!m?.content) continue
        messages.push({ role: r.type, content: m.content, uuid: r.uuid })
      }
      if (messages.length) this.emit({ kind: 'history', messages })
    } catch (err) {
      this.emit({ kind: 'error', error: `histórico do CLI indisponível: ${err instanceof Error ? err.message : err}` })
    }
  }

  // --- API pública -----------------------------------------------------------

  async send(text: string) {
    if (this.state === 'closed' || this.state === 'error' || this.state === 'handed-off') throw new Error(`sessão ${this.state}`)
    if (this.title === 'nova sessão') {
      this.title = text.slice(0, 90)
      void this.persistMeta()
    }
    this.emit({ kind: 'user_text', text })
    this.usage.turns++
    if (!this.holdsSlot) {
      this.setState('queued')
      await new Promise<void>((resolve) => {
        this.waiter = resolve
        void this.gate.acquire().then(resolve)
      })
      this.waiter = undefined
      if (this.closing) {
        this.gate.release()
        return
      }
      this.holdsSlot = true
    }
    this.turnActive = true
    this.setState('running')
    this.input.push({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      session_id: this.sdkSessionId ?? '',
    })
  }

  async interrupt() {
    await this.q?.interrupt()
  }

  async setPermissionMode(mode: PermissionMode) {
    await this.q?.setPermissionMode(mode)
    this.permissionMode = mode
    this.emit({ kind: 'config', permissionMode: mode, model: this.model })
    void this.persistMeta()
  }

  async setModel(model: string | undefined) {
    await this.q?.setModel(model || undefined)
    this.model = model || undefined
    this.usage.contextWindow = priceContextWindow(this.model)
    this.emit({ kind: 'config', permissionMode: this.permissionMode, model: this.model })
    void this.persistMeta()
  }

  resolvePermission(
    id: string,
    decision: { behavior: 'allow' | 'deny'; always?: boolean; message?: string },
  ) {
    const p = this.pending.get(id)
    if (!p) return false
    this.pending.delete(id)
    if (decision.behavior === 'allow') {
      p.resolve({
        behavior: 'allow',
        updatedInput: p.input,
        updatedPermissions: decision.always ? p.suggestions : undefined,
      })
    } else {
      p.resolve({ behavior: 'deny', message: decision.message ?? 'Negado pelo usuário na UI' })
    }
    this.emit({ kind: 'permission_resolved', id, behavior: decision.behavior })
    return true
  }

  pendingPermissions() {
    return [...this.pending.entries()].map(([id, p]) => ({ id, toolName: p.toolName, input: p.input }))
  }

  /** Encerra o processo; `final` é o estado gravado (closed, ou handed-off no handoff). */
  close(final: SessionState = 'closed') {
    if (this.closing) return
    this.closing = true
    this.input.end()
    this.abort.abort()
    try {
      this.q?.close()
    } catch {
      /* já fechado */
    }
    for (const [id] of this.pending) this.resolvePermission(id, { behavior: 'deny', message: 'sessão encerrada' })
    if (this.waiter) {
      this.gate.cancel(this.waiter)
      this.waiter = undefined
    }
    this.releaseSlot()
    this.setState(final)
    this.flushEvents()
  }

  subscribe(since: number, listener: (e: UiEvent) => void): () => void {
    for (const e of this.events) if (e.seq > since) listener(e)
    this.emitter.on('event', listener)
    return () => this.emitter.off('event', listener)
  }

  get lastSeq() {
    return this.seq
  }

  summary() {
    return {
      id: this.id,
      sdkSessionId: this.sdkSessionId,
      title: this.title,
      cwd: this.cwd,
      model: this.model,
      permissionMode: this.permissionMode,
      state: this.state,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      pendingPermissions: this.pending.size,
      usage: this.usage,
      live: true as const,
      resumeOf: this.resumeOf,
      lastSeq: this.seq,
    }
  }

  // --- internos --------------------------------------------------------------

  private releaseSlot() {
    if (!this.holdsSlot) return
    this.holdsSlot = false
    this.gate.release()
  }

  private emit(e: UiEventBody) {
    const full: UiEvent = { ...e, seq: ++this.seq, ts: Date.now() }
    // stream_event é ao vivo e descartável: não entra no replay nem no disco.
    const ephemeral = e.kind === 'sdk' && e.msg.type === 'stream_event'
    if (!ephemeral) {
      this.events.push(full)
      this.pendingWrites.push(full)
      this.flushEvents()
    }
    this.emitter.emit('event', full)
  }

  private flushEvents() {
    if (!this.pendingWrites.length) return
    store.appendEvents(this.id, this.pendingWrites.splice(0))
  }

  private setState(s: SessionState) {
    if (this.state === s) return
    this.state = s
    this.emit({ kind: 'status', state: s })
    void this.persistMeta()
  }

  private persistMeta() {
    if (this.metaTimer) return
    this.metaTimer = setTimeout(() => {
      this.metaTimer = null
      void store.saveMeta({
        id: this.id,
        sdkSessionId: this.sdkSessionId,
        title: this.title,
        cwd: this.cwd,
        model: this.model,
        lastModel: this.usage.byModel.at(-1)?.model,
        permissionMode: this.permissionMode,
        state: this.state,
        createdAt: this.createdAt,
        updatedAt: Date.now(),
        turns: this.usage.turns,
        tally: {
          input: this.usage.input,
          output: this.usage.output,
          cacheRead: this.usage.cacheRead,
          cacheWrite: this.usage.cacheWrite,
          costUsd: this.usage.costUsd,
          contextTokens: this.usage.contextTokens,
        },
        contextTokens: this.usage.contextTokens,
        contextWindow: this.usage.contextWindow,
        lastSeq: this.seq,
        resumeOf: this.resumeOf,
      })
    }, 600)
  }

  /** `modelUsage` é cumulativo por sessão — substitui, não soma. */
  private applyModelUsage(modelUsage: Record<string, ModelUsage>) {
    const byModel = Object.entries(modelUsage).map(([model, u]) => ({
      model: normalizeModel(u.canonicalModel ?? model),
      costUsd: u.costUSD ?? 0,
      input: u.inputTokens ?? 0,
      output: u.outputTokens ?? 0,
      cacheRead: u.cacheReadInputTokens ?? 0,
      cacheWrite: u.cacheCreationInputTokens ?? 0,
      contextWindow: u.contextWindow ?? 0,
    }))
    const sum = (k: 'costUsd' | 'input' | 'output' | 'cacheRead' | 'cacheWrite') =>
      this.base[k] + byModel.reduce((acc, m) => acc + m[k], 0)

    this.usage = {
      ...this.usage,
      byModel,
      costUsd: sum('costUsd'),
      input: sum('input'),
      output: sum('output'),
      cacheRead: sum('cacheRead'),
      cacheWrite: sum('cacheWrite'),
      contextWindow: Math.max(...byModel.map((m) => m.contextWindow), this.usage.contextWindow, 0),
    }
    this.emit({ kind: 'usage', usage: this.usage })
    void this.persistMeta()
  }

  private canUseTool: Options['canUseTool'] = (toolName, input, ctx) => {
    return new Promise<PermissionResult>((resolve) => {
      const id = randomUUID()
      this.pending.set(id, { resolve, suggestions: ctx.suggestions, toolName, input })
      this.emit({
        kind: 'permission_request',
        id,
        toolName,
        input,
        title: ctx.title,
        description: ctx.description,
        decisionReason: ctx.decisionReason,
        hasSuggestions: Boolean(ctx.suggestions?.length),
      })
      ctx.signal.addEventListener('abort', () => {
        if (this.pending.delete(id)) {
          resolve({ behavior: 'deny', message: 'cancelado' })
          this.emit({ kind: 'permission_resolved', id, behavior: 'deny' })
        }
      })
    })
  }

  private async run(input: CreateSessionInput) {
    const options: Options = {
      cwd: this.cwd,
      model: this.model,
      resume: input.resume,
      forkSession: input.fork,
      permissionMode: this.permissionMode,
      canUseTool: this.canUseTool,
      includePartialMessages: true,
      abortController: this.abort,
      pathToClaudeCodeExecutable: resolveClaudeBin(),
      // settingSources omitido = carrega user/project/local, CLAUDE.md, skills,
      // hooks e MCPs do cwd — o harness inteiro vale aqui, igual ao CLI.
      systemPrompt: { type: 'preset', preset: 'claude_code', snapshot: true },
    }
    try {
      this.q = query({ prompt: this.input, options })
      for await (const msg of this.q) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.sdkSessionId = msg.session_id
          if (!this.usage.contextWindow) this.usage.contextWindow = priceContextWindow(msg.model)
          // O CLI é a verdade sobre modo/modelo — sincroniza o que a UI mostra.
          if (msg.permissionMode && msg.permissionMode !== this.permissionMode) this.permissionMode = msg.permissionMode
          if (msg.model && normalizeModel(msg.model) !== normalizeModel(this.model)) this.model = msg.model
          if (!this.turnActive) this.setState('idle')
          void this.persistMeta()
        }

        if (msg.type === 'rate_limit_event') {
          this.lastRateLimit = msg.rate_limit_info
          noteRateLimitEvent(msg.rate_limit_info)
        }

        // Contexto atual = o que o modelo leu na última chamada.
        if (msg.type === 'assistant') {
          const u = (msg.message as unknown as { usage?: Record<string, number> }).usage
          if (u) {
            this.usage.contextTokens =
              (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          }
        }

        this.emit({ kind: 'sdk', msg })

        if (msg.type === 'result') {
          this.turnActive = false
          if (msg.modelUsage) this.applyModelUsage(msg.modelUsage)
          this.releaseSlot()
          this.setState('idle')
        }
      }
      if (!this.closing) this.setState('closed')
    } catch (err) {
      if (this.closing) return
      this.emit({ kind: 'error', error: err instanceof Error ? err.message : String(err) })
      this.releaseSlot()
      this.setState('error')
    }
  }
}

/** Sessão que existe só no disco (processo anterior, ou fechada/entregue ao CLI). */
export interface StoredSummary {
  id: string
  sdkSessionId?: string
  title: string
  cwd: string
  model?: string
  permissionMode: string
  state: string
  createdAt: number
  updatedAt: number
  pendingPermissions: 0
  usage: SessionUsage
  live: false
  resumeOf?: string
  lastSeq: number
  archived?: boolean
}

export type SessionSummary = ReturnType<AgentSession['summary']> | StoredSummary

const DEAD = new Set<SessionState>(['closed', 'error', 'handed-off'])

export class SessionManager {
  private sessions = new Map<string, AgentSession>()
  private gate = new Semaphore(getSettings().maxRunning)

  async boot() {
    await store.boot()
    this.gate.setMax(getSettings().maxRunning)
  }

  setMaxRunning(n: number) {
    this.gate.setMax(n)
  }

  create(input: CreateSessionInput) {
    const s = new AgentSession(input, this.gate)
    this.sessions.set(s.id, s)
    return s
  }

  /** Só instâncias com processo vivo; a morta fica visível como "stored". */
  get(id: string) {
    const s = this.sessions.get(id)
    return s && !DEAD.has(s.state) ? s : undefined
  }

  stored(id: string): StoredSummary | undefined {
    const m = store.getMeta(id)
    return m ? this.fromMeta(m) : undefined
  }

  private fromMeta(m: store.SessionMeta): StoredSummary {
    return {
      id: m.id,
      sdkSessionId: m.sdkSessionId,
      title: m.title,
      cwd: m.cwd,
      model: m.model ?? m.lastModel,
      permissionMode: m.permissionMode,
      state: m.state,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      pendingPermissions: 0,
      usage: {
        ...emptyUsage(),
        ...m.tally,
        contextTokens: m.contextTokens,
        contextWindow: m.contextWindow,
        turns: m.turns,
      },
      live: false,
      resumeOf: m.resumeOf,
      lastSeq: m.lastSeq,
      archived: m.archived,
    }
  }

  /**
   * Sessão gravada ganha processo de novo: mesmo id, `resume` no id do CLI, seq
   * continuando de onde o disco parou. É o que faz "mandar mensagem numa sessão
   * de ontem" simplesmente funcionar.
   */
  revive(id: string): AgentSession | undefined {
    const live = this.sessions.get(id)
    if (live && !DEAD.has(live.state)) return live
    // Instância cujo processo já acabou (closed/error): sai do mapa e renasce do disco.
    if (live) this.sessions.delete(id)
    const m = store.getMeta(id)
    if (!m) return undefined
    const s = new AgentSession(
      {
        id: m.id,
        cwd: m.cwd,
        permissionMode: m.permissionMode as PermissionMode,
        model: m.model,
        resume: m.sdkSessionId,
        title: m.title,
        seq: m.lastSeq,
        createdAt: m.createdAt,
        usage: {
          ...m.tally,
          contextTokens: m.contextTokens,
          contextWindow: m.contextWindow,
          turns: m.turns,
        },
      },
      this.gate,
    )
    this.sessions.set(s.id, s)
    return s
  }

  /** Vivas ∪ gravadas (a viva vence quando as duas existem). */
  list(includeArchived = false): SessionSummary[] {
    const out = new Map<string, SessionSummary>()
    for (const m of store.listMeta()) if (includeArchived || !m.archived) out.set(m.id, this.fromMeta(m))
    for (const s of this.sessions.values()) out.set(s.id, s.summary())
    return [...out.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  close(id: string, final: SessionState = 'closed') {
    const s = this.sessions.get(id)
    if (!s) return false
    s.close(final)
    this.sessions.delete(id)
    return true
  }

  closeAll() {
    for (const s of this.sessions.values()) s.close()
    this.sessions.clear()
  }

  /** Soma do que está vivo agora — o "gasto desta janela" do dashboard. */
  liveTotals() {
    const live = [...this.sessions.values()]
    return {
      sessions: live.length,
      running: this.gate.running,
      queued: this.gate.queued,
      maxRunning: this.gate.limit,
      pendingPermissions: live.reduce((a, s) => a + s.summary().pendingPermissions, 0),
      costUsd: live.reduce((a, s) => a + s.usage.costUsd, 0),
      contextTokens: live.reduce((a, s) => a + s.usage.contextTokens, 0),
    }
  }
}
