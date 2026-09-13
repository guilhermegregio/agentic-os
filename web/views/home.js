// views/home.js — dashboard. Widgets em ordem de importância; nenhum card
// quebra por campo ausente (tudo que falta vira "—").
import { api, esc, fmtUsd, shortPath, resetIn, pct, toast, guard, setCrumb, refreshLive } from '../app.js'
import { sparkline, hbars, meter } from '../charts.js'
import { activityPill, stateOrder } from './plan-activity.js'

const card = (title, n, body, cls = '') =>
  `<section class="card ${cls}"><h2>${esc(title)}${n !== undefined && n !== null ? `<span class="n">${esc(n)}</span>` : ''}</h2>${body}</section>`
const empty = (msg = '—') => `<div class="empty">${esc(msg)}</div>`

// 1) Janelas da subscription ------------------------------------------------
function wRateLimits(ov) {
  const rl = ov.rateLimits || {}
  if (!rl.available) {
    const why = ov.account?.apiKeySource ? `API key (${ov.account.apiKeySource})` : 'API key'
    return card('Janelas da subscription', null, empty(`janelas indisponíveis (${why})`))
  }
  const ws = rl.windows || []
  if (!ws.length) return card('Janelas da subscription', null, empty())
  const body = ws
    .map((w) => {
      // Number(null) é 0: sem esse degrau, "sem dado" viraria "0%".
      const raw = w.percent
      const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw)
      const known = Number.isFinite(n)
      const p = known ? n : 0
      const label = w.label || w.key || '—'
      const sev = w.severity === 'critical' ? 'var(--err)' : w.severity === 'warning' ? 'var(--warn)' : undefined
      return `<div class="mrow">
        <span class="t">${esc(label)}${w.active ? ' <span class="pill acc">ativa</span>' : ''}</span>
        <b>${known ? p + '%' : '—'}</b>
        ${known ? meter(p, { color: sev, title: `${label}: ${p}%` }) : '<span class="dim" style="grid-column:1/-1">sem percentual</span>'}
        <small class="dim" style="grid-column:1/-1">${esc(resetIn(w.resetsAt))}${w.scope ? ' · ' + esc(w.scope) : ''}</small>
      </div>`
    })
    .join('')
  return card('Janelas da subscription', ov.account?.subscription || null, body)
}

// 2) Custo hoje / semana / mês ----------------------------------------------
function wCost(ov, usage) {
  if (!usage) return card('Custo', null, empty('uso indisponível'))
  const w = usage.windows || {}
  const equiv = ov.account?.subscription ? '<small class="dim">equivalente API (subscription)</small>' : ''
  const tiles = [
    ['hoje', w.today?.costUsd ?? usage.today?.costUsd],
    ['semana', w.week?.costUsd],
    ['mês', w.month?.costUsd ?? usage.totals?.costUsd],
  ]
    .map(([l, v]) => `<div class="stat"><span class="v">${esc(fmtUsd(v))}</span><span class="l">${l}</span></div>`)
    .join('')
  const series = (usage.daily || []).map((d) => d.costUsd)
  const labels = (usage.daily || []).map((d) => d.day)
  const spark = series.length ? sparkline([{ label: '', values: series, labels }], { w: 320, h: 44, fmt: fmtUsd }) : empty()
  const l7 = usage.last7 || {}
  const delta =
    Number.isFinite(l7.costUsd) && Number.isFinite(l7.prev7) && l7.prev7 > 0
      ? `<small class="dim">7d: ${fmtUsd(l7.costUsd)} (${l7.costUsd >= l7.prev7 ? '+' : ''}${Math.round(((l7.costUsd - l7.prev7) / l7.prev7) * 100)}% vs. 7d anteriores)</small>`
      : ''
  return card('Custo', null, `<div class="stats">${tiles}</div>${equiv}${spark}${delta}`, 'span2')
}

// 3) Por modelo no mês ------------------------------------------------------
function wByModel(usage) {
  const rows = (usage?.windows?.month?.byModel || usage?.byModel || []).map((m) => ({ label: m.model, value: m.costUsd }))
  return card('Por modelo no mês', null, rows.length ? hbars(rows, { w: 300, fmt: fmtUsd }) : empty())
}

// 4) Sessões vivas ----------------------------------------------------------
function wLive(ov) {
  const live = ov.live || {}
  const max = ov.settings?.maxRunning ?? live.maxRunning ?? 0
  const sessions = (ov.sessions || []).filter((s) => s.live)
  const ctrl = `<div class="row">
    <div class="stat"><span class="v">${esc(dashNum(live.running))}<span class="dim" style="font-size:15px">/${esc(dashNum(max))}</span></span><span class="l">rodando · ${esc(dashNum(live.queued))} na fila</span></div>
    <span class="spacer" style="flex:1"></span>
    <button class="btn sm" data-max="-1" aria-label="menos agentes simultâneos">−</button>
    <button class="btn sm" data-max="1" aria-label="mais agentes simultâneos">+</button>
  </div>`
  const list = sessions.length
    ? `<ul class="list">${sessions
        .map((s) => {
          const p = pct(s.usage?.contextTokens, s.usage?.contextWindow)
          return `<li class="link" data-go="#/s/${esc(s.id)}">
            <span class="dot ${esc(s.state)}"></span>
            <span class="t">${esc(s.title || 'sessão')}<small>${esc(shortPath(s.cwd))} · ${esc(fmtUsd(s.usage?.costUsd))}${s.pendingPermissions ? ' · <b style="color:var(--warn)">' + s.pendingPermissions + ' pendente(s)</b>' : ''}</small>
              ${meter(p, { title: `contexto ${p}%` })}</span>
            <span class="pill">${p}%</span>
          </li>`
        })
        .join('')}</ul>`
    : empty('nenhuma sessão viva')
  return card('Sessões vivas', sessions.length || null, ctrl + list)
}
const dashNum = (v) => (Number.isFinite(Number(v)) ? String(v) : '—')

// 5) Permissões pendentes ---------------------------------------------------
function wPerms(ov) {
  const rows = (ov.sessions || []).filter((s) => s.pendingPermissions > 0)
  const n = rows.reduce((a, s) => a + s.pendingPermissions, 0)
  const body = rows.length
    ? `<ul class="list">${rows
        .map(
          (s) =>
            `<li class="link" data-go="#/s/${esc(s.id)}"><span class="dot error"></span><span class="t">${esc(s.title || s.id)}<small>${esc(shortPath(s.cwd))}</small></span><span class="pill warn">${s.pendingPermissions}</span></li>`,
        )
        .join('')}</ul>`
    : empty('nada aguardando você')
  return card('Permissões pendentes', n || null, body)
}

// 5b) Planos em movimento — atividade inferida por plano (herdr, sessões, CLI, git)
function wMoving(ov) {
  const plans = (ov.plans || []).filter((p) => p.activity && p.activity.state !== 'done')
  plans.sort((a, b) => stateOrder(a.activity) - stateOrder(b.activity) || (b.activity.since || 0) - (a.activity.since || 0))
  const hot = plans.filter((p) => stateOrder(p.activity) <= 2).length
  const body = plans.length
    ? `<ul class="list">${plans
        .map((p) => {
          const quiet = stateOrder(p.activity) >= 3
          return `<li class="link" data-go="#/plans/${esc(p.vault)}/${esc(p.slug)}"${quiet ? ' style="opacity:.7"' : ''}>
            <span class="t">${esc(p.title || p.slug)}<small>${esc(p.activity.reason || '—')}</small></span>
            ${activityPill(p.activity)}</li>`
        })
        .join('')}</ul>`
    : empty('nenhum plano ativo')
  return card('Planos em movimento', hot || null, body)
}

// 6) Frota herdr ------------------------------------------------------------
function wFleet(ov) {
  const agents = ov.agents || []
  if (!agents.length) return card('Frota herdr', null, empty('herdr indisponível'))
  const byStatus = agents.reduce((a, x) => ((a[x.status || 'unknown'] = (a[x.status || 'unknown'] || 0) + 1), a), {})
  const pills = Object.entries(byStatus)
    .map(([k, v]) => `<span class="pill">${esc(k)}: ${v}</span>`)
    .join('')
  const list = `<ul class="list">${agents
    .map(
      (a) => `<li><span class="dot ${esc(a.status || 'unknown')}"></span>
      <span class="t">${esc(a.title || a.agent || 'agente')}<small>${esc(shortPath(a.cwd))} · ${esc(a.paneId || '—')}</small></span>
      ${a.paneId ? `<button class="btn sm" data-focus="${esc(a.paneId)}">focar</button>` : ''}</li>`,
    )
    .join('')}</ul>`
  return card('Frota herdr', agents.length, `<div class="row">${pills}</div>${list}`)
}

// 7) Planos com gate aberto -------------------------------------------------
function wGates(ov) {
  const plans = (ov.plans || []).filter((p) => (p.openGates || 0) > 0 || (p.ready || []).some((r) => r === 'TP' || r === 'TB'))
  const body = plans.length
    ? `<ul class="list">${plans
        .map((p) => {
          const gates = (p.gates || [])
            .map((g) => `<span class="pill ${g.status === 'done' ? 'ok' : 'warn'}">${esc(g.id)}</span>`)
            .join(' ')
          return `<li class="link" data-go="#/plans/${esc(p.vault)}/${esc(p.slug)}"><span class="t">${esc(p.title || p.slug)}<small>${esc(p.vault)} · ${esc(p.status || '—')} · ${esc(p.progress?.done ?? '—')}/${esc(p.progress?.total ?? '—')}</small></span>${gates}</li>`
        })
        .join('')}</ul>`
    : empty('nenhum gate aberto')
  return card('Gates aguardando', plans.length || null, body)
}

// 8) Repos com trabalho não salvo -------------------------------------------
function wRisk(ov) {
  const rows = ov.repoRisk || []
  const body = rows.length
    ? `<ul class="list">${rows
        .map(
          (r) =>
            `<li><span class="t">${esc(r.name)}<small>${esc(r.branch || '—')} · ${esc(shortPath(r.path))}</small></span>${
              r.dirty ? `<span class="pill warn">${r.dirty} sujo</span>` : ''
            }${r.ahead ? `<span class="pill acc">↑${r.ahead}</span>` : ''}</li>`,
        )
        .join('')}</ul>`
    : empty('tudo commitado')
  return card('Trabalho não salvo', rows.length || null, body)
}

// 9) Protótipos -------------------------------------------------------------
function wPrototypes(ov) {
  const fromPlans = (ov.plans || [])
    .filter((p) => p.prototypeUrl)
    .map((p) => ({ app: p.slug, url: p.prototypeUrl, up: null }))
  const seen = new Set()
  const rows = [...(ov.prototypes || []), ...fromPlans].filter((r) => {
    const key = r.url || r.app
    return !key || seen.has(key) ? false : seen.add(key)
  })
  const body = rows.length
    ? `<ul class="list">${rows
        .map(
          (r) =>
            `<li><span class="t">${esc(r.app)}<small>${esc(r.url || (r.port ? 'porta ' + r.port : '—'))}</small></span>
             <span class="pill ${r.up === true ? 'ok' : r.up === false ? 'err' : ''}">${r.up === true ? 'no ar' : r.up === false ? 'fora' : '—'}</span>
             ${r.url ? `<a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">abrir</a>` : '<span class="pill">sem url</span>'}</li>`,
        )
        .join('')}</ul>`
    : empty()
  return card('Protótipos', rows.length || null, body)
}

// 10) MCP -------------------------------------------------------------------
function wMcp(ov) {
  const rows = ov.mcp || []
  const cls = (s) => (s === 'connected' ? 'ok' : s === 'needs-auth' || s === 'failed' ? 'err' : 'warn')
  const body = rows.length
    ? `<ul class="list">${rows
        .map(
          (m) =>
            `<li><span class="t">${esc(m.name)}${m.error ? `<small>${esc(m.error)}</small>` : ''}</span><span class="pill ${cls(m.status)}">${esc(m.status || '—')}</span></li>`,
        )
        .join('')}</ul>`
    : empty()
  return card('MCP', rows.length || null, body)
}

// 11) Worktrees órfãos ------------------------------------------------------
function wOrphans(ov) {
  const rows = ov.orphanWorktrees || []
  const body = rows.length
    ? `<ul class="list">${rows.map((p) => `<li><span class="t">${esc(p.split('/').pop())}<small>${esc(p)}</small></span></li>`).join('')}</ul>`
    : empty('nenhum')
  return card('Worktrees órfãos', rows.length || null, body)
}

// O índice de custos varre ~/.claude/projects no servidor: vale um cache curto.
let usageCache = { at: 0, data: null }
async function usageCached() {
  if (usageCache.data && Date.now() - usageCache.at < 300000) return usageCache.data
  const data = await api('/api/usage?days=30').catch(() => usageCache.data)
  usageCache = { at: Date.now(), data }
  return data
}

export async function render(root, _params, ctx) {
  setCrumb('')
  let timer = null

  const draw = async () => {
    const [ov, usage] = await Promise.all([api('/api/overview'), usageCached()])
    if (!ctx.isCurrent()) return ov
    root.innerHTML = `<div class="cards">
      ${wRateLimits(ov)}
      ${wCost(ov, usage)}
      ${wByModel(usage)}
      ${wLive(ov)}
      ${wPerms(ov)}
      ${wMoving(ov)}
      ${wFleet(ov)}
      ${wGates(ov)}
      ${wRisk(ov)}
      ${wPrototypes(ov)}
      ${wMcp(ov)}
      ${wOrphans(ov)}
    </div>`
    return ov
  }

  let ov = await draw()
  if (ctx.isCurrent()) {
    timer = setInterval(() => {
      draw().then((v) => (ov = v || ov)).catch(() => {})
    }, 30000)
    ctx.onLeave(() => clearInterval(timer))
  }

  root.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]')
    if (go) {
      location.hash = go.dataset.go
      return
    }
    const focus = e.target.closest('[data-focus]')
    if (focus) {
      await guard(() => api(`/api/agents/${encodeURIComponent(focus.dataset.focus)}/focus`, { method: 'POST' }), 'pane focado')
      return
    }
    const step = e.target.closest('[data-max]')
    if (step) {
      const cur = ov?.settings?.maxRunning ?? 1
      const next = Math.max(1, Math.min(16, cur + Number(step.dataset.max)))
      if (next === cur) return
      const s = await guard(() => api('/api/settings', { method: 'PATCH', body: { maxRunning: next } }))
      if (s) {
        toast(`limite: ${s.maxRunning} agentes`, 'ok')
        void refreshLive()
        ov = await draw()
      }
    }
  })
}
