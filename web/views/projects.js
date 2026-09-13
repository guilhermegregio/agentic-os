// views/projects.js — projetos do kb e seus worktrees.
import { api, esc, shortPath, toast, guard, setCrumb, openSessionDialog } from '../app.js'

const pills = (p) =>
  [
    p.hasClaudeMd ? '<span class="pill">CLAUDE.md</span>' : '',
    p.hasGraph ? '<span class="pill">grafo</span>' : '',
    p.monorepo ? '<span class="pill acc">monorepo</span>' : '',
    ...(p.groups || []).map((g) => `<span class="pill">${esc(g)}</span>`),
  ].join(' ')

const gitLine = (g) =>
  g
    ? `<span class="pill">${esc(g.branch || '—')}</span>${g.dirty ? `<span class="pill warn">${g.dirty} sujo</span>` : ''}${
        g.ahead ? `<span class="pill acc">↑${g.ahead}</span>` : ''
      }`
    : '<span class="pill">sem git</span>'

function projectCard(p) {
  return `<section class="card" data-proj="${esc(p.path)}">
    <h2>${esc(p.name)}${p.exists === false ? '<span class="n">ausente</span>' : ''}</h2>
    <small class="dim" title="${esc(p.path)}">${esc(p.path)}</small>
    <div class="row">${gitLine(p.git)}</div>
    <div class="row">${pills(p) || '<span class="dim">—</span>'}</div>
    ${
      (p.subprojects || []).length
        ? `<details class="tool"><summary><span class="n">subprojetos</span><span class="s">${p.subprojects.length}</span></summary>
           <ul class="list">${p.subprojects
             .map(
               (sp) =>
                 `<li><span class="t">${esc(sp.name)}<small>${esc(shortPath(sp.path, 3))}</small></span><button class="btn sm" data-new="${esc(sp.path)}">sessão</button></li>`,
             )
             .join('')}</ul></details>`
        : ''
    }
    <div class="row">
      <button class="btn sm primary" data-new="${esc(p.path)}">nova sessão</button>
      <button class="btn sm" data-wt="${esc(p.path)}">worktrees</button>
    </div>
    <div data-wtbox hidden></div>
  </section>`
}

function worktreesHtml(repoPath, rows, sessions) {
  const cwds = new Set((sessions || []).filter((s) => s.live).map((s) => s.cwd))
  const list = rows.length
    ? `<ul class="list">${rows
        .map(
          (w) => `<li><span class="t">${esc(w.branch || w.head || '—')}
          <small>${esc(shortPath(w.path, 3))}${w.exists === false ? ' · ausente' : ''}</small></span>
          ${w.isMain ? '<span class="pill">main</span>' : ''}
          ${w.dirty ? `<span class="pill warn">${w.dirty} sujo</span>` : ''}
          ${cwds.has(w.path) ? '<span class="pill acc">sessão aqui</span>' : ''}
          <button class="btn sm" data-new="${esc(w.path)}">sessão</button>
          ${w.isMain ? '' : `<button class="btn sm err" data-rmwt="${esc(w.path)}" data-repo="${esc(repoPath)}">remover</button>`}</li>`,
        )
        .join('')}</ul>`
    : '<div class="empty">nenhum worktree</div>'
  return `${list}
    <form class="row" data-wtform data-repo="${esc(repoPath)}" style="margin-top:8px">
      <input name="branch" placeholder="branch nova" required style="flex:1;min-width:140px">
      <input name="base" placeholder="base (opcional)" style="flex:1;min-width:120px">
      <button class="btn sm primary" type="submit">criar</button>
    </form>
    <pre data-wtlog hidden></pre>`
}

// `-` escapado: o atributo pattern compila com o flag v, que recusa `-` solto na classe
const SLUG = '^[a-z0-9][a-z0-9._\\-]{0,63}$'

/** <dialog> de novo projeto — criado pela view, removido ao sair da rota. */
function newProjectDialog() {
  const dlg = document.createElement('dialog')
  dlg.id = 'dlg-project'
  dlg.innerHTML = `<form id="form-project" novalidate>
    <h3>Novo projeto</h3>
    <label>Nome<input name="name" required pattern="${SLUG}" maxlength="64" placeholder="meu-projeto" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="np-err"></label>
    <small class="field-err" id="np-err" role="alert" data-nameerr hidden></small>
    <small class="dest">destino: <span class="mono" data-dest>—</span></small>
    <label>Descrição<textarea name="description" rows="3" placeholder="o que é este projeto — vai para o README e para a casa no vault"></textarea></label>
    <div class="row2">
      <label>Grupo<select name="group"><option value="">nenhum</option></select></label>
      <label>Vault<select name="vault"></select></label>
    </div>
    <label class="check"><input type="checkbox" name="session" checked>abrir sessão de desenvolvimento</label>
    <menu>
      <button type="button" class="btn" data-cancel>cancelar</button>
      <button type="submit" class="btn primary">criar</button>
    </menu>
  </form>`
  document.body.append(dlg)
  return dlg
}

export async function render(root, _params, ctx) {
  setCrumb('Projetos')
  let sessions = []
  let meta = null
  const dlg = newProjectDialog()
  const pf = dlg.querySelector('form')
  ctx.onLeave(() => dlg.remove())
  const load = async () => {
    const [projects, ov, sess] = await Promise.all([
      api('/api/projects'),
      api('/api/overview').catch(() => null),
      api('/api/sessions').catch(() => []),
    ])
    if (!ctx.isCurrent()) return
    sessions = sess
    const orph = ov?.orphanWorktrees || []
    root.innerHTML = `<div class="toolbar"><h1>Projetos</h1><span class="dim">${projects.length} registrados no kb</span><button class="btn sm primary" data-newproj>novo projeto</button></div>
      <div class="cards">
        ${projects.map(projectCard).join('')}
        <section class="card"><h2>Worktrees órfãos<span class="n">${orph.length || 0}</span></h2>
          ${
            orph.length
              ? `<ul class="list">${orph
                  .map(
                    (p) =>
                      `<li><span class="t">${esc(p.split('/').pop())}<small>${esc(p)}</small></span><button class="btn sm" data-new="${esc(p)}">sessão</button></li>`,
                  )
                  .join('')}</ul>`
              : '<div class="empty">nenhum</div>'
          }
        </section>
      </div>`
  }
  await load()

  /** Recarrega (e mostra) a lista de worktrees de um card. */
  async function loadWorktrees(repoPath, box) {
    if (!box) return
    box.hidden = false
    box.innerHTML = '<div class="empty">carregando…</div>'
    try {
      const [rows, sess] = await Promise.all([
        api(`/api/projects/worktrees?path=${encodeURIComponent(repoPath)}`),
        api('/api/sessions').catch(() => sessions),
      ])
      if (!ctx.isCurrent()) return
      sessions = sess || sessions
      box.innerHTML = worktreesHtml(repoPath, rows, sessions)
    } catch (err) {
      if (ctx.isCurrent()) box.innerHTML = `<div class="empty">erro: ${esc(err.message)}</div>`
    }
  }

  const nameErr = pf.querySelector('[data-nameerr]')
  /** Erro inline sob o campo nome; '' limpa. Com erro, o foco volta ao nome. */
  const setNameError = (msg) => {
    nameErr.textContent = msg
    nameErr.hidden = !msg
    pf.name.toggleAttribute('aria-invalid', Boolean(msg))
    if (msg) {
      pf.name.focus()
      pf.name.select()
    }
  }
  const dest = () => {
    const name = pf.name.value.trim()
    pf.querySelector('[data-dest]').textContent = `${meta?.codeDir || '…'}/${name || '<nome>'}`
  }
  pf.name.addEventListener('input', () => {
    dest()
    setNameError('')
  })

  async function openNewProject() {
    if (!meta) {
      meta = await guard(() => api('/api/projects/meta'))
      if (!meta) return
      pf.group.innerHTML =
        '<option value="">nenhum</option>' + (meta.groups || []).map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')
      pf.vault.innerHTML = (meta.vaults || [])
        .map((v) => `<option value="${esc(v.name)}"${v.default ? ' selected' : ''}>${esc(v.name)}</option>`)
        .join('')
    }
    pf.reset()
    setNameError('')
    const def = (meta.vaults || []).find((v) => v.default)
    if (def) pf.vault.value = def.name
    dest()
    dlg.showModal()
    pf.name.focus()
  }

  dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close())
  pf.addEventListener('submit', async (e) => {
    e.preventDefault()
    const name = pf.name.value.trim()
    if (!name) return setNameError('informe o nome do projeto')
    if (!new RegExp(SLUG).test(name)) return setNameError('nome inválido: minúsculas, dígitos e . _ - (começa com letra ou dígito, até 64)')
    const description = pf.description.value.trim() || undefined
    const body = { name, description, group: pf.group.value || undefined, vault: pf.vault.value || undefined }
    const openSession = pf.session.checked
    const btn = pf.querySelector('button[type=submit]')
    btn.disabled = true
    let r = null
    try {
      r = await api('/api/projects', { method: 'POST', body })
    } catch (err) {
      setNameError(err?.message || String(err))
      return
    } finally {
      btn.disabled = false
    }
    dlg.close()
    toast(r.path, 'ok')
    if (!ctx.isCurrent()) return
    await load()
    const card = [...root.querySelectorAll('[data-proj]')].find((c) => c.dataset.proj === r.path)
    if (card) {
      if (r.registered === false) card.querySelector('h2').insertAdjacentHTML('beforeend', '<span class="pill warn">sem registro no kb</span>')
      const pre = document.createElement('pre')
      pre.textContent = (r.log || []).join('\n') || r.path
      card.append(pre)
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    // a descrição é do README/vault: a sessão abre vazia e a pessoa escolhe modo, modelo e o que fazer
    if (openSession) await openSessionDialog(r.path)
  })

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-newproj]')) return void openNewProject()

    const nw = e.target.closest('[data-new]')
    if (nw) return void openSessionDialog(nw.dataset.new)

    const wt = e.target.closest('[data-wt]')
    if (wt) {
      const box = wt.closest('[data-proj]').querySelector('[data-wtbox]')
      if (!box.hidden) {
        box.hidden = true
        return
      }
      await loadWorktrees(wt.dataset.wt, box)
      return
    }

    const rm = e.target.closest('[data-rmwt]')
    if (rm) {
      if (!confirm(`remover o worktree ${rm.dataset.rmwt}?`)) return
      const box = rm.closest('[data-wtbox]')
      const ok = await guard(
        () =>
          api('/api/projects/worktrees', {
            method: 'DELETE',
            body: { repoPath: rm.dataset.repo, path: rm.dataset.rmwt },
          }),
        'worktree removido',
      )
      if (ok) await loadWorktrees(rm.dataset.repo, box)
    }
  })

  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-wtform]')
    if (!f) return
    e.preventDefault()
    const branch = f.branch.value.trim()
    if (!branch) return
    const base = f.base.value.trim() || undefined
    const btn = f.querySelector('button')
    btn.disabled = true
    const r = await guard(
      () => api('/api/projects/worktrees', { method: 'POST', body: { repoPath: f.dataset.repo, branch, base } }),
      'worktree criado',
    )
    btn.disabled = false
    if (r) {
      const log = (r.log || []).join('\n') || r.path
      toast(r.path, 'ok')
      // a lista do card ficou velha: o worktree novo tem de aparecer nela
      const box = f.closest('[data-wtbox]')
      await loadWorktrees(f.dataset.repo, box)
      const fresh = box.querySelector('[data-wtlog]')
      if (fresh) {
        fresh.hidden = false
        fresh.textContent = log
      }
    }
  })

}
