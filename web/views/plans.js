// views/plans.js — console do devflow: lista de planos e o detalhe com gates,
// plano, tasks (DAG + detalhe), contratos (gherkin), execução e a atividade
// inferida. Renderização rica via md-enhance (highlight, copiar, mermaid).
import { api, esc, md, shortPath, relTime, toast, guard, setCrumb } from '../app.js'
import { enhance, copy } from '../md-enhance.js'
import { contractsHtml, toggleFeats } from './plan-contracts.js'
import { tasksHtml, toggleTask, taskFromNode } from './plan-tasks.js'
import { activityHtml, activityPill } from './plan-activity.js'

/** O markdown do vault vem com frontmatter YAML — o `fm` já veio parseado à parte. */
const body = (t) => String(t ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '')

const STATUS_CLS = { done: 'ok', approved: 'acc', 'in-progress': 'warn', 'ready-for-review': 'warn' }
const statusPill = (s) => `<span class="pill ${STATUS_CLS[s] || ''}">${esc(s || '—')}</span>`
const gatePill = (g) => `<span class="pill ${g.status === 'done' ? 'ok' : 'warn'}" title="${esc(g.stage || '')}">${esc(g.id)}${g.status === 'done' ? ' ✓' : ' ⛔'}</span>`

// ==========================================================================
// Lista
// ==========================================================================
function planCard(p) {
  const prog = p.progress || {}
  const w = prog.total ? Math.round((prog.done / prog.total) * 100) : 0
  return `<section class="card link" data-go="#/plans/${esc(p.vault)}/${esc(p.slug)}" style="cursor:pointer">
    <h2>${esc(p.slug)}<span class="n">${esc(p.vault)}</span></h2>
    <div class="t">${esc(p.title || '—')}</div>
    <div class="row">${activityPill(p.activity)}${statusPill(p.status)}${(p.gates || []).map(gatePill).join('')}${
      (p.ready || []).length ? `<span class="pill acc">pronto: ${esc((p.ready || []).join(', '))}</span>` : ''
    }</div>
    <div class="mrow"><span class="t">progresso</span><b>${esc(prog.done ?? '—')}/${esc(prog.total ?? '—')}</b>
      <span class="meter"><i style="width:${w}%"></i></span></div>
    <small class="dim">${esc((p.projects || []).join(', ') || '—')}${p.lastExecution ? ` · última execução ${esc(relTime(p.lastExecution.ts))}` : ''}</small>
  </section>`
}

const ARCHIVED_KEY = 'jarvis:plans:archived'

async function list(root, ctx) {
  setCrumb('Planos')
  let archived = sessionStorage.getItem(ARCHIVED_KEY) === '1'

  const paint = async () => {
    const plans = await api(`/api/plans${archived ? '?archived=1' : ''}`)
    if (!ctx.isCurrent()) return
    root.innerHTML = `<div class="toolbar"><h1>Planos</h1><span class="dim">${plans.length} ${archived ? 'no total' : 'ativos'}</span>
        <button class="btn sm toggle" data-act="archived" aria-pressed="${archived}" title="incluir 30-plans/_archive">arquivados</button></div>
      ${plans.length ? `<div class="cards">${plans.map(planCard).join('')}</div>` : '<div class="empty">nenhum plano ativo</div>'}`
  }
  await paint()

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="archived"]')) {
      archived = !archived
      sessionStorage.setItem(ARCHIVED_KEY, archived ? '1' : '0')
      return void paint()
    }
    const go = e.target.closest('[data-go]')
    if (go) location.hash = go.dataset.go
  })
}

// ==========================================================================
// Detalhe
// ==========================================================================
function actionsHtml(p) {
  const tp = (p.gates || []).find((g) => g.id === 'TP')
  const tb = (p.gates || []).find((g) => g.id === 'TB')
  const b = []
  if (p.prototypeUrl)
    b.push(
      `<a class="btn sm" href="${esc(p.prototypeUrl)}" target="_blank" rel="noopener">abrir protótipo</a>
       <span class="pill ${p.prototypeUp === true ? 'ok' : p.prototypeUp === false ? 'err' : ''}">${
         p.prototypeUp === true ? 'no ar' : p.prototypeUp === false ? 'fora' : '—'
       }</span>`,
    )
  if (tp && tp.status !== 'done') b.push('<button class="btn sm primary" data-act="gate-tp">aprovar protótipo (TP)</button>')
  if (tb && tb.status !== 'done') b.push('<button class="btn sm primary" data-act="gate-tb">aprovar contrato (TB) + congelar</button>')
  if (p.status === 'ready-for-review') b.push('<button class="btn sm ok" data-act="approve">aprovar plano</button>')
  if (p.status !== 'in-progress') b.push('<button class="btn sm" data-act="in-progress">marcar in-progress</button>')
  if (p.status !== 'done') b.push('<button class="btn sm" data-act="done">marcar done</button>')
  return `<div class="toolbar">${b.join(' ')}</div>`
}

const TABS = [
  ['plan', 'Plano'],
  ['tasks', 'Tasks'],
  ['contracts', 'Contratos'],
  ['exec', 'Execução'],
  ['activity', 'Atividade'],
]

async function detail(root, vault, slug, query, ctx) {
  setCrumb(`${vault}/${slug}`)
  const base = `/api/plans/${encodeURIComponent(vault)}/${encodeURIComponent(slug)}`
  const q = new URLSearchParams(query || '')
  const taskKey = `jarvis:plantask:${vault}/${slug}`
  let tab = q.get('tab') || sessionStorage.getItem('jarvis:plantab') || 'plan'
  let openTask = q.get('task') || sessionStorage.getItem(taskKey) || null
  if (q.get('task')) tab = 'tasks'
  if (!TABS.some(([k]) => k === tab)) tab = 'plan'
  let p = null
  let act = null

  const fetchAct = () => api(`${base}/activity`).catch(() => null)

  const panelHtml = () => {
    const files = p.files || {}
    if (tab === 'tasks') return tasksHtml(p, { open: openTask, act })
    if (tab === 'contracts') return contractsHtml(p)
    if (tab === 'activity') return activityHtml(act, p)
    if (tab === 'exec')
      return (files.execution || []).length
        ? (files.execution || [])
            .map((f) => `<section class="card"><h2>${esc(f.name)}</h2><div class="md">${md(body(f.markdown))}</div></section>`)
            .join('')
        : '<div class="empty">nenhum log de execução</div>'
    return files.plan?.markdown ? `<div class="md">${md(body(files.plan.markdown))}</div>` : '<div class="empty">sem _plan.md</div>'
  }

  const panel = () => root.querySelector('[data-el="panel"]')
  const paintPanel = () => {
    const el = panel()
    if (!el) return
    el.innerHTML = panelHtml()
    void enhance(el).then(() => el.querySelector('.tasks-dag .mermaid-out')?.classList.add('dag'))
  }

  const paint = async () => {
    ;[p, act] = await Promise.all([api(base), fetchAct()])
    if (!ctx.isCurrent()) return
    setCrumb(p.title || `${vault}/${slug}`)
    root.innerHTML = `<div class="toolbar">
        <h1>${esc(p.title || slug)}</h1>
        <span data-el="actpill">${activityPill(act, { withReason: true })}</span>
        ${statusPill(p.status)}${(p.gates || []).map(gatePill).join('')}
      </div>
      <div class="row" style="margin-bottom:8px">
        <span class="pill">${esc(p.vault)}</span>
        <span class="pill">${esc(p.visibility || '—')}</span>
        <span class="pill">${esc(p.progress?.done ?? '—')}/${esc(p.progress?.total ?? '—')}</span>
        ${(p.projects || []).map((x) => `<span class="pill acc">${esc(x)}</span>`).join('')}
        ${p.worktree ? `<span class="pill" title="${esc(p.worktree)}">${esc(shortPath(p.worktree))}</span>` : ''}
      </div>
      ${actionsHtml(p)}
      <div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}"${k === tab ? ' class="active"' : ''}>${l}</button>`).join('')}</div>
      <div data-el="panel"></div>`
    paintPanel()
  }

  await paint()

  // Atividade é inferida no servidor e muda sozinha: repinta a pill do topo a
  // cada 10 s com a página visível, e o painel se a aba Atividade estiver aberta.
  const timer = setInterval(async () => {
    if (document.hidden || !ctx.isCurrent()) return
    const a = await fetchAct()
    if (!ctx.isCurrent() || !a) return
    act = a
    const pill = root.querySelector('[data-el="actpill"]')
    if (pill) pill.innerHTML = activityPill(act, { withReason: true })
    if (tab === 'activity') paintPanel()
  }, 10000)
  ctx.onLeave(() => clearInterval(timer))

  const kbOut = (text) => {
    const el = root.querySelector('[data-el="kbout"]')
    if (!el) return toast(text.slice(0, 120))
    el.hidden = false
    el.textContent = text
  }

  const runKb = async (cmd, body = {}) => {
    const r = await guard(() => api(`${base}/kb/${cmd}`, { method: 'POST', body }))
    if (!r) return null
    toast(`kb dev ${cmd}: ${r.ok ? 'ok' : 'falhou (código ' + r.code + ')'}`, r.ok ? 'ok' : 'err')
    await paint()
    if (!ctx.isCurrent()) return r
    kbOut(r.output || '(sem saída)')
    return r
  }

  const openTaskRow = (id, force) => {
    const el = panel()
    if (!el) return
    openTask = toggleTask(el, p, id, act, { force })
    if (openTask) sessionStorage.setItem(taskKey, openTask)
    else sessionStorage.removeItem(taskKey)
    void enhance(el)
    return openTask
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]')
    if (t) {
      tab = t.dataset.tab
      sessionStorage.setItem('jarvis:plantab', tab)
      for (const b of root.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === tab)
      return paintPanel()
    }
    const cp = e.target.closest('[data-copy]')
    if (cp) return void copy(cp.dataset.copy)
    const row = e.target.closest('tr.task')
    if (row) return void openTaskRow(row.dataset.task, null)
    const gnode = e.target.closest('g.node')
    if (gnode) {
      const id = taskFromNode(gnode)
      if (id && openTaskRow(id, true)) root.querySelector(`tr.task[data-task="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      return
    }
    const feats = e.target.closest('[data-feats]')
    if (feats) return toggleFeats(feats)
    const focus = e.target.closest('[data-focus]')
    if (focus) return void guard(() => api(`/api/agents/${encodeURIComponent(focus.dataset.focus)}/focus`, { method: 'POST' }), 'pane focado')
    const go = e.target.closest('[data-go]')
    if (go) return void (location.hash = go.dataset.go)

    const act = e.target.closest('[data-act]')?.dataset.act
    if (!act) return

    if (act === 'gate-tp') {
      const ok = await guard(() => api(`${base}/gate/TP`, { method: 'POST' }), 'gate TP aprovado')
      if (ok) await paint()
    } else if (act === 'gate-tb') {
      try {
        const ok = await guard(() => api(`${base}/gate/TB`, { method: 'POST' }), 'gate TB aprovado')
        if (ok) await runKb('freeze')
      } finally {
        // o gate pode ter passado e o freeze falhado: a tela tem de refletir isso
        await paint()
      }
    } else if (act === 'approve' || act === 'in-progress' || act === 'done') {
      const status = act === 'approve' ? 'approved' : act
      const ok = await guard(() => api(`${base}/status`, { method: 'POST', body: { status } }), `status: ${status}`)
      if (ok) await paint()
    } else if (act === 'freeze') {
      await runKb('freeze')
    } else if (act === 'unfreeze') {
      const reason = prompt('motivo do unfreeze (obrigatório):')
      if (!reason?.trim()) return toast('unfreeze exige motivo', 'err')
      await runKb('unfreeze', { reason: reason.trim() })
    } else if (act === 'check') {
      await runKb('check')
    }
  })
}

export async function render(root, params, ctx) {
  if (params.slug) return detail(root, params.vault, params.slug, params.query, ctx)
  return list(root, ctx)
}
