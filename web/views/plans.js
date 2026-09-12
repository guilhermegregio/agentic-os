// views/plans.js — console do devflow: lista de planos e o detalhe com gates,
// contratos congelados e execução.
import { api, esc, md, shortPath, relTime, toast, guard, setCrumb } from '../app.js'

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
    <div class="row">${statusPill(p.status)}${(p.gates || []).map(gatePill).join('')}${
      (p.ready || []).length ? `<span class="pill acc">pronto: ${esc((p.ready || []).join(', '))}</span>` : ''
    }</div>
    <div class="mrow"><span class="t">progresso</span><b>${esc(prog.done ?? '—')}/${esc(prog.total ?? '—')}</b>
      <span class="meter"><i style="width:${w}%"></i></span></div>
    <small class="dim">${esc((p.projects || []).join(', ') || '—')}${p.lastExecution ? ` · última execução ${esc(relTime(p.lastExecution.ts))}` : ''}</small>
  </section>`
}

async function list(root, ctx) {
  setCrumb('Planos')
  const plans = await api('/api/plans')
  root.innerHTML = `<div class="toolbar"><h1>Planos</h1><span class="dim">${plans.length} ativos</span></div>
    ${plans.length ? `<div class="cards">${plans.map(planCard).join('')}</div>` : '<div class="empty">nenhum plano ativo</div>'}`
  root.addEventListener('click', (e) => {
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

function tasksHtml(p) {
  const rows = p.tasks || []
  if (!rows.length) return '<div class="empty">sem tasks</div>'
  return `<div class="tablewrap"><table>
    <thead><tr><th>id</th><th>título</th><th>status</th><th>deps</th><th>pronta</th><th>escopo</th></tr></thead>
    <tbody>${rows
      .map(
        (t) => `<tr>
        <td><b>${esc(t.id)}</b>${t.gate ? ' ⛔' : ''}</td>
        <td>${esc(t.title || '—')}</td>
        <td>${statusPill(t.status)}</td>
        <td class="dim">${esc((t.dependsOn || []).join(', ') || '—')}</td>
        <td>${t.ready ? '<span class="pill acc">sim</span>' : '<span class="dim">não</span>'}</td>
        <td class="mono dim">${esc((t.scope || []).join(' ') || '—')}</td>
      </tr>`,
      )
      .join('')}</tbody></table></div>`
}

function contractsHtml(p) {
  const rows = p.contracts || []
  if (!rows.length) return '<div class="empty">nenhum contrato declarado</div>'
  return rows
    .map(
      (c, i) => `<section class="card" data-contract="${esc(c.file)}">
      <h2>${esc(c.file)}</h2>
      <small class="dim">${esc(c.path || '—')}</small>
      <div class="row">
        <span class="pill ${c.frozen ? 'ok' : ''}">${c.frozen ? '🧊 congelado' : 'não congelado'}</span>
        ${c.frozenAt ? `<span class="pill">${esc(new Date(c.frozenAt).toLocaleString('pt-BR'))}</span>` : ''}
        ${c.drifted ? '<span class="pill err">drift</span>' : ''}
        ${c.exists === false ? '<span class="pill err">ausente</span>' : ''}
      </div>
      <div class="row">
        ${c.frozen ? '<button class="btn sm warn" data-act="unfreeze">descongelar</button>' : '<button class="btn sm primary" data-act="freeze">congelar</button>'}
        <button class="btn sm" data-act="check">kb dev check</button>
      </div>
      <pre>${esc(c.content || '—')}</pre>
      ${i === 0 ? '<pre data-el="kbout" hidden></pre>' : ''}
    </section>`,
    )
    .join('')
}

const TABS = [
  ['plan', 'Plano'],
  ['tasks', 'Tasks'],
  ['contracts', 'Contratos'],
  ['exec', 'Execução'],
]

async function detail(root, vault, slug, ctx) {
  setCrumb(`${vault}/${slug}`)
  let tab = sessionStorage.getItem('jarvis:plantab') || 'plan'
  let p = null

  const paint = async () => {
    p = await api(`/api/plans/${encodeURIComponent(vault)}/${encodeURIComponent(slug)}`)
    if (!ctx.isCurrent()) return
    setCrumb(p.title || `${vault}/${slug}`)
    const files = p.files || {}
    const panels = {
      plan: files.plan?.markdown ? `<div class="md">${md(body(files.plan.markdown))}</div>` : '<div class="empty">sem _plan.md</div>',
      tasks: tasksHtml(p),
      contracts: contractsHtml(p),
      exec: (files.execution || []).length
        ? (files.execution || [])
            .map((f) => `<section class="card"><h2>${esc(f.name)}</h2><div class="md">${md(body(f.markdown))}</div></section>`)
            .join('')
        : '<div class="empty">nenhum log de execução</div>',
    }
    root.innerHTML = `<div class="toolbar">
        <h1>${esc(p.title || slug)}</h1>
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
      <div data-el="panel">${panels[tab] || ''}</div>`
  }

  await paint()

  const kbOut = (text) => {
    const el = root.querySelector('[data-el="kbout"]')
    if (!el) return toast(text.slice(0, 120))
    el.hidden = false
    el.textContent = text
  }

  const runKb = async (cmd, body = {}) => {
    const r = await guard(() => api(`/api/plans/${encodeURIComponent(vault)}/${encodeURIComponent(slug)}/kb/${cmd}`, { method: 'POST', body }))
    if (!r) return null
    toast(`kb dev ${cmd}: ${r.ok ? 'ok' : 'falhou (código ' + r.code + ')'}`, r.ok ? 'ok' : 'err')
    await paint()
    if (!ctx.isCurrent()) return r
    kbOut(r.output || '(sem saída)')
    return r
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]')
    if (t) {
      tab = t.dataset.tab
      sessionStorage.setItem('jarvis:plantab', tab)
      return void paint()
    }
    const act = e.target.closest('[data-act]')?.dataset.act
    if (!act) return
    const base = `/api/plans/${encodeURIComponent(vault)}/${encodeURIComponent(slug)}`

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
  if (params.slug) return detail(root, params.vault, params.slug, ctx)
  return list(root, ctx)
}
