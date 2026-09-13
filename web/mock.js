// mock.js — fixtures no mesmo shape das rotas reais. Ativado por ?mock=1
// (persiste em sessionStorage). Serve ao gate TP: tudo navegável sem backend.

const DAY = 86400000
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10)

const daily = Array.from({ length: 30 }, (_, i) => {
  const t = now - (29 - i) * DAY
  const wave = 0.55 + 0.45 * Math.sin(i / 3.1) + (i % 7 === 0 ? -0.4 : 0)
  const cost = Math.max(0, Number((14 + wave * 22 + (i > 24 ? 9 : 0)).toFixed(4)))
  return { day: ymd(t), costUsd: cost, tokens: Math.round(cost * 920000), requests: Math.round(cost * 4.6) }
})
const today = daily[daily.length - 1]
const sum = (rows, k) => rows.reduce((a, b) => a + (b[k] || 0), 0)
const last7 = daily.slice(-7)
const prev7 = daily.slice(-14, -7)
const week = daily.slice(-6)
const month = daily

const MODELS = [
  { id: 'default', resolved: 'claude-opus-5[1m]', label: 'Default (recommended)', description: 'Opus 5 with 1M context · Best for everyday, complex tasks', effort: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'opus[1m]', resolved: 'claude-opus-5[1m]', label: 'Opus (1M context)', description: 'Opus 5 with 1M context', effort: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-fable-5-1[1m]', resolved: 'claude-fable-5-1', label: 'Fable', description: 'Fable 5.1 · Most capable for your hardest tasks', effort: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'haiku', resolved: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fastest for simple tasks' },
]

const mkUsage = (cost, ctx, win = 1000000, turns = 4) => ({
  costUsd: cost,
  input: Math.round(ctx * 0.6),
  output: Math.round(ctx * 0.08),
  cacheRead: Math.round(ctx * 3.1),
  cacheWrite: Math.round(ctx * 0.4),
  contextTokens: ctx,
  contextWindow: win,
  turns,
  byModel: [
    {
      model: 'claude-opus-5',
      costUsd: cost,
      input: Math.round(ctx * 0.6),
      output: Math.round(ctx * 0.08),
      cacheRead: Math.round(ctx * 3.1),
      cacheWrite: Math.round(ctx * 0.4),
      contextWindow: win,
    },
  ],
})

const SESSIONS = [
  {
    id: 'sess-jarvis-web',
    sdkSessionId: '00000000-0000-4000-8000-000000000001',
    title: 'Front-end do Jarvis (T07–T09)',
    cwd: '/home/user/code/worktrees/jarvis-jarvis-agenticos',
    model: 'default',
    permissionMode: 'default',
    state: 'running',
    createdAt: now - 52 * 60000,
    updatedAt: now - 12000,
    pendingPermissions: 1,
    usage: mkUsage(4.8213, 412000, 1000000, 17),
    live: true,
    lastSeq: 128,
  },
  {
    id: 'sess-pdfs',
    sdkSessionId: '00000000-0000-4000-8000-000000000002',
    title: 'Extrair PDFs para markdown',
    cwd: '/home/user/code/worktrees/app-b-T03-extract-markdown',
    model: 'claude-fable-5-1[1m]',
    permissionMode: 'acceptEdits',
    state: 'queued',
    createdAt: now - 3 * 3600000,
    updatedAt: now - 90000,
    pendingPermissions: 0,
    usage: mkUsage(1.2044, 96000, 200000, 6),
    live: true,
    lastSeq: 64,
  },
  {
    id: 'sess-brand-a',
    sdkSessionId: '00000000-0000-4000-8000-000000000003',
    title: 'Tokens do brand-a',
    cwd: '/home/user/code/app-c/apps/brand-a',
    model: 'opus[1m]',
    permissionMode: 'plan',
    state: 'closed',
    createdAt: now - 2 * DAY,
    updatedAt: now - 20 * 3600000,
    pendingPermissions: 0,
    usage: mkUsage(0.3319, 31000, 1000000, 3),
    live: false,
    lastSeq: 40,
  },
]

const PROJECTS = [
  { name: 'jarvis', path: '/home/user/code/jarvis', exists: true, monorepo: false, subprojects: [], groups: ['agent-os'], git: { branch: 'jarvis-agenticos', dirty: 5, ahead: 1 }, hasClaudeMd: true, hasGraph: true },
  { name: 'app-b', path: '/home/user/code/app-b', exists: true, monorepo: false, subprojects: [], groups: ['fitness'], git: { branch: 'main', dirty: 0, ahead: 0 }, hasClaudeMd: true, hasGraph: true },
  {
    name: 'app-c', path: '/home/user/code/app-c', exists: true, monorepo: true,
    subprojects: [
      { name: 'app-c-brand-a', path: '/home/user/code/app-c/apps/brand-a' },
      { name: 'app-c-brand-b', path: '/home/user/code/app-c/apps/brand-b' },
    ],
    groups: ['team', 'brand-b'], git: { branch: 'main', dirty: 2, ahead: 0 }, hasClaudeMd: true, hasGraph: true,
  },
  { name: 'app-d', path: '/home/user/code/app-d', exists: true, monorepo: false, subprojects: [], groups: ['team'], git: { branch: 'main', dirty: 0, ahead: 3 }, hasClaudeMd: true, hasGraph: false },
]

const PROJECTS_META = {
  codeDir: '/home/user/code',
  groups: [{ name: 'agent-os', title: 'Agent OS' }, { name: 'brand-b' }, { name: 'fitness', title: 'Fitness' }, { name: 'team' }],
  vaults: [
    { name: 'pessoal', path: '/home/user/code/vault-pessoal', default: true },
    { name: 'team', path: '/home/user/code/vault-team', default: false },
  ],
}

const WORKTREES = {
  '/home/user/code/jarvis': [
    { path: '/home/user/code/jarvis', head: '68bd810', branch: 'main', isMain: true, exists: true, dirty: 0 },
    { path: '/home/user/code/worktrees/jarvis-jarvis-agenticos', head: '68bd810', branch: 'jarvis-agenticos', isMain: false, exists: true, dirty: 5 },
  ],
  '/home/user/code/app-b': [
    { path: '/home/user/code/app-b', head: 'a1b2c3d', branch: 'main', isMain: true, exists: true, dirty: 0 },
    { path: '/home/user/code/worktrees/app-b-T03-extract-markdown', head: 'a1b2c3d', branch: 'T03-extract-markdown', isMain: false, exists: true, dirty: 2 },
  ],
}

const PLAN_MD = `## Objetivo

Transformar o Jarvis num **agenticOS** de verdade: sessões que sobrevivem ao reload,
dashboard de consumo e um console para o [[30-plans/devflow|ciclo do devflow]].

### Decisões

- UI vanilla (ES modules, sem build) — ver [[adr-sem-build]]
- Contrato congelado em \`behaviors.feature\`
- Protótipo navegável com \`?mock=1\` antes de qualquer código de produção

### Gates

| gate | estágio | o que aprova |
| --- | --- | --- |
| TP | prototype | UI navegável em 400px e 1440px |
| TB | behaviors | cenários Gherkin congelados |

> Contrato congelado não se edita para o código passar.
`

const TASKS = [
  { id: 'TP', title: 'Gate humano: protótipo navegável', status: 'todo', dependsOn: [], repo: 'jarvis', branch: 'jarvis-agenticos', gates: [], gate: 'human', stage: 'prototype', scope: ['web/'], ready: true },
  { id: 'TB', title: 'Gate humano: behaviors congelados', status: 'todo', dependsOn: ['TP'], repo: 'jarvis', branch: 'jarvis-agenticos', gates: [], gate: 'human', stage: 'behaviors', scope: ['behaviors.feature'], ready: false },
  { id: 'T01', title: 'Sessões persistentes e retomáveis', status: 'done', dependsOn: ['TB'], repo: 'jarvis', branch: 'jarvis-agenticos', gates: ['pnpm typecheck'], scope: ['src/agent.ts src/store.ts'], ready: false },
  { id: 'T07', title: 'Shell mobile-first + dashboard', status: 'in-progress', dependsOn: ['T01'], repo: 'jarvis', branch: 'jarvis-agenticos', gates: ['pnpm typecheck'], scope: ['web/'], ready: true },
  { id: 'T08', title: 'Sessões e chat', status: 'todo', dependsOn: ['T07'], repo: 'jarvis', branch: 'jarvis-agenticos', gates: [], scope: ['web/views/sessions.js'], ready: false },
]

const PLANS = [
  {
    slug: 'jarvis-agenticos', vault: 'pessoal', visibility: 'private',
    title: 'Jarvis agenticOS — UI mobile-first, dashboard, sessões persistentes e console do devflow',
    status: 'ready-for-review', projects: ['jarvis'], groups: ['agent-os'],
    stack: ['node', 'typescript', 'hono', 'claude-agent-sdk', 'vanilla-web'],
    progress: { done: 1, total: 12, source: 'tasks' }, tasks: TASKS, ready: ['TP'], openGates: 2,
    frozen: [], contracts: ['behaviors.feature'], prototypeUrl: 'http://localhost:4747/?mock=1',
    worktree: '/home/user/code/worktrees/jarvis-jarvis-agenticos', approvedBy: null,
    gates: [{ id: 'TB', stage: 'behaviors', status: 'todo' }, { id: 'TP', stage: 'prototype', status: 'todo' }],
    lastExecution: { day: ymd(now), ts: now - 300000 },
    path: '/home/user/code/vault-pessoal/30-plans/jarvis-agenticos',
  },
  {
    slug: 'pdfs-para-markdown', vault: 'team', visibility: 'team',
    title: 'Fase 0 — Acervo: 71 PDFs para markdown', status: 'approved',
    projects: ['app-b'], groups: ['fitness'], stack: ['node', 'python'],
    progress: { done: 3, total: 6, source: 'tasks' }, tasks: [], ready: ['T03'], openGates: 0,
    frozen: [{ file: 'behaviors.feature', frozenAt: iso(now - 2 * DAY) }], contracts: ['behaviors.feature'],
    prototypeUrl: null, worktree: '/home/user/code/worktrees/app-b-T03-extract-markdown',
    approvedBy: 'user',
    gates: [{ id: 'T01', stage: 'spike', status: 'done' }, { id: 'TB', stage: 'behaviors', status: 'done' }],
    lastExecution: { day: ymd(now - DAY), ts: now - DAY }, path: '/home/user/code/vault-team/30-plans/pdfs-para-markdown',
  },
  {
    slug: 'billing-metadata', vault: 'team', visibility: 'team',
    title: 'Billing metadata no app-c', status: 'in-progress',
    projects: ['app-c'], groups: ['team'], stack: ['typescript'],
    progress: { done: 4, total: 9, source: 'tasks' }, tasks: [], ready: ['T06'], openGates: 0,
    frozen: [{ file: 'behaviors.feature', frozenAt: iso(now - 5 * DAY) }], contracts: ['behaviors.feature'],
    prototypeUrl: 'http://localhost:4100', worktree: '/home/user/code/worktrees/app-c-T05-mig-billing-metadata',
    approvedBy: 'user', gates: [{ id: 'TB', stage: 'behaviors', status: 'done' }],
    lastExecution: null, path: '/home/user/code/vault-team/30-plans/billing-metadata',
  },
]

const OVERVIEW = {
  generatedAt: now,
  account: { email: 'user@example.com', subscription: 'max', provider: 'firstParty', apiKeySource: undefined, error: undefined, fetchedAt: now - 60000 },
  rateLimits: {
    available: true,
    windows: [
      { key: 'session', label: 'janela de 5h', percent: 41, resetsAt: iso(now + 2.4 * 3600000), active: true, severity: 'normal' },
      { key: 'weekly', label: 'semana (todos os modelos)', percent: 68, resetsAt: iso(now + 3.2 * DAY), severity: 'warning' },
      { key: 'weekly_fable', label: 'semana (Fable)', percent: 92, resetsAt: iso(now + 3.2 * DAY), scope: 'fable', severity: 'critical' },
      { key: 'weekly_opus', label: 'semana (Opus)', percent: null, resetsAt: null },
    ],
  },
  models: MODELS,
  mcp: [
    { name: 'playwright', status: 'connected' },
    { name: 'chrome-devtools', status: 'pending' },
    { name: 'claude.ai Gmail', status: 'needs-auth', error: 'token expirado' },
  ],
  live: { sessions: 3, running: 1, queued: 1, maxRunning: 2, pendingPermissions: 1, costUsd: 6.3576, contextTokens: 508000 },
  settings: { maxRunning: 2, defaultPermissionMode: 'default', defaultModel: 'default', defaultCwd: '/home/user/code/jarvis' },
  sessions: SESSIONS,
  agents: [
    { terminalId: 'term_a1', agent: 'claude', status: 'working', title: 'Plan extraction PDFs', cwd: '/home/user/code/app-b', workspaceId: 'w2N', paneId: 'w2N:p1', focused: false },
    { terminalId: 'term_a2', agent: 'claude', status: 'blocked', title: 'Migração billing', cwd: '/home/user/code/app-c', workspaceId: 'w3A', paneId: 'w3A:p2', focused: false },
    { terminalId: 'term_a3', agent: 'claude', status: 'idle', title: 'Claude Code', cwd: '/home/user/code/jarvis', workspaceId: 'w1', paneId: 'w1:p3', focused: true },
  ],
  plans: PLANS.map((p) => ({ slug: p.slug, vault: p.vault, title: p.title, status: p.status, progress: p.progress, ready: p.ready, gates: p.gates, openGates: p.openGates, frozen: p.frozen.length, prototypeUrl: p.prototypeUrl, projects: p.projects })),
  repoRisk: [
    { name: 'jarvis', path: '/home/user/code/jarvis', branch: 'jarvis-agenticos', dirty: 5, ahead: 1 },
    { name: 'app-c', path: '/home/user/code/app-c', branch: 'main', dirty: 2, ahead: 0 },
  ],
  prototypes: [
    { app: 'brand-a', path: '/home/user/code/app-c/apps/brand-a', port: 4100, url: 'http://localhost:4100', up: true },
    { app: 'brand-b', path: '/home/user/code/app-c/apps/brand-b', port: 4000, url: 'http://localhost:4000', up: false },
    { app: 'brand-c', path: '/home/user/code/app-c/apps/brand-c', port: 4106, url: null, up: null },
  ],
  orphanWorktrees: ['/home/user/code/worktrees/app-d-white-label', '/home/user/code/worktrees/app-c-T05-mig-billing-metadata'],
}

const byModelMonth = [
  { model: 'claude-opus-5', costUsd: 412.83, tokens: 604_000_000, requests: 3120 },
  { model: 'claude-fable-5-1', costUsd: 108.81, tokens: 146_000_000, requests: 577 },
  { model: 'claude-sonnet-5', costUsd: 44.12, tokens: 88_000_000, requests: 910 },
  { model: 'claude-haiku-4-5', costUsd: 6.4, tokens: 22_000_000, requests: 1204 },
  { model: 'claude-opus-4-8', costUsd: 2.1, tokens: 4_000_000, requests: 60 },
]

const USAGE = {
  daily,
  byModel: byModelMonth,
  byProject: [
    { project: '-home-user-code-app-d', projectPath: '/home/user/code/app-d', costUsd: 242.93, tokens: 336_000_000, sessions: 26 },
    { project: '-home-user-code-jarvis', projectPath: '/home/user/code/jarvis', costUsd: 188.4, tokens: 251_000_000, sessions: 14 },
    { project: '-home-user-code-app-c', projectPath: '/home/user/code/app-c', costUsd: 96.2, tokens: 130_000_000, sessions: 31 },
    { project: '-home-user-code-app-b', projectPath: '/home/user/code/app-b', costUsd: 41.05, tokens: 60_000_000, sessions: 9 },
  ],
  totals: { costUsd: sum(daily, 'costUsd'), tokens: sum(daily, 'tokens'), requests: sum(daily, 'requests'), sessions: 124 },
  today: { costUsd: today.costUsd, tokens: today.tokens, requests: today.requests },
  windows: {
    today: { from: today.day, costUsd: today.costUsd, tokens: today.tokens, requests: today.requests, byModel: byModelMonth.slice(0, 2).map((m) => ({ model: m.model, costUsd: m.costUsd / 22, tokens: Math.round(m.tokens / 22) })) },
    week: { from: week[0].day, costUsd: sum(week, 'costUsd'), tokens: sum(week, 'tokens'), requests: sum(week, 'requests'), byModel: byModelMonth.slice(0, 3).map((m) => ({ model: m.model, costUsd: m.costUsd / 4, tokens: Math.round(m.tokens / 4) })) },
    month: { from: month[0].day, costUsd: sum(month, 'costUsd'), tokens: sum(month, 'tokens'), requests: sum(month, 'requests'), byModel: byModelMonth.map((m) => ({ model: m.model, costUsd: m.costUsd, tokens: m.tokens })) },
  },
  last7: { costUsd: sum(last7, 'costUsd'), prev7: sum(prev7, 'costUsd') },
  scannedFiles: 138,
  generatedAt: now,
}

const USAGE_SESSIONS = SESSIONS.map((s, i) => ({
  sessionId: s.sdkSessionId,
  project: s.cwd.replace(/\//g, '-'),
  projectPath: s.cwd,
  cwd: s.cwd,
  gitBranch: ['jarvis-agenticos', 'T03-extract-markdown', 'main'][i],
  title: s.title,
  firstTs: s.createdAt,
  lastTs: s.updatedAt,
  userTurns: s.usage.turns,
  costUsd: s.usage.costUsd,
  tokens: s.usage.contextTokens * 4,
  models: [s.usage.byModel[0].model],
}))

const STORED = [
  { sessionId: '00000000-0000-4000-8000-000000000004', summary: 'interface mobile first com dashboard', lastModified: now - 3600000, cwd: '/home/user/code/jarvis', gitBranch: 'jarvis-agenticos', firstPrompt: 'deixa a interface mobile first e expansível para desktop…', imported: false },
  { sessionId: '00000000-0000-4000-8000-000000000005', summary: 'kb dev: congelar contrato do plano', lastModified: now - 3 * DAY, cwd: '/home/user/code/kb-cli', gitBranch: 'main', firstPrompt: 'implementa o freeze do contrato com registro de motivo', imported: true },
]

const CONTRACT = `# language: pt
Funcionalidade: Dashboard do Jarvis

  Cenário: janelas da subscription
    Dado que a conta tem subscription ativa
    Quando eu abro a home
    Então vejo o percentual e o horário de reset de cada janela

  Cenário: sem janelas (API key)
    Dado que a conta usa API key
    Então vejo "janelas indisponíveis (API key)"
`

const PLAN_DETAIL = {
  ...PLANS[0],
  prototypeUp: true,
  files: {
    plan: { name: '_plan.md', path: '/home/user/code/vault-pessoal/30-plans/jarvis-agenticos/_plan.md', markdown: PLAN_MD, fm: { status: 'ready-for-review', projects: ['jarvis'], created: ymd(now) } },
    tasks: TASKS.map((t) => ({ name: `tasks/${t.id}.md`, path: `/vault/30-plans/jarvis-agenticos/tasks/${t.id}.md`, markdown: `## ${t.id} — ${t.title}\n\nEscopo: \`${t.scope.join(' ')}\`\n`, fm: { id: t.id, status: t.status } })),
    execution: [{ name: `execution/${ymd(now)}.md`, markdown: `## ${ymd(now)}\n\n- T01 concluída (sessões persistentes)\n- Protótipo no ar em \`?mock=1\`\n` }],
  },
  contracts: [{ file: 'behaviors.feature', path: '/home/user/code/worktrees/jarvis-jarvis-agenticos/behaviors.feature', exists: true, content: CONTRACT, frozen: false, frozenAt: null, drifted: false }],
}

// --- estado mutável do mock ------------------------------------------------
const state = {
  settings: { ...OVERVIEW.settings },
  planStatus: {},
  gates: {},
  frozen: {},
}

const clone = (v) => JSON.parse(JSON.stringify(v))
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function planDetail() {
  const d = clone(PLAN_DETAIL)
  const st = state.planStatus['pessoal/jarvis-agenticos']
  if (st) d.status = st
  d.gates = d.gates.map((g) => (state.gates[g.id] ? { ...g, status: 'done' } : g))
  d.tasks = d.tasks.map((t) => (state.gates[t.id] ? { ...t, status: 'done' } : t))
  d.openGates = d.gates.filter((g) => g.status !== 'done').length
  if (state.frozen['behaviors.feature']) {
    d.contracts[0].frozen = true
    d.contracts[0].frozenAt = iso(Date.now())
    d.frozen = [{ file: 'behaviors.feature', frozenAt: d.contracts[0].frozenAt }]
  }
  return d
}

/** api() do app.js delega para cá quando o mock está ligado. */
export async function mockApi(path, opts = {}) {
  await delay(90 + Math.random() * 120)
  const [route, qs] = path.split('?')
  const q = new URLSearchParams(qs || '')
  const method = (opts.method || 'GET').toUpperCase()
  const body = typeof opts.body === 'string' ? JSON.parse(opts.body || '{}') : opts.body || {}

  if (route === '/api/overview') return { ...clone(OVERVIEW), settings: clone(state.settings), live: { ...OVERVIEW.live, maxRunning: state.settings.maxRunning } }
  if (route === '/api/usage') return clone(USAGE)
  if (route === '/api/usage/sessions') return clone(USAGE_SESSIONS)
  if (route === '/api/settings') {
    if (method === 'PATCH') Object.assign(state.settings, body)
    return clone(state.settings)
  }
  if (route === '/api/projects/meta') return clone(PROJECTS_META)
  if (route === '/api/projects' && method === 'POST') {
    const name = String(body.name || '').trim()
    const bad = (msg) => Object.assign(new Error(msg), { status: 400 })
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) throw bad(`nome inválido: ${name || '(vazio)'}`)
    const path = `${PROJECTS_META.codeDir}/${name}`
    if (PROJECTS.some((p) => p.path === path)) throw bad(`já existe: ${path}`)
    // nome registrado no kb com path fora de codeDir (ex.: ds-agent)
    const kbHit = PROJECTS.find((p) => p.name === name) || (name === 'ds-agent' ? { path: '/home/user/labs/ds-agent' } : null)
    if (kbHit) throw bad(`nome já registrado no kb: ${name} → ${kbHit.path}`)
    await delay(1200) // bootstrap real leva segundos (kb + graphify)
    const vault = PROJECTS_META.vaults.find((v) => v.name === body.vault) || PROJECTS_META.vaults.find((v) => v.default)
    const vaultHome = `${vault.path}/10-projects/${name}`
    // nome com "semkb" simula o kb falhando: projeto criado, mas sem registro
    const registered = !name.includes('semkb')
    PROJECTS.push({ name, path, exists: true, monorepo: false, subprojects: [], groups: body.group ? [body.group] : [], git: { branch: 'main', dirty: 0, ahead: 0 }, hasClaudeMd: true, hasGraph: true })
    const log = [
      `$ git init -b main ${path}`,
      `Initialized empty Git repository in ${path}/.git/`,
      `README.md escrito (${body.description ? 'com a descrição' : 'só o título'})`,
      `$ kb project add ${path}${body.group ? ` --group ${body.group}` : ''}`,
      registered ? `✓ ${name} registrado no grafo central` : '✗ kb project add falhou: grafo central indisponível',
      `$ kb new --type project ${name} --vault ${vault.name}`,
      `✓ ${vaultHome}/_project.md`,
      `$ kb project link-claude ${path}`,
      '✓ CLAUDE.md com ponteiro para o vault',
      `$ kb vault index ${vault.name}`,
      `$ git -C ${path} commit -m "chore: projeto ${name}"`,
      `[main (root-commit) 1a2b3c4] chore: projeto ${name}`,
    ]
    return { name, path, vaultHome, registered, log }
  }
  if (route === '/api/projects') return clone(PROJECTS)
  if (route === '/api/projects/worktrees') {
    if (method === 'POST') {
      const created = { path: `/home/user/code/worktrees/mock-${body.branch}`, branch: body.branch, head: 'aaaaaaa', isMain: false, exists: true, dirty: 0 }
      ;(WORKTREES[body.repoPath] ||= []).push(created)
      return { path: created.path, branch: created.branch, log: [`git worktree add ${created.path} ${body.branch}`, 'ok'] }
    }
    if (method === 'DELETE' && body.repoPath) {
      WORKTREES[body.repoPath] = (WORKTREES[body.repoPath] || []).filter((w) => w.path !== body.path)
      return { ok: true }
    }
    if (method === 'DELETE') return { ok: true }
    return clone(WORKTREES[q.get('path')] || [])
  }
  if (route === '/api/agents') return clone(OVERVIEW.agents)
  if (/^\/api\/agents\/.+\/focus$/.test(route)) return { ok: true }
  if (route === '/api/plans') return clone(PLANS)
  if (route === '/api/plans/pessoal/jarvis-agenticos') return planDetail()
  const pm = route.match(/^\/api\/plans\/([^/]+)\/([^/]+)(\/.*)?$/)
  if (pm) {
    const [, vault, slug, rest] = pm
    if (!rest) {
      const p = PLANS.find((x) => x.vault === vault && x.slug === slug)
      if (!p) throw new Error('plano não encontrado')
      return { ...clone(p), prototypeUp: p.prototypeUrl ? false : null, files: { plan: { name: '_plan.md', path: p.path + '/_plan.md', markdown: `## ${p.title}\n\nPlano de exemplo do mock.\n`, fm: {} }, tasks: [], execution: [] }, contracts: [] }
    }
    if (rest === '/status') {
      state.planStatus[`${vault}/${slug}`] = body.status
      return { ...clone(PLANS.find((x) => x.slug === slug)), status: body.status }
    }
    const gm = rest.match(/^\/gate\/(.+)$/)
    if (gm) {
      state.gates[gm[1]] = true
      return { ok: true, task: gm[1], status: 'done' }
    }
    const km = rest.match(/^\/kb\/(.+)$/)
    if (km) {
      const cmd = km[1]
      if (cmd === 'freeze') state.frozen['behaviors.feature'] = true
      if (cmd === 'unfreeze') delete state.frozen['behaviors.feature']
      return { ok: true, code: 0, output: `$ kb dev ${cmd} ${slug}\n[mock] ${cmd} executado com sucesso\ncontratos: behaviors.feature\n` }
    }
  }
  if (route === '/api/sessions') {
    if (method === 'POST') {
      const s = { ...clone(SESSIONS[0]), id: 'sess-mock-' + Math.random().toString(36).slice(2, 7), title: body.title || body.prompt?.slice(0, 40) || 'nova sessão', cwd: body.cwd || '/home/user/code/jarvis', state: 'starting', pendingPermissions: 0, lastSeq: 0 }
      SESSIONS.unshift(s)
      return s
    }
    return clone(SESSIONS)
  }
  if (route === '/api/sessions/stored') return clone(STORED)
  const sm = route.match(/^\/api\/sessions\/([^/]+)(\/.*)?$/)
  if (sm) {
    const [, id, rest] = sm
    const s = SESSIONS.find((x) => x.id === id)
    if (!rest) {
      if (method === 'DELETE') return { ok: true }
      if (!s) throw new Error('not found')
      return clone(s)
    }
    if (rest === '/messages') return { ok: true, state: 'running' }
    if (rest === '/interrupt') return { ok: true }
    if (rest === '/mode') { if (s) s.permissionMode = body.mode; return { ok: true, permissionMode: body.mode } }
    if (rest === '/model') { if (s) s.model = body.model; return { ok: true, model: body.model } }
    if (rest.startsWith('/permissions/')) return { ok: true }
    if (rest === '/handoff') return { command: `claude --resume ${s?.sdkSessionId || id}`, cwd: s?.cwd || '/home/user/code/jarvis', pane: body.openPane ? { paneId: 'w1:p9' } : null }
  }
  throw new Error(`[mock] rota não mapeada: ${method} ${path}`)
}

// --- SSE falso -------------------------------------------------------------

const SCRIPT = [
  [300, 'user_text', { text: 'Implementa o dashboard do Jarvis com os widgets de janela da subscription.' }],
  // o SDK ecoa o input do usuário como `user`/isReplay — a UI não pode duplicar
  [120, 'sdk', { msg: { type: 'user', isReplay: true, message: { content: [{ type: 'text', text: 'Implementa o dashboard do Jarvis com os widgets de janela da subscription.' }] } } }],
  [700, 'status', { state: 'running' }],
  [500, 'sdk', { msg: { type: 'system', subtype: 'init', model: 'claude-opus-5', cwd: '/home/user/code/jarvis' } }],
  [900, 'sdk', { msg: { type: 'assistant', message: { content: [{ type: 'text', text: 'Vou começar lendo o **shell** já existente para reaproveitar as classes do CSS.\n\n- `web/index.html`\n- `web/app.css`' }] } } }],
  [800, 'sdk', { msg: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_mock1', name: 'Read', input: { file_path: '/home/user/code/jarvis/web/app.css' } }] } } }],
  [900, 'sdk', { msg: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_mock1', content: '1→/* ---------- tokens ---------- */\n2→:root { --bg:#0f1115; … }\n(+180 linhas)' }] } } }],
  [800, 'sdk', { msg: { type: 'assistant', message: { content: [{ type: 'text', text: 'Agora crio `web/views/home.js` com os widgets na ordem de importância.' }] } } }],
  [700, 'permission_request', { id: 'perm_mock1', toolName: 'Write', input: { file_path: '/home/user/code/jarvis/web/views/home.js', content: 'export async function render(root) { … }' }, title: 'Escrever web/views/home.js', description: 'Cria a view do dashboard', decisionReason: 'arquivo novo fora da allowlist', hasSuggestions: true }],
  [2600, 'sdk', { msg: { type: 'assistant', message: { content: [{ type: 'text', text: 'Arquivo criado. O dashboard já renderiza as três janelas com meter e horário de reset.' }] } } }],
  [600, 'usage', { usage: mkUsage(4.9012, 431000, 1000000, 18) }],
  [400, 'sdk', { msg: { type: 'result', subtype: 'success', num_turns: 18, duration_ms: 41230, total_cost_usd: 4.9012, is_error: false } }],
  [200, 'status', { state: 'idle' }],
]

/**
 * EventSource falso: mesma superfície (addEventListener/close) do real. O que
 * já foi emitido fica guardado por sessão, então reabrir com ?since faz replay
 * do trecho perdido e retoma o roteiro de onde parou — sem duplicar nada.
 */
const streams = new Map() // sessionId → { seq, log:[], step }

function streamState(id) {
  if (!streams.has(id)) streams.set(id, { seq: 0, log: [], step: 0 })
  return streams.get(id)
}

export class MockEventSource {
  constructor(url, { since = 0, sessionId } = {}) {
    this.url = url
    this.id = sessionId || String(url)
    this.since = Number(since) || 0
    this.readyState = 1
    this.listeners = new Map()
    this.closed = false
    this.st = streamState(this.id)
    queueMicrotask(() => this.start())
  }

  addEventListener(kind, fn) {
    if (!this.listeners.has(kind)) this.listeners.set(kind, new Set())
    this.listeners.get(kind).add(fn)
  }

  removeEventListener(kind, fn) {
    this.listeners.get(kind)?.delete(fn)
  }

  close() {
    this.closed = true
    this.readyState = 2
  }

  emit(e) {
    if (this.closed) return
    const data = JSON.stringify(e)
    for (const fn of this.listeners.get(e.kind) || []) fn({ data, lastEventId: String(e.seq) })
  }

  /** Efêmero (stream_event) não entra no log, igual ao servidor real. */
  fire(kind, body, { ephemeral = false } = {}) {
    if (this.closed) return
    const e = { ...body, kind, seq: ++this.st.seq, ts: Date.now() }
    if (!ephemeral) this.st.log.push(e)
    this.emit(e)
  }

  async start() {
    for (const e of this.st.log) {
      if (this.closed) return
      if (e.seq > this.since) this.emit(e)
    }
    await this.play()
  }

  async play() {
    while (this.st.step < SCRIPT.length) {
      const [ms, kind, body] = SCRIPT[this.st.step]
      await delay(ms)
      if (this.closed) return
      if (kind === 'sdk' && body.msg.type === 'assistant' && body.msg.message.content[0]?.type === 'text') {
        // streaming: entrega o texto em deltas antes da mensagem final
        const full = body.msg.message.content[0].text
        for (let i = 0; i < full.length; i += 14) {
          await delay(28)
          if (this.closed) return
          this.fire(
            'sdk',
            { msg: { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: full.slice(i, i + 14) } } } },
            { ephemeral: true },
          )
        }
      }
      this.st.step++
      this.fire(kind, body)
    }
  }
}
