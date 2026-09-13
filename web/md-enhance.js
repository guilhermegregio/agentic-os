// md-enhance.js — pós-processamento do HTML que `md()` já sanitizou: highlight
// por linguagem, barra com nome + copiar em cada bloco, e diagramas mermaid
// renderizados sob demanda. Roda DEPOIS de inserir no DOM (o `sanitize()` do
// app.js remove <svg>; o SVG aqui vem só da saída do mermaid em modo strict).
import { esc, toast, node } from './app.js'

const MERMAID_URL = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.15.0/mermaid.min.js'

// --------------------------------------------------------------------------
// Gherkin (pt + en) — o bundle do highlight.js não traz a gramática, e a
// oficial só conhece as keywords em inglês.
// --------------------------------------------------------------------------
function gherkin(hljs) {
  return {
    name: 'Gherkin',
    contains: [
      { className: 'meta', begin: /^\s*#\s*language:.*$/ },
      hljs.COMMENT(/^\s*#/, /$/),
      {
        className: 'keyword',
        begin: /^\s*(Funcionalidade|Regra|Contexto|Esquema do Cenário|Delineação do Cenário|Cenários|Cenário|Exemplos|Feature|Rule|Background|Scenario Outline|Scenario Template|Scenarios|Scenario|Examples)(?=\s*:)/,
      },
      { className: 'keyword', begin: /^\s*(Dado|Dada|Dados|Dadas|Quando|Então|E|Mas|Given|When|Then|And|But)(?=\s)/ },
      { className: 'string', begin: /"""/, end: /"""/ },
      { className: 'string', begin: /"/, end: /"/, illegal: /\n/ },
      { className: 'symbol', begin: /@[^@\s]+/ },
      { className: 'variable', begin: /<[^>\n]+>/ },
      { className: 'punctuation', begin: /\|/ },
    ],
  }
}

let hljsReady = false
function setupHljs() {
  const h = globalThis.hljs
  if (hljsReady || !h) return h
  hljsReady = true
  try {
    h.configure({ ignoreUnescapedHTML: true })
    if (!h.getLanguage('gherkin')) h.registerLanguage('gherkin', gherkin)
    if (!h.getLanguage('feature')) h.registerLanguage('feature', gherkin)
  } catch {
    /* highlight é enfeite: sem ele o bloco fica como veio */
  }
  return h
}

// --------------------------------------------------------------------------
// Mermaid — carregado uma vez, só quando a página tem um bloco.
// --------------------------------------------------------------------------
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches
let mermaidP = null
function loadMermaid() {
  if (mermaidP) return mermaidP
  mermaidP = new Promise((resolve, reject) => {
    if (globalThis.mermaid) return resolve(globalThis.mermaid)
    const s = document.createElement('script')
    s.src = MERMAID_URL
    s.onload = () => resolve(globalThis.mermaid)
    s.onerror = () => reject(new Error('mermaid indisponível (cdn)'))
    document.head.append(s)
  }).then((m) => {
    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true, // erro vira pill no bloco, nunca a "bomba" solta no body
      theme: dark() ? 'dark' : 'default',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      flowchart: { htmlLabels: true, curve: 'basis' },
    })
    return m
  })
  mermaidP.catch(() => (mermaidP = null)) // deixa tentar de novo no próximo bloco
  return mermaidP
}

let seq = 0
async function renderMermaid(wrap, pre, src) {
  const bar = wrap.querySelector('.codebar')
  const status = node('<span class="pill">diagrama…</span>')
  bar.querySelector('.lang').after(status)
  const id = `mm-${Date.now().toString(36)}-${++seq}`
  try {
    const m = await loadMermaid()
    if (!wrap.isConnected) return
    const { svg } = await m.render(id, src)
    if (!wrap.isConnected) return
    const fig = document.createElement('figure')
    fig.className = 'mermaid-out'
    fig.innerHTML = svg
    pre.hidden = true
    pre.after(fig)
    status.remove()
    // No mobile o diagrama mantém a largura natural e rola, em vez de encolher
    // até ficar ilegível; no desktop cabe na coluna (max-width do próprio mermaid).
    const el = fig.querySelector('svg')
    const natural = parseFloat(el?.style.maxWidth) || 0
    if (el && natural > fig.clientWidth && matchMedia('(max-width: 899px)').matches) {
      el.style.width = `${Math.ceil(natural)}px`
      el.style.maxWidth = 'none'
    }
    const btn = node('<button type="button" class="cb" data-cb="source" aria-pressed="false">fonte</button>')
    bar.querySelector('[data-cb="copy"]').before(btn)
    wrap.dataset.mermaid = 'ok'
    wrap.dispatchEvent(new CustomEvent('mermaid', { bubbles: true, detail: { svg: fig.querySelector('svg') } }))
  } catch (e) {
    // versões antigas deixam o container temporário/erro no body
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
    status.className = 'pill err'
    status.textContent = 'mermaid inválido'
    status.title = String(e?.message || e).slice(0, 300)
    const why = node(`<div class="mm-err dim">${esc(String(e?.message || e).split('\n').slice(0, 3).join(' · ').slice(0, 300))}</div>`)
    pre.after(why)
    wrap.dataset.mermaid = 'error'
  }
}

// --------------------------------------------------------------------------
// Barra do bloco + copiar
// --------------------------------------------------------------------------
function decorate(pre, lang) {
  const wrap = document.createElement('div')
  wrap.className = 'codeblock'
  pre.replaceWith(wrap)
  wrap.append(
    node(`<div class="codebar"><span class="lang">${esc(lang || '')}</span><span class="spacer"></span>
      <button type="button" class="cb" data-cb="copy" aria-label="copiar bloco">copiar</button></div>`),
    pre,
  )
  return wrap
}

async function copyText(text, el) {
  try {
    await navigator.clipboard.writeText(text)
    toast('copiado', 'ok')
    return true
  } catch {
    // sem clipboard (http fora do loopback, permissão negada): seleciona para o usuário copiar
    if (el) {
      const r = document.createRange()
      r.selectNodeContents(el)
      const sel = getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
    }
    toast('sem acesso à área de transferência: texto selecionado', 'err')
    return false
  }
}
/** Copia um texto avulso (chips de branch, comandos) com o mesmo feedback. */
export const copy = (text) => copyText(String(text ?? ''))

let wired = false
function wire() {
  if (wired) return
  wired = true
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cb]')
    if (!b) return
    const wrap = b.closest('.codeblock')
    if (!wrap) return
    const pre = wrap.querySelector('pre')
    if (b.dataset.cb === 'copy') {
      void copyText(wrap.dataset.src ?? pre?.textContent ?? '', pre)
    } else if (b.dataset.cb === 'source') {
      const fig = wrap.querySelector('.mermaid-out')
      const showSrc = pre.hidden
      pre.hidden = !showSrc
      if (fig) fig.hidden = showSrc
      b.setAttribute('aria-pressed', String(showSrc))
    }
  })
}

// --------------------------------------------------------------------------
// Entrada: enhance(root) — idempotente; devolve quando os diagramas terminaram.
// --------------------------------------------------------------------------
export async function enhance(root) {
  if (!root) return
  wire()
  const h = setupHljs()
  const jobs = []
  for (const pre of root.querySelectorAll('.md pre, .msg.assistant pre')) {
    if (pre.dataset.enhanced || pre.closest('.codeblock')) continue
    pre.dataset.enhanced = '1'
    const code = pre.querySelector('code')
    const lang = code ? ([...code.classList].find((c) => c.startsWith('language-')) || '').slice(9).toLowerCase() : ''
    const src = (code || pre).textContent
    const wrap = decorate(pre, lang)
    wrap.dataset.src = src
    if (lang === 'mermaid') {
      jobs.push(renderMermaid(wrap, pre, src))
    } else if (lang && h && h.getLanguage(lang)) {
      try {
        h.highlightElement(code)
      } catch {
        /* fica sem cor */
      }
    }
  }
  await Promise.all(jobs)
}
