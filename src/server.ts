import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { streamSSE } from 'hono/streaming'
import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import { SessionManager, type UiEvent } from './agent.js'
import { AUTH_TOKEN, ENV_FILE, HOST, LOOPBACK_HOSTS, MOCK, PORT } from './config.js'
import * as harness from './harness.js'
import * as herdr from './herdr.js'
import * as planops from './planops.js'
import { modelCatalog } from './pricing.js'
import { accountSnapshot } from './probe.js'
import { getSettings, loadSettings, updateSettings } from './settings.js'
import * as store from './store.js'
import * as usage from './usage.js'
import * as worktrees from './worktrees.js'

const manager = new SessionManager()
const app = new Hono()

const bad = (c: any, msg: string, code = 400) => c.json({ error: msg }, code)
const wrap = <T>(fn: () => Promise<T>) => fn().then((v) => ({ ok: true as const, v })).catch((e: unknown) => ({ ok: false as const, e: e instanceof Error ? e.message : String(e) }))

// Modo mock: o front responde tudo com web/mock.js; a API real não pode vazar nada.
app.use('/api/*', async (c, next) => {
  if (MOCK) return bad(c, 'modo mock: API desligada (JARVIS_MOCK=1)', 503)
  await next()
})

// Token: obrigatório fora do loopback (ver HOST em config.ts); comparação em tempo constante.
const tokenOk = (given: string | undefined) => {
  if (!AUTH_TOKEN || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(AUTH_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}
app.use('/api/*', async (c, next) => {
  if (AUTH_TOKEN && !tokenOk(c.req.header('x-jarvis-token')) && !tokenOk(c.req.query('token'))) return bad(c, 'não autorizado', 401)
  await next()
})

app.get('/api/health', (c) => c.json({ ok: true, cwd: process.cwd(), herdr: herdr.available() }))

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
app.get('/api/overview', async (c) => {
  const [account, plans, risk, agents, prototypes, orph] = await Promise.all([
    accountSnapshot(process.cwd()),
    harness.plans(),
    harness.repoRisk(),
    herdr.agents(),
    planops.prototypes(),
    harness.kbConfig().then((cfg) => worktrees.orphans(cfg.projects.map((p) => p.path))),
  ])
  const sessions = manager.list()
  return c.json({
    generatedAt: Date.now(),
    account: {
      email: account.account?.email,
      subscription: account.subscriptionType,
      provider: account.account?.apiProvider,
      apiKeySource: account.account?.apiKeySource,
      error: account.error,
      fetchedAt: account.fetchedAt,
    },
    rateLimits: { available: account.rateLimitsAvailable, windows: account.windows },
    models: account.models,
    mcp: account.mcp,
    live: manager.liveTotals(),
    settings: getSettings(),
    sessions: sessions.slice(0, 12),
    agents,
    plans: plans.map((p) => ({
      slug: p.slug,
      vault: p.vault,
      title: p.title,
      status: p.status,
      progress: p.progress,
      ready: p.ready,
      gates: p.gates,
      openGates: p.openGates,
      frozen: p.frozen.length,
      prototypeUrl: p.prototypeUrl,
      projects: p.projects,
    })),
    repoRisk: risk,
    prototypes,
    orphanWorktrees: orph,
  })
})

app.get('/api/usage', async (c) => c.json(await usage.costs(Number(c.req.query('days') ?? 30))))
app.get('/api/usage/sessions', async (c) => c.json(await usage.sessions(Number(c.req.query('limit') ?? 40), c.req.query('project') || undefined)))
app.get('/api/models', async (c) => {
  const snap = await accountSnapshot(process.cwd())
  return c.json({ available: snap.models, pricing: modelCatalog() })
})

app.get('/api/settings', (c) => c.json(getSettings()))
app.patch('/api/settings', async (c) => {
  const patch = await c.req.json()
  const s = await updateSettings(patch)
  manager.setMaxRunning(s.maxRunning)
  return c.json(s)
})

// ---------------------------------------------------------------------------
// Projetos e worktrees
// ---------------------------------------------------------------------------
app.get('/api/projects', async (c) => c.json(await harness.projects(c.req.query('git') !== '0')))
app.get('/api/projects/worktrees', async (c) => {
  const path = c.req.query('path')
  if (!path) return bad(c, 'path obrigatório')
  return c.json(await worktrees.list(path))
})
app.post('/api/projects/worktrees', async (c) => {
  const body = await c.req.json<worktrees.CreateInput>()
  const r = await wrap(() => worktrees.create(body))
  return r.ok ? c.json(r.v, 201) : bad(c, r.e)
})
app.delete('/api/projects/worktrees', async (c) => {
  const body = await c.req.json<{ repoPath: string; path: string; force?: boolean; deleteBranch?: boolean }>()
  const r = await wrap(() => worktrees.remove(body.repoPath, body.path, body))
  return r.ok ? c.json(r.v) : bad(c, r.e)
})
app.get('/api/agents', async (c) => c.json(await herdr.agents()))
app.post('/api/agents/:pane/focus', async (c) => c.json({ ok: await herdr.focus(c.req.param('pane')) }))

// ---------------------------------------------------------------------------
// Console do devflow
// ---------------------------------------------------------------------------
app.get('/api/plans', async (c) => c.json(await harness.plans(c.req.query('archived') === '1')))
app.get('/api/plans/:vault/:slug', async (c) => {
  const { vault, slug } = c.req.param()
  const r = await wrap(async () => {
    const [row, files, contracts] = await Promise.all([
      harness.plans(true).then((all) => all.find((p) => p.slug === slug && p.vault === vault)),
      planops.files(vault, slug),
      planops.contracts(vault, slug),
    ])
    if (!row) throw new Error('plano não encontrado')
    const prototypeUp = row.prototypeUrl ? await planops.urlUp(row.prototypeUrl) : null
    return { ...row, prototypeUp, files: { plan: files.plan, tasks: files.tasks, execution: files.execution }, contracts }
  })
  return r.ok ? c.json(r.v) : bad(c, r.e, 404)
})
app.post('/api/plans/:vault/:slug/status', async (c) => {
  const { vault, slug } = c.req.param()
  const { status, by } = await c.req.json<{ status: string; by?: string }>()
  const r = await wrap(() => planops.setPlanStatus(vault, slug, status, by))
  return r.ok ? c.json(r.v) : bad(c, r.e)
})
app.post('/api/plans/:vault/:slug/gate/:task', async (c) => {
  const { vault, slug, task } = c.req.param()
  const r = await wrap(() => planops.approveGate(vault, slug, task))
  return r.ok ? c.json(r.v) : bad(c, r.e)
})
app.post('/api/plans/:vault/:slug/kb/:cmd', async (c) => {
  const { slug, cmd } = c.req.param()
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string; task?: string }
  if (!['check', 'freeze', 'unfreeze', 'frozen'].includes(cmd)) return bad(c, 'comando não permitido')
  const args = cmd === 'frozen' ? ['frozen', '--slug', slug] : [cmd, slug]
  if (cmd === 'unfreeze') {
    if (!body.reason?.trim()) return bad(c, 'unfreeze exige motivo')
    args.push('--reason', body.reason.trim())
  }
  if (cmd === 'check' && body.task) args.push('--task', body.task)
  return c.json(await planops.kbDev(args))
})

// ---------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------
app.get('/api/sessions', (c) => c.json(manager.list(c.req.query('archived') === '1')))

// Sessões persistidas em disco pelo CLI (~/.claude/projects) — para importar
app.get('/api/sessions/stored', async (c) => {
  const cwd = c.req.query('cwd') || undefined
  const rows = await listSessions({ dir: cwd, limit: Number(c.req.query('limit') ?? 30) })
  const known = new Set(manager.list(true).map((s) => s.sdkSessionId).filter(Boolean))
  return c.json(rows.map((r) => ({ ...r, imported: known.has(r.sessionId) })))
})

app.post('/api/sessions', async (c) => {
  const body = await c.req.json<{ cwd?: string; permissionMode?: any; model?: string; resume?: string; fork?: boolean; prompt?: string; title?: string }>()
  const st = getSettings()
  const s = manager.create({
    ...body,
    cwd: body.cwd || st.defaultCwd || process.cwd(),
    permissionMode: body.permissionMode ?? (st.defaultPermissionMode as any),
    model: body.model ?? st.defaultModel,
    importHistory: Boolean(body.resume),
  })
  return c.json(s.summary(), 201)
})

app.get('/api/sessions/:id', (c) => {
  const id = c.req.param('id')
  const s = manager.get(id)?.summary() ?? manager.stored(id)
  return s ? c.json(s) : bad(c, 'not found', 404)
})

app.delete('/api/sessions/:id', async (c) => {
  const id = c.req.param('id')
  manager.close(id)
  if (c.req.query('purge') === '1') await store.removeSession(id)
  else if (c.req.query('archive') === '1') await store.archiveSession(id, true)
  return c.json({ ok: true })
})

app.post('/api/sessions/:id/messages', async (c) => {
  const s = manager.revive(c.req.param('id'))
  if (!s) return bad(c, 'not found', 404)
  const { text } = await c.req.json<{ text: string }>()
  if (!text?.trim()) return bad(c, 'texto vazio')
  const r = await wrap(() => s.send(text))
  return r.ok ? c.json({ ok: true, state: s.state }) : bad(c, r.e)
})

app.post('/api/sessions/:id/interrupt', async (c) => {
  const s = manager.get(c.req.param('id'))
  if (!s) return bad(c, 'not found', 404)
  await s.interrupt()
  return c.json({ ok: true })
})

app.post('/api/sessions/:id/mode', async (c) => {
  const s = manager.revive(c.req.param('id'))
  if (!s) return bad(c, 'not found', 404)
  const { mode } = await c.req.json<{ mode: any }>()
  await s.setPermissionMode(mode)
  return c.json({ ok: true, permissionMode: s.permissionMode })
})

app.post('/api/sessions/:id/model', async (c) => {
  const s = manager.revive(c.req.param('id'))
  if (!s) return bad(c, 'not found', 404)
  const { model } = await c.req.json<{ model?: string }>()
  await s.setModel(model)
  return c.json({ ok: true, model: s.model })
})

app.post('/api/sessions/:id/permissions/:pid', async (c) => {
  const s = manager.get(c.req.param('id'))
  if (!s) return bad(c, 'not found', 404)
  const body = await c.req.json<{ behavior: 'allow' | 'deny'; always?: boolean; message?: string }>()
  const ok = s.resolvePermission(c.req.param('pid'), body)
  return ok ? c.json({ ok: true }) : bad(c, 'permissão não pendente', 404)
})

/**
 * Handoff web → CLI: fecha o processo daqui (duas instâncias na mesma sessão
 * brigariam pelo transcript) e devolve o comando de retomada. Com herdr,
 * abre um pane já rodando.
 */
app.post('/api/sessions/:id/handoff', async (c) => {
  const id = c.req.param('id')
  const s = manager.get(id)?.summary() ?? manager.stored(id)
  if (!s) return bad(c, 'not found', 404)
  if (!s.sdkSessionId) return bad(c, 'sessão ainda sem id do CLI (nenhum turno rodou)')
  const { openPane } = (await c.req.json().catch(() => ({}))) as { openPane?: boolean }
  manager.close(id, 'handed-off')
  const meta = store.getMeta(id)
  if (meta) await store.saveMeta({ ...meta, state: 'handed-off', updatedAt: Date.now() })
  const command = `claude --resume ${s.sdkSessionId}`
  const pane = openPane ? await herdr.openPane(command, s.cwd) : null
  return c.json({ command, cwd: s.cwd, pane })
})

// Stream de eventos (SSE): replay do disco a partir de ?since=<seq>, depois o vivo.
app.get('/api/sessions/:id/events', async (c) => {
  const id = c.req.param('id')
  const live = manager.get(id)
  const stored = manager.stored(id)
  if (!live && !stored) return bad(c, 'not found', 404)
  const since = Number(c.req.query('since') ?? 0)

  return streamSSE(c, async (stream) => {
    let closed = false
    let last = since
    const write = (e: UiEvent) => {
      if (closed || e.seq <= last) return
      last = e.seq
      void stream.writeSSE({ id: String(e.seq), event: e.kind, data: JSON.stringify(e) })
    }
    // Assina o vivo primeiro (bufferizando) para não perder nada entre o disco e o SSE.
    const buffer: UiEvent[] = []
    let replaying = true
    const unsub = live ? live.subscribe(Number.MAX_SAFE_INTEGER, (e) => (replaying ? buffer.push(e) : write(e))) : () => {}
    for (const e of await store.readEvents(id, since)) write(e)
    if (live) for (const e of live.events) write(e)
    replaying = false
    for (const e of buffer) write(e)
    if (!live) void stream.writeSSE({ event: 'status', data: JSON.stringify({ kind: 'status', state: stored!.state, seq: last, ts: Date.now(), stored: true }) })

    const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), 15000)
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve())
      c.req.raw.signal.addEventListener('abort', () => resolve())
    })
    closed = true
    clearInterval(ping)
    unsub()
  })
})

// Em modo mock a página sai com uma meta que liga o mock no front sem `?mock=1`.
if (MOCK) {
  const html = readFile('./web/index.html', 'utf8').then((s) => s.replace('<head>', '<head>\n<meta name="jarvis-mock" content="1">'))
  app.get('/', async (c) => c.html(await html))
  app.get('/index.html', async (c) => c.html(await html))
}
app.use('/*', serveStatic({ root: './web' }))

async function main() {
  if (!MOCK && !LOOPBACK_HOSTS.has(HOST) && !AUTH_TOKEN) {
    console.error(`jarvis: JARVIS_HOST=${HOST} expõe a API na rede; defina JARVIS_TOKEN ou volte para 127.0.0.1.`)
    process.exit(1)
  }
  if (!MOCK) {
    await loadSettings()
    await manager.boot()
    // Aquece o índice de custos e a sonda da conta sem bloquear o boot.
    void usage.refresh()
    void accountSnapshot(process.cwd())
  }
  serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    const env = ENV_FILE ? `env: ${ENV_FILE}` : 'env: nenhum arquivo'
    const url = `http://${info.address.includes(':') ? `[${info.address}]` : info.address}:${info.port}`
    if (MOCK) console.log(`jarvis MOCK em ${url}  (${env}; API desligada, dados de web/mock.js)`)
    else console.log(`jarvis web em ${url}  (${env}; token: ${AUTH_TOKEN ? 'sim' : 'não'}, cwd padrão: ${process.cwd()}, maxRunning: ${getSettings().maxRunning})`)
  })
  const bye = () => {
    manager.closeAll()
    setTimeout(() => process.exit(0), 300)
  }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}
void main()
