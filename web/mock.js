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
- Contrato congelado em \`behaviors/jarvis.feature.md\`
- Protótipo navegável com \`?mock=1\` antes de qualquer código de produção

### Gates

| gate | estágio | o que aprova |
| --- | --- | --- |
| TP | prototype | UI navegável em 400px e 1440px |
| TB | behaviors | cenários Gherkin congelados |

> Contrato congelado não se edita para o código passar.

## DAG / paralelismo

\`\`\`mermaid
graph LR
  TP[TP protótipo ⛔] --> TB[TB contrato ⛔🧊]
  TB --> T01[T01 sessões persistentes]
  T01 --> T07[T07 shell mobile-first]
  T07 --> T08[T08 sessões e chat]
  T07 --> T09[T09 console do devflow]
\`\`\`

Onda 1: T01. Onda 2: T07. Onda 3: T08 ∥ T09 — escopos disjuntos (\`sessions.js\` vs \`plans.js\`).

## Fluxo de uma sessão

\`\`\`mermaid
sequenceDiagram
  participant B as browser
  participant J as jarvis (hono)
  participant S as agent sdk
  B->>J: POST /api/sessions {cwd, prompt}
  J->>S: query() streaming-input
  S-->>J: eventos (seq)
  J-->>B: SSE /events?since=seq
  B->>J: POST /permissions/:pid {allow}
  J->>S: canUseTool → allow
\`\`\`

## Spec

### API

\`\`\`
GET  /api/sessions/:id/events?since=   SSE: replay do disco + vivo
POST /api/sessions/:id/messages        { text }  — sessão gravada revive sozinha
\`\`\`

### Persistência (\`src/store.ts\`)

\`\`\`ts
export interface SessionMeta {
  id: string
  sdkSessionId?: string
  cwd: string
  state: 'starting' | 'running' | 'idle' | 'closed'
  updatedAt: number
}
export async function append(id: string, e: SessionEvent) {
  await appendFile(join(DIR, id, 'events.jsonl'), JSON.stringify(e) + '\\n')
}
\`\`\`

### Rodar

\`\`\`bash
pnpm install
cp .env.example .env
JARVIS_TOKEN=$(openssl rand -hex 16) pnpm dev   # http://localhost:4747
\`\`\`

Exemplo de evento gravado:

\`\`\`json
{ "seq": 41, "kind": "permission_request", "toolName": "Write", "ts": 1757700000000 }
\`\`\`
`

const TASKS = [
  { id: 'TP', title: 'Gate humano: protótipo navegável', status: 'todo', dependsOn: [], repo: 'jarvis', branch: 'TP-jarvis-agenticos-proto', gates: ['pnpm typecheck'], gate: 'human', stage: 'prototype', scope: ['web/views/home.js', 'web/views/plans.js', 'web/mock.js', 'web/app.css'], ready: true },
  { id: 'TB', title: 'Gate humano: behaviors congelados', status: 'todo', dependsOn: ['TP'], repo: 'pessoal', branch: 'TB-jarvis-agenticos-contrato', gates: [], gate: 'human', stage: 'behaviors', scope: ['10-projects/jarvis/behaviors/jarvis.feature.md'], ready: false },
  { id: 'T01', title: 'Sessões persistentes e retomáveis', status: 'done', dependsOn: ['TB'], repo: 'jarvis', branch: 'T01-jarvis-agenticos-sessoes', gates: ['pnpm typecheck'], scope: ['src/agent.ts', 'src/store.ts', 'src/server.ts'], ready: false },
  { id: 'T07', title: 'Shell mobile-first + dashboard', status: 'in-progress', dependsOn: ['T01'], repo: 'jarvis', branch: 'T07-jarvis-agenticos-shell', gates: ['pnpm typecheck', 'node --check web/app.js'], scope: ['web/index.html', 'web/app.js', 'web/app.css', 'web/views/home.js', 'web/charts.js'], ready: true },
  { id: 'T08', title: 'Sessões e chat', status: 'todo', dependsOn: ['T07'], repo: 'jarvis', branch: 'T08-jarvis-agenticos-chat', gates: ['pnpm typecheck'], scope: ['web/views/sessions.js'], ready: false },
  { id: 'T09', title: 'Console do devflow (planos, gates, freeze)', status: 'todo', dependsOn: ['T07'], repo: 'jarvis', branch: 'T09-jarvis-agenticos-planos', gates: ['pnpm typecheck'], scope: ['web/views/plans.js', 'src/planops.ts'], ready: false },
]

const TASK_BODY = {
  TP: `## Contexto (mínimo)

O protótipo do devflow é o **modo mock** do próprio app: \`pnpm dev:mock\` sobe em
\`http://localhost:4748\` só com estáticos e \`web/mock.js\` responde \`/api/*\`.

## Passos

1. Shell mobile-first (topbar + tabbar) e a Home com os widgets na ordem de importância.
2. Iterar por screenshot (400 px e 1280 px) até o usuário aprovar.

## Done-criteria

- [ ] Navegável em modo mock sem erro no console.
- [ ] ⛔ **GATE**: usuário aprovou o layout.
`,
  TB: `## Passos

1. \`kb new --vault pessoal --type contract --project jarvis --title "jarvis" --plan jarvis-agenticos\`
2. Declarar em \`contracts:\` no \`_plan.md\`.
3. ⛔ **GATE**: usuário lê e aprova. Depois \`kb dev freeze jarvis-agenticos\`.
`,
  T01: `## Contexto (mínimo)

\`AgentSession\` embrulha um \`query()\` em streaming-input; cada evento ganha \`seq\`
e vai para \`sessions/<id>/events.jsonl\`. Reviver = \`resume\` com o id do CLI.

## Passos

1. \`src/store.ts\`: \`append(id, event)\` e \`readSince(id, seq)\`.
2. \`src/agent.ts\`: buffer em memória + flush por evento; \`revive()\`.
3. \`src/server.ts\`: \`GET /events?since=\` faz replay do disco antes do vivo.

\`\`\`ts
for await (const e of readSince(id, since)) send(e)   // replay
session.on('event', send)                              // vivo
\`\`\`

## Done-criteria

- [x] Reload não perde histórico. Dois devices recebem o mesmo evento.
- [x] \`pnpm typecheck\` verde. Diff ⊆ \`scope\`.
`,
  T07: `## Contexto (mínimo)

Shell em grid (\`topbar / view / tabbar\`), sidebar a partir de 900 px. Widgets da Home
em ordem: janelas da subscription, custo, sessões vivas, permissões, frota, gates.

## Passos

1. \`web/app.css\`: tokens + shell responsivo.
2. \`web/views/home.js\`: um widget por função, nenhum quebra com campo ausente.
3. \`web/charts.js\`: sparkline e barras em SVG puro.

## Comandos / gates

- \`pnpm typecheck\` · \`node --check web/app.js\`

## Done-criteria

- [x] Home em 400 px sem scroll horizontal.
- [ ] Sparkline com 30 dias.
`,
  T08: `## Passos

1. Lista de sessões (vivas ∪ gravadas) com filtro.
2. Chat com SSE, tool calls colapsáveis e cards de permissão.
`,
  T09: `## Passos

1. Lista de planos com progresso e gates.
2. Detalhe com abas; freeze/unfreeze/check via \`kb dev\`.
`,
}

const PLANS = [
  {
    slug: 'jarvis-agenticos', vault: 'pessoal', visibility: 'private',
    title: 'Jarvis agenticOS — UI mobile-first, dashboard, sessões persistentes e console do devflow',
    status: 'ready-for-review', projects: ['jarvis'], groups: ['agent-os'],
    stack: ['node', 'typescript', 'hono', 'claude-agent-sdk', 'vanilla-web'],
    progress: { done: 1, total: 6, source: 'tasks' }, tasks: TASKS, ready: ['TP'], openGates: 2,
    frozen: [], contracts: ['jarvis/behaviors/jarvis.feature.md'], prototypeUrl: 'http://localhost:4747/?mock=1',
    worktree: '/home/user/code/worktrees/jarvis-jarvis-agenticos', approvedBy: null,
    gates: [{ id: 'TB', stage: 'behaviors', status: 'todo' }, { id: 'TP', stage: 'prototype', status: 'todo' }],
    lastExecution: { day: ymd(now), ts: now - 300000 },
    path: '/home/user/code/vault-pessoal/30-plans/jarvis-agenticos',
    activity: { state: 'working', since: now - 12000, reason: 'agente trabalhando em T07 (w1:p3)' },
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
    activity: { state: 'waiting-human', since: now - 40 * 60000, reason: 'T03 em review' },
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
    activity: { state: 'stale', since: now - 2 * DAY, reason: 'parado há 2 d — última atividade no CLI' },
  },
  {
    slug: 'kb-doctor', vault: 'pessoal', visibility: 'private',
    title: 'kb doctor — diagnóstico do workspace', status: 'done',
    projects: ['kb-cli'], groups: ['agent-os'], stack: ['node'],
    progress: { done: 3, total: 3, source: 'tasks' }, tasks: [], ready: [], openGates: 0,
    frozen: [], contracts: [], prototypeUrl: null, worktree: null, approvedBy: 'user', gates: [],
    lastExecution: { day: ymd(now - 4 * DAY), ts: now - 4 * DAY }, path: '/home/user/code/vault-pessoal/30-plans/kb-doctor',
    activity: { state: 'done', since: now - 4 * DAY, reason: 'concluído' },
  },
]

// Só com ?archived=1 (30-plans/_archive/**): histórico, não ruído na lista.
const ARCHIVED = [
  {
    slug: 'onda1-dx', vault: 'pessoal', visibility: 'private', title: 'Onda 1 — DX do harness (kb status, kb map, guard)',
    status: 'done', projects: ['kb-cli'], groups: ['agent-os'], stack: ['node'],
    progress: { done: 5, total: 5, source: 'tasks' }, tasks: [], ready: [], openGates: 0, frozen: [], contracts: [],
    prototypeUrl: null, worktree: null, approvedBy: 'user', gates: [],
    lastExecution: { day: ymd(now - 9 * DAY), ts: now - 9 * DAY }, path: '/home/user/code/vault-pessoal/30-plans/_archive/onda1-dx',
    activity: { state: 'done', since: now - 9 * DAY, reason: 'concluído' },
  },
]

// Atividade inferida por plano — shape de GET /api/plans/:vault/:slug/activity.
const WT = '/home/user/code/worktrees'
const ACTIVITY = {
  'pessoal/jarvis-agenticos': {
    state: 'working', since: now - 12000, reason: 'agente trabalhando em T07 (w1:p3)', herdr: true,
    waiting: ['aguardando aprovação do TP', 'permissão pendente em "Front-end do Jarvis (T07–T09)"'],
    agents: [
      { paneId: 'w1:p3', status: 'working', title: 'T07 shell mobile-first + dashboard', cwd: `${WT}/jarvis-T07-jarvis-agenticos-shell`, sessionId: '00000000-0000-4000-8000-000000000007', task: 'T07' },
      { paneId: 'w1:p1', status: 'idle', title: 'Claude Code', cwd: '/home/user/code/jarvis', sessionId: '00000000-0000-4000-8000-000000000004', task: null },
    ],
    sessions: [{ id: 'sess-jarvis-web', state: 'running', title: 'Front-end do Jarvis (T07–T09)', cwd: `${WT}/jarvis-jarvis-agenticos`, live: true, pendingPermissions: 1, task: null }],
    cli: [
      { sessionId: '00000000-0000-4000-8000-000000000007', cwd: `${WT}/jarvis-T07-jarvis-agenticos-shell`, lastTs: now - 12000, title: 'T07 shell mobile-first + dashboard', task: 'T07' },
      { sessionId: '00000000-0000-4000-8000-000000000004', cwd: '/home/user/code/jarvis', lastTs: now - 3600000, title: 'interface mobile first com dashboard', task: null },
    ],
    tasks: [
      { id: 'TP', status: 'todo', branch: 'TP-jarvis-agenticos-proto', worktree: `${WT}/jarvis-TP-jarvis-agenticos-proto`, worktreeExists: false, branchExists: true, merged: true, lastCommitTs: now - 3 * DAY, agents: 0, sessions: 0 },
      { id: 'TB', status: 'todo', branch: 'TB-jarvis-agenticos-contrato', worktree: `${WT}/pessoal-TB-jarvis-agenticos-contrato`, worktreeExists: false, branchExists: false, merged: false, lastCommitTs: null, agents: 0, sessions: 0 },
      { id: 'T01', status: 'done', branch: 'T01-jarvis-agenticos-sessoes', worktree: `${WT}/jarvis-T01-jarvis-agenticos-sessoes`, worktreeExists: false, branchExists: false, merged: true, lastCommitTs: now - 2 * DAY, agents: 0, sessions: 0 },
      { id: 'T07', status: 'in-progress', branch: 'T07-jarvis-agenticos-shell', worktree: `${WT}/jarvis-T07-jarvis-agenticos-shell`, worktreeExists: true, branchExists: true, merged: false, lastCommitTs: now - 25 * 60000, agents: 1, sessions: 0 },
      { id: 'T08', status: 'todo', branch: 'T08-jarvis-agenticos-chat', worktree: `${WT}/jarvis-T08-jarvis-agenticos-chat`, worktreeExists: false, branchExists: false, merged: false, lastCommitTs: null, agents: 0, sessions: 0 },
      { id: 'T09', status: 'todo', branch: 'T09-jarvis-agenticos-planos', worktree: `${WT}/jarvis-T09-jarvis-agenticos-planos`, worktreeExists: false, branchExists: false, merged: false, lastCommitTs: null, agents: 0, sessions: 0 },
    ],
    lastExecution: { day: ymd(now), ts: now - 300000 },
  },
  'team/pdfs-para-markdown': {
    state: 'waiting-human', since: now - 40 * 60000, reason: 'T03 em review', herdr: true,
    waiting: ['T03 em review'],
    agents: [{ paneId: 'w2N:p1', status: 'idle', title: 'T03 extrair markdown dos PDFs', cwd: `${WT}/app-b-T03-extract-markdown`, sessionId: '00000000-0000-4000-8000-000000000002', task: 'T03' }],
    sessions: [{ id: 'sess-pdfs', state: 'queued', title: 'Extrair PDFs para markdown', cwd: `${WT}/app-b-T03-extract-markdown`, live: true, pendingPermissions: 0, task: 'T03' }],
    cli: [{ sessionId: '00000000-0000-4000-8000-000000000002', cwd: `${WT}/app-b-T03-extract-markdown`, lastTs: now - 40 * 60000, title: 'Extrair PDFs para markdown', task: 'T03' }],
    tasks: [
      { id: 'T01', status: 'done', branch: 'T01-pdfs-spike', worktree: `${WT}/app-b-T01-pdfs-spike`, worktreeExists: false, branchExists: false, merged: true, lastCommitTs: now - 6 * DAY, agents: 0, sessions: 0 },
      { id: 'T02', status: 'done', branch: 'T02-pdfs-pipeline', worktree: `${WT}/app-b-T02-pdfs-pipeline`, worktreeExists: false, branchExists: false, merged: true, lastCommitTs: now - 3 * DAY, agents: 0, sessions: 0 },
      { id: 'T03', status: 'review', branch: 'T03-extract-markdown', worktree: `${WT}/app-b-T03-extract-markdown`, worktreeExists: true, branchExists: true, merged: false, lastCommitTs: now - 45 * 60000, agents: 1, sessions: 1 },
      { id: 'T04', status: 'todo', branch: 'T04-pdfs-index', worktree: `${WT}/app-b-T04-pdfs-index`, worktreeExists: false, branchExists: false, merged: false, lastCommitTs: null, agents: 0, sessions: 0 },
    ],
    lastExecution: { day: ymd(now - DAY), ts: now - DAY },
  },
  'team/billing-metadata': {
    state: 'stale', since: now - 2 * DAY, reason: 'parado há 2 d — última atividade no CLI', herdr: false,
    waiting: [], agents: [], sessions: [],
    cli: [{ sessionId: '00000000-0000-4000-8000-000000000003', cwd: '/home/user/code/app-c/apps/brand-a', lastTs: now - 2 * DAY, title: 'Tokens do brand-a', task: null }],
    tasks: [
      { id: 'T05', status: 'done', branch: 'T05-mig-billing-metadata', worktree: `${WT}/app-c-T05-mig-billing-metadata`, worktreeExists: true, branchExists: true, merged: true, lastCommitTs: now - 2 * DAY, agents: 0, sessions: 0 },
      { id: 'T06', status: 'todo', branch: 'T06-billing-ui', worktree: `${WT}/app-c-T06-billing-ui`, worktreeExists: false, branchExists: false, merged: false, lastCommitTs: null, agents: 0, sessions: 0 },
    ],
    lastExecution: null,
  },
}

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
  plans: PLANS.map((p) => ({ slug: p.slug, vault: p.vault, title: p.title, status: p.status, progress: p.progress, ready: p.ready, gates: p.gates, openGates: p.openGates, frozen: p.frozen.length, prototypeUrl: p.prototypeUrl, projects: p.projects, activity: p.activity })),
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

const CONTRACT = `---
id: pessoal-contract-jarvis
type: contract
title: "Contrato — jarvis"
status: active
plan: jarvis-agenticos
projects: [jarvis]
visibility: private
created: ${ymd(now - 3 * DAY)}
updated: ${ymd(now)}
---

# Contrato — jarvis

> Escrito ANTES do código. Depois de \`kb dev freeze\`, cenário quebrando = código errado.
> Não é executado — contrato para humano e agente.

## Funcionalidade: Sessões persistentes e multi-device

\`\`\`gherkin
# language: pt
Funcionalidade: Sessões persistentes e multi-device
  O estado de uma sessão vive no servidor (events.jsonl + meta.json), nunca no browser.

  Cenário: Recarregar a página não perde a sessão
    Dado uma sessão viva com 3 turnos concluídos
    Quando o usuário recarrega a página e abre a mesma sessão
    Então o histórico completo (mensagens, tool calls, resultados) reaparece na mesma ordem
    E o estado mostrado é o estado atual do servidor

  Cenário: A mesma sessão aberta em dois devices
    Dado a sessão aberta no notebook e no celular
    Quando o agente emite um evento (texto, tool call, permissão)
    Então os dois devices recebem o evento
    E uma permissão decidida no celular some do notebook com a decisão registrada

  @revive
  Cenário: Sessão fechada revive ao receber mensagem
    Dado uma sessão gravada em disco cujo processo não existe mais
    Quando o usuário envia a mensagem "continua"
    Então o servidor cria o processo de novo com \`resume\` no id do CLI
    Mas a sequência de eventos continua do último seq gravado, sem duplicar histórico
\`\`\`

## Funcionalidade: Dashboard do Jarvis

\`\`\`gherkin
# language: pt
Funcionalidade: Dashboard do Jarvis

  Contexto:
    Dado que o usuário está logado no CLI

  Cenário: janelas da subscription
    Dado que a conta tem subscription ativa
    Quando eu abro a home
    Então vejo o percentual e o horário de reset de cada janela

  Cenário: sem janelas (API key)
    Dado que a conta usa API key
    Então vejo "janelas indisponíveis (API key)"

  Esquema do Cenário: severidade da janela
    Dado uma janela em <percentual>%
    Então a barra fica <cor>

    Exemplos:
      | percentual | cor      |
      | 40         | normal   |
      | 75         | amarela  |
      | 92         | vermelha |
\`\`\`

## Funcionalidade: Console do devflow

\`\`\`gherkin
# language: pt
Funcionalidade: Console do devflow

  Cenário: aprovar o gate TB congela o contrato
    Dado um plano com a task TB em todo
    Quando o usuário clica em "aprovar contrato (TB) + congelar"
    Então TB fica done
    E \`kb dev freeze\` roda e o contrato aparece como 🧊 congelado
\`\`\`
`

const PLAN_DETAIL = {
  ...PLANS[0],
  prototypeUp: true,
  files: {
    plan: { name: '_plan.md', path: '/home/user/code/vault-pessoal/30-plans/jarvis-agenticos/_plan.md', markdown: PLAN_MD, fm: { status: 'ready-for-review', projects: ['jarvis'], created: ymd(now) } },
    tasks: TASKS.map((t) => ({
      name: `tasks/${t.id}.md`,
      path: `/home/user/code/vault-pessoal/30-plans/jarvis-agenticos/tasks/${t.id}.md`,
      markdown: `---\nid: ${t.id}\nplan: jarvis-agenticos\ntitle: "${t.title}"\nstatus: ${t.status}\n---\n\n${TASK_BODY[t.id] || `## ${t.id} — ${t.title}\n`}`,
      fm: { id: t.id, plan: 'jarvis-agenticos', title: t.title, status: t.status, repo: t.repo, branch: t.branch, depends_on: t.dependsOn, scope: t.scope, gates: t.gates },
    })),
    execution: [
      {
        name: `execution/${ymd(now)}.md`,
        markdown: `# Execução — ${ymd(now)}\n\n## Onda 1 — T01 (pane w1:p2)\n- Sessões persistentes: \`events.jsonl\` + replay por \`seq\`. Smoke pelo agente:\n\n\`\`\`bash\nhttps GET :4747/api/sessions/abc/events since==0\n\`\`\`\n\n- Merge serial na main; \`wtree --rm\`.\n\n## Onda 2 — T07 (pane w1:p3)\n- Em andamento: shell + Home. Protótipo no ar em \`?mock=1\`.\n`,
      },
      { name: `execution/${ymd(now - DAY)}.md`, markdown: `# Execução — ${ymd(now - DAY)}\n\n## Gates\n- ⛔ TP aprovado pelo usuário (layout em 400 px e 1280 px).\n- ⛔🧊 TB aprovado e congelado (\`kb dev freeze\`, 9 cenários).\n` },
    ],
  },
  contracts: [{ file: 'jarvis/behaviors/jarvis.feature.md', path: '/home/user/code/vault-pessoal/10-projects/jarvis/behaviors/jarvis.feature.md', exists: true, legacy: false, content: CONTRACT, frozen: false, frozenAt: null, drifted: false }],
}

const PDFS_PLAN_MD = `## Objetivo

Converter os 71 PDFs do acervo em markdown navegável, com índice por tema.

## Pipeline

\`\`\`mermaid
flowchart TD
  A[PDFs] --> B{tem texto?}
  B -- sim --> C[pdftotext]
  B -- não --> D[OCR tesseract]
  C --> E[markdown + frontmatter]
  D --> E
  E --> F[(vault/40-sources)]
\`\`\`

## Diagrama com erro de sintaxe (para ver a degradação)

\`\`\`mermaid
graph LR
  A --> B
  B -->> C
  C --> [D
\`\`\`

## Comando

\`\`\`bash
kb source add ./pdfs/*.pdf --vault team --tag acervo
\`\`\`

## Saída sem linguagem e com linguagem desconhecida

\`\`\`
71 arquivos · 12 sem texto (OCR)
\`\`\`

\`\`\`brainfuck
++++[>++++<-]>.
\`\`\`

## HTML literal (não pode chegar ao DOM)

<svg id="svg-literal" width="10" height="10"><circle r="5"/></svg>
<script>window.__xss = 1</script>
`

// 2 "Cenário" + 1 "Esquema do Cenário" = 3; "Cenários:" é sinônimo de Exemplos e não conta.
const PDFS_CONTRACT = `---
id: team-contract-pdfs
type: contract
---

# Contrato — pdfs

## Funcionalidade: Extração

\`\`\`gherkin
# language: pt
@acervo
Funcionalidade: Extração

  Cenário: PDF com texto
    Dado um PDF "manual.pdf" com camada de texto
    Então o markdown sai do pdftotext

  Cenário: PDF escaneado
    Dado um PDF sem texto
    Então o OCR roda

  Esquema do Cenário: frontmatter por tipo
    Dado um PDF do tipo <tipo>
    Então o frontmatter tem type <type>

    Cenários:
      | tipo    | type   |
      | manual  | source |
      | artigo  | paper  |
\`\`\`
`

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
  if (state.frozen['jarvis/behaviors/jarvis.feature.md']) {
    d.contracts[0].frozen = true
    d.contracts[0].frozenAt = iso(Date.now())
    d.frozen = [{ file: 'jarvis/behaviors/jarvis.feature.md', frozenAt: d.contracts[0].frozenAt }]
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
  if (route === '/api/plans') return clone(q.get('archived') === '1' ? [...PLANS, ...ARCHIVED] : PLANS)
  if (route === '/api/plans/pessoal/jarvis-agenticos') return planDetail()
  const pm = route.match(/^\/api\/plans\/([^/]+)\/([^/]+)(\/.*)?$/)
  if (pm) {
    const [, vault, slug, rest] = pm
    const key = `${vault}/${slug}`
    if (rest === '/activity') {
      const a = ACTIVITY[key]
      if (a) {
        const d = clone(a)
        // o gate aprovado no mock some da lista de pendências
        d.waiting = d.waiting.filter((w) => !(w.includes('do TP') && state.gates.TP) && !(w.includes('do TB') && state.gates.TB))
        return d
      }
      const p = [...PLANS, ...ARCHIVED].find((x) => x.vault === vault && x.slug === slug)
      if (!p) throw Object.assign(new Error('plano não encontrado'), { status: 404 })
      return { ...clone(p.activity || { state: 'quiet', since: p.lastExecution?.ts || null, reason: 'sem sinais' }), herdr: true, waiting: [], agents: [], sessions: [], cli: [], tasks: [], lastExecution: p.lastExecution }
    }
    if (!rest) {
      const p = [...PLANS, ...ARCHIVED].find((x) => x.vault === vault && x.slug === slug)
      if (!p) throw Object.assign(new Error('plano não encontrado'), { status: 404 })
      const markdown = slug === 'pdfs-para-markdown' ? PDFS_PLAN_MD : `## ${p.title}\n\nPlano de exemplo do mock.\n`
      const contracts =
        slug === 'pdfs-para-markdown'
          ? [
              { file: 'behaviors.feature', path: '/home/user/code/vault-team/10-projects/app-b/behaviors/pdfs.feature.md', exists: true, legacy: false, content: PDFS_CONTRACT, frozen: true, frozenAt: iso(now - 2 * DAY), drifted: true },
              { file: 'app-b/behaviors/indice.feature.md', path: '/home/user/code/vault-team/10-projects/app-b/behaviors/indice.feature.md', exists: false, legacy: false, content: null, frozen: false, frozenAt: null, drifted: false, warning: 'contrato declarado mas o arquivo não existe' },
            ]
          : []
      return { ...clone(p), prototypeUp: p.prototypeUrl ? false : null, files: { plan: { name: '_plan.md', path: p.path + '/_plan.md', markdown, fm: {} }, tasks: [], execution: [] }, contracts }
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
      if (cmd === 'freeze') state.frozen['jarvis/behaviors/jarvis.feature.md'] = true
      if (cmd === 'unfreeze') delete state.frozen['jarvis/behaviors/jarvis.feature.md']
      return { ok: true, code: 0, output: `$ kb dev ${cmd} ${slug}\n[mock] ${cmd} executado com sucesso\ncontratos: jarvis/behaviors/jarvis.feature.md\n` }
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
  [800, 'sdk', { msg: { type: 'assistant', message: { content: [{ type: 'text', text: 'Agora crio `web/views/home.js` com os widgets na ordem de importância:\n\n```js\nexport async function render(root) {\n  root.innerHTML = cards.join(\'\')\n}\n```' }] } } }],
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
