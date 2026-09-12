// charts.js — SVG inline, sem dependências.
// Regras: marcas finas, cantos 4px, cores categóricas em ORDEM FIXA (c1,c2,c3)
// e "outros" em c4. Texto sempre na cor de texto (svg text { fill:var(--dim) }).

const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)']
export const OTHER = 'var(--c4)'

/** Cor categórica pela posição — nunca cicla: 4º em diante é "outros". */
export function colorFor(i) {
  return PALETTE[i] ?? OTHER
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/**
 * Reduz uma lista categórica a no máximo 4 faixas: as 3 primeiras mantêm a
 * identidade, o resto vira uma única faixa "outros".
 */
export function fold(rows, limit = 3) {
  const src = (rows || []).filter(Boolean)
  if (src.length <= limit + 1) return src.map((r, i) => ({ ...r, color: r.color || colorFor(i) }))
  const head = src.slice(0, limit).map((r, i) => ({ ...r, color: r.color || colorFor(i) }))
  const rest = src.slice(limit)
  head.push({
    label: `outros (${rest.length})`,
    value: rest.reduce((a, b) => a + (Number(b.value) || 0), 0),
    color: OTHER,
    rest,
  })
  return head
}

/** Legenda em HTML (não SVG, para herdar a cor de texto do tema). */
export function legend(rows) {
  if (!rows || rows.length < 2) return ''
  return `<div class="legend">${rows
    .map((r) => `<span><i style="background:${esc(r.color || OTHER)}"></i>${esc(r.label)}</span>`)
    .join('')}</div>`
}

function norm(series) {
  if (!series || !series.length) return []
  if (typeof series[0] === 'number') return [{ label: '', values: series.map(Number), color: colorFor(0) }]
  return series.map((s, i) => ({
    label: s.label ?? '',
    values: (s.values || []).map(Number),
    color: s.color || colorFor(i),
    labels: s.labels,
  }))
}

/**
 * sparkline(series, {w,h}) — série única (array de números) ou várias
 * ([{label, values}]). Hover por ponto via <title>.
 */
export function sparkline(series, opts = {}) {
  const { w = 300, h = 48, fmt = (v) => v, labels = [] } = opts
  const ss = norm(series).filter((s) => s.values.length)
  if (!ss.length) return '<div class="empty">—</div>'
  const n = Math.max(...ss.map((s) => s.values.length))
  const all = ss.flatMap((s) => s.values).filter((v) => Number.isFinite(v))
  const max = Math.max(1e-9, ...all)
  const min = Math.min(0, ...all)
  const pad = 2
  const x = (i) => (n < 2 ? w / 2 : pad + (i * (w - pad * 2)) / (n - 1))
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2)

  const paths = ss
    .map((s) => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
      const area =
        ss.length === 1
          ? `<path d="${d} L${x(s.values.length - 1).toFixed(1)} ${h - pad} L${x(0).toFixed(1)} ${h - pad} Z" fill="${s.color}" opacity=".12"/>`
          : ''
      return `${area}<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
    })
    .join('')

  const hot = ss[0].values
    .map((v, i) => {
      const lbl = ss[0].labels?.[i] ?? labels[i] ?? i + 1
      const txt = ss.map((s) => `${s.label ? s.label + ': ' : ''}${fmt(s.values[i])}`).join(' · ')
      const bw = (w - pad * 2) / Math.max(1, n)
      return `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${h}" fill="transparent"><title>${esc(lbl)} — ${esc(txt)}</title></rect>`
    })
    .join('')

  const last = ss[0].values[ss[0].values.length - 1]
  const dot = ss.length === 1 ? `<circle cx="${x(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.5" fill="${ss[0].color}"/>` : ''

  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="série temporal">${paths}${dot}${hot}</svg>${legend(ss.map((s) => ({ label: s.label, color: s.color })))}`
}

/**
 * hbars(rows) — barras horizontais com rótulo acima e valor à direita.
 * Agrupa a partir do 4º item em "outros" (desligue com {fold:false}).
 */
export function hbars(rows, opts = {}) {
  const { w = 300, fmt = (v) => v, rowH = 34, fold: doFold = true, withLegend = true } = opts
  const data = (doFold ? fold(rows) : (rows || []).map((r, i) => ({ ...r, color: r.color || colorFor(i) }))).filter(
    (r) => r && Number.isFinite(Number(r.value)),
  )
  if (!data.length) return '<div class="empty">—</div>'
  const max = Math.max(1e-9, ...data.map((r) => Number(r.value)))
  const h = data.length * rowH
  const bars = data
    .map((r, i) => {
      const top = i * rowH
      const bw = Math.max(2, (Number(r.value) / max) * w)
      return `<g><text x="0" y="${top + 11}">${esc(r.label)}</text>
<text x="${w}" y="${top + 11}" text-anchor="end">${esc(fmt(r.value))}</text>
<rect x="0" y="${top + 17}" width="${w}" height="8" rx="4" fill="var(--panel2)"/>
<rect x="0" y="${top + 17}" width="${bw.toFixed(1)}" height="8" rx="4" fill="${r.color}"><title>${esc(r.label)}: ${esc(fmt(r.value))}</title></rect></g>`
    })
    .join('')
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="comparação por categoria">${bars}</svg>${
    withLegend ? legend(data.map((r) => ({ label: r.label, color: r.color }))) : ''
  }`
}

/** meter(percent) — barra única em SVG, cantos 4px, cor por severidade. */
export function meter(percent, opts = {}) {
  const { w = 300, h = 8, color, title } = opts
  const p = Math.max(0, Math.min(100, Number(percent) || 0))
  const c = color || (p >= 90 ? 'var(--err)' : p >= 70 ? 'var(--warn)' : 'var(--c1)')
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px" role="img" aria-label="${esc(title || p + '%')}">
<rect x="0" y="0" width="${w}" height="${h}" rx="4" fill="var(--panel2)"/>
<rect x="0" y="0" width="${((p / 100) * w).toFixed(1)}" height="${h}" rx="4" fill="${c}"><title>${esc(title || p + '%')}</title></rect></svg>`
}
