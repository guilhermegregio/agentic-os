# agentic-os — agenticOS sobre o Claude Agent SDK

Servidor Node que embrulha `@anthropic-ai/claude-agent-sdk` e expõe uma UI web
mobile-first. O SDK roda o mesmo engine do Claude Code CLI (binário resolvido via
`which claude`, ou `JARVIS_CLAUDE_BIN`), então o harness inteiro vale: `CLAUDE.md`,
skills, hooks, settings, MCPs do `cwd` escolhido, e o login claude.ai já feito no CLI.

Desenvolvido com o ciclo `kb dev` (plano em `30-plans/jarvis-agenticos/` no vault do `kb`).
Contratos de comportamento: `<vault>/10-projects/agentic-os/behaviors/*.feature.md` no vault
do `kb` (congelam com `kb dev freeze`).

## Rodar

```bash
pnpm install
cp .env.example .env   # opcional: ajuste o que precisar
pnpm dev               # http://localhost:4747, recarrega ao salvar
pnpm start             # idem, sem watch
pnpm start:mock        # protótipo em http://localhost:4748 com dados fictícios (dev:mock com watch)
```

Configuração é por variáveis de ambiente, todas documentadas em `.env.example`.
`.env` (ignorado pelo git) é carregado sozinho pelo loader nativo do Node; o que já
está no shell vence o arquivo. `JARVIS_ENV_FILE` aponta outro arquivo — é assim que
`start:mock` usa o `.env.mock` versionado.

**Modo mock** (`JARVIS_MOCK=1`): o servidor só serve os estáticos, marca a página com
`<meta name="jarvis-mock">` e responde 503 em `/api/*`; o front atende tudo com
`web/mock.js`. Nada da máquina é lido — é o protótipo/gate de layout do devflow e
funciona num clone limpo sem `kb`, `herdr` ou login do CLI. Com o servidor real,
`/?mock=1` liga o mesmo modo só na aba e `/?mock=0` desliga.

## Dependências do harness

O agentic-os **não é genérico**: ele é o shell de um harness pessoal e lê o estado dele
direto do disco. Sem essas peças, a aba de projetos, o console do devflow e a frota
de agentes ficam vazios (o chat, as sessões e o painel de custos funcionam sozinhos).

- **`kb` CLI** (obrigatório para projetos/planos) — engine em
  [gregio-marketplace](https://github.com/guilhermegregio/gregio-marketplace) (`cli/kb`).
  O agentic-os lê `~/.config/kb/config.json` (projetos, grupos, vaults) e
  `<vault>/30-plans/<slug>/` (planos, tasks), e faz shell-out em `kb dev`
  para `check`/`freeze`/`unfreeze`.
- **Contratos** vêm da casa do projeto no vault: `<vault>/10-projects/<projeto>/behaviors/`.
  Uma entrada relativa de `contracts:` (ex.: `agentic-os/behaviors/x.feature.md`) resolve
  primeiro em `<vault do plano>/10-projects/`; se não existir lá, cai no repo do projeto
  e no worktree do plano e vem marcada `legacy: true`. Entrada absoluta ou com `~` é
  usada como está. Freeze/drift batem com `~/.local/state/kb/frozen-contracts.json`
  pelo path resolvido.
- **`herdr`** (recomendado) — multiplexador de terminais/agentes. Quando `HERDR_ENV=1`,
  o dashboard lista a frota (`herdr agent list`) e o handoff web → CLI abre um pane
  já rodando `claude --resume`. Fora dele, o handoff só devolve o comando e a atividade
  dos planos vem só das sessões do Jarvis, dos transcripts do CLI e do git (`herdr: false`,
  `agents: []`).
- **`wtree`** (opcional) — script de worktrees em
  [gregioos](https://github.com/guilhermegregio/gregioos/blob/main/modules/scripts/wtree.nix).
  O Jarvis reproduz o mesmo layout (`~/code/worktrees/<repo>-<branch>`, `.env*` copiados,
  `pnpm install`) em git puro; usar o `wtree` mantém os dois lados consistentes e ainda
  abre o workspace no herdr.


## Estrutura

- `src/agent.ts` — `AgentSession` (um `query()` em streaming-input por sessão, buffer
  de eventos com `seq`, permissões pendentes, modo/modelo ao vivo) e `SessionManager`
  (vivas ∪ gravadas, `revive` com `resume`, semáforo `maxRunning`).
- `src/store.ts` — persistência em arquivos: `sessions/<id>/meta.json` + `events.jsonl`.
- `src/probe.ts` — sonda da conta sem gastar tokens: janelas da subscription (5h/7d/por
  modelo), modelos disponíveis, status dos MCPs.
- `src/usage.ts` + `src/pricing.ts` — custo estimado (preço de API) a partir dos
  transcripts do CLI em `~/.claude/projects`, índice incremental; hoje/semana/mês por modelo.
- `src/harness.ts` + `src/planops.ts` — leitura do harness `kb` (projetos, vaults,
  planos, tasks, contratos congelados) e as operações do console do devflow.
- `src/projects.ts` — bootstrap de projeto novo: `~/code/<nome>` (`JARVIS_CODE_DIR`) com
  `git init -b main`, README/CLAUDE.md com a descrição, `kb project add` + casa no vault +
  `kb:link`, tudo num commit inicial; falha do `kb` vira log e `registered: false`.
- `src/worktrees.ts` — worktrees no layout do `wtree` (`~/code/worktrees/<repo>-<branch>`).
- `src/herdr.ts` — frota de agentes do herdr e abertura de pane para o handoff.
- `src/activity.ts` — atividade **inferida** por plano, nada persistido: cruza pelo cwd
  agentes do herdr, sessões do Jarvis, transcripts do CLI, worktrees e git (commits
  `Txx(<slug>)` na main = task mergeada). Seis estados com precedência fixa —
  `working` › `waiting-human` › `idle` › `done` › `quiet` › `stale` (sem sinal há mais de
  `JARVIS_ACTIVITY_STALE_HOURS`). Uma passada para todos os planos, cache de 5 s; fonte
  que falha vira lista vazia sem derrubar a rota.
- `src/server.ts` — Hono: REST + SSE.
- `web/` — UI vanilla (ES modules, sem build). `md-enhance.js` enriquece tudo que passa
  por `md()`: highlight por linguagem (gherkin pt/en incluso), barra com copiar e
  diagramas mermaid. Detalhe do plano em `views/plans.js` com as abas em
  `views/plan-tasks.js` (tabela, task aberta, DAG), `views/plan-contracts.js` (uma seção
  por Funcionalidade) e `views/plan-activity.js` (atividade com refresh a cada 10 s).

**Libs do cdnjs:** `marked` e `highlight.js` entram por `<script>` em `web/index.html`;
`mermaid` é baixado sob demanda por `md-enhance.js`, só quando a página tem um bloco
`mermaid`. Versões fixadas na URL — continua sem bundler nem `node_modules` no front.

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/overview` | conta, janelas da subscription, modelos, MCP, vivas, agentes, planos (com `activity` resumido), riscos |
| GET | `/api/usage?days=` | custo diário, por modelo/projeto, janelas hoje/semana/mês |
| GET | `/api/usage/sessions` | sessões dos transcripts do CLI com custo |
| GET/PATCH | `/api/settings` | `maxRunning`, modo/modelo/cwd padrão |
| GET | `/api/projects` | projetos registrados no `kb` (git, CLAUDE.md, grafo) |
| GET | `/api/projects/meta` | `codeDir`, grupos e vaults do `kb` para o diálogo "novo projeto" |
| POST | `/api/projects` | `{name, description?, group?, vault?}` → cria o projeto; `{name, path, vaultHome?, registered, log}` |
| GET/POST/DELETE | `/api/projects/worktrees` | listar / criar / remover worktrees |
| GET | `/api/agents` | agentes do herdr; `POST /api/agents/:pane/focus` |
| GET | `/api/plans?archived=1` · `/api/plans/:vault/:slug` | planos do devflow, markdown, tasks, contratos; a lista traz `activity` `{state, since, reason}` por plano |
| GET | `/api/plans/:vault/:slug/activity` | atividade inferida: `state`, `reason`, `since`, `waiting`, `agents`, `sessions`, `cli`, `tasks` (worktree/branch/merged); 404 se o plano não existe |
| POST | `/api/plans/:vault/:slug/status` | `{status, by}` (aprovar plano) |
| POST | `/api/plans/:vault/:slug/gate/:task` | aprova gate humano (TP/TB) |
| POST | `/api/plans/:vault/:slug/kb/:cmd` | `check` · `freeze` · `unfreeze {reason}` · `frozen` via `kb dev` |
| GET | `/api/sessions` | vivas ∪ gravadas |
| GET | `/api/sessions/stored?cwd=` | sessões do CLI (`~/.claude/projects`) para importar |
| POST | `/api/sessions` | `{cwd?, permissionMode?, model?, resume?, fork?, prompt?}` |
| POST | `/api/sessions/:id/messages` | `{text}` — sessão gravada revive sozinha |
| POST | `/api/sessions/:id/interrupt` · `/mode` · `/model` | controle da sessão viva |
| POST | `/api/sessions/:id/permissions/:pid` | `{behavior, always?}` |
| POST | `/api/sessions/:id/handoff` | `{openPane?}` → `claude --resume <id>` (web → CLI) |
| GET | `/api/sessions/:id/events?since=` | SSE: replay do disco + vivo |
| DELETE | `/api/sessions/:id?archive=1\|purge=1` | fecha / arquiva / apaga |

## Handoff com o Claude Code CLI

- **web → CLI:** "abrir no CLI" fecha o processo do Jarvis (duas instâncias na mesma
  sessão brigariam pelo transcript) e devolve `claude --resume <id>`; dentro do herdr,
  abre um pane já rodando no cwd da sessão.
- **CLI → web:** aba "sessões do CLI" lista `~/.claude/projects`; importar cria uma
  sessão Jarvis com `resume` e traz o histórico via `getSessionMessages`.

## Limitações conhecidas

- Por padrão escuta só em `127.0.0.1`. Para expor na rede (`JARVIS_HOST=0.0.0.0` ou IP
  do Tailscale) o `JARVIS_TOKEN` é obrigatório e o servidor recusa subir sem ele. A API
  controla a máquina inteira (sessões em qualquer cwd, worktrees, `kb dev`, panes do herdr),
  então mesmo com token prefira uma rede privada como o Tailscale.
- Custo dos transcripts é estimado a preço de API (`pricing.ts`), mesmo em subscription.
- `usage_EXPERIMENTAL…` do SDK é instável: se mudar, o widget de janelas some, o resto fica.
