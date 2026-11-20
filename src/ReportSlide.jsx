// 보고서 4:3 가로형 한 쪽 — 화면 미리보기 · PDF 인쇄 (11/12 시안 08 · 09, 차트 가이드 10)
// 자리 · 크기는 모두 reportSlides.js가 인치로 정하고 여기서는 1in = 96px로 그대로 그린다 (PPT도 같은 값, reportExport.js)
// 글꼴: 영문 · 숫자 Arial Narrow, 한글 LG 스마트체 (그 PC에 있으면). 글자 크기는 pt 그대로
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { COLOR, PAGE, PIE_COLORS, reportPages } from './reportSlides.js'

const PX = 96
export const SLIDE_W = PAGE.w * PX
export const SLIDE_H = PAGE.h * PX
const px = (inch) => `${inch * PX}px`
const hex = (c) => (c ? `#${c}` : undefined)
const FS = '10pt'

function Runs({ runs }) {
  return runs.map((r, i) => {
    const style = { color: hex(r.color), fontWeight: r.bold ? 700 : undefined, fontSize: r.size ? `${r.size}pt` : undefined }
    return r.link ? (
      <a key={i} href={r.link} target="_blank" rel="noreferrer" style={{ ...style, textDecoration: 'underline' }}>
        {r.text}
      </a>
    ) : (
      <span key={i} style={style}>
        {r.text}
      </span>
    )
  })
}

function niceMax(max) {
  if (max <= 5) return { top: Math.max(1, max), step: 1 }
  const step = Math.ceil(max / 5 / (max > 50 ? 10 : 1)) * (max > 50 ? 10 : 1)
  return { top: step * Math.ceil(max / step), step }
}
const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

// 그래프 (11/12 규칙): hbar 가로 막대(순위) · line 선(추이) · donut 도넛(구성비) — 축 이름 · 단위 표기
function Chart({ el }) {
  const W = el.w * PX
  const H = el.h * PX
  const accent = hex(COLOR.accent)
  const box = { position: 'absolute', left: px(el.x), top: px(el.y), overflow: 'visible' }
  if (!el.values.length || el.values.every((v) => !v))
    return (
      <svg width={W} height={H} style={box} role="img" aria-label={el.empty}>
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={FS} fill="#555">
          {el.empty}
        </text>
      </svg>
    )
  const label = `${el.yTitle} — ${el.labels.map((l, i) => `${l} ${el.values[i]}`).join(', ')}`

  if (el.kind === 'pie' || el.kind === 'donut') {
    const total = el.values.reduce((a, b) => a + b, 0)
    // 범례를 밖(reportSlides.js donutLayout)에 그리면 그림 칸 전체가 원
    const r = el.legendOutside ? Math.min(W, H) / 2 - 2 : Math.min(W * 0.28, (H - 10) / 2)
    const cx = el.legendOutside ? W / 2 : r + 6
    const cy = H / 2
    const starts = el.values.map((_, i) => -Math.PI / 2 + (el.values.slice(0, i).reduce((x, y) => x + y, 0) / total) * Math.PI * 2)
    const arcs = el.values.map((v, i) => {
      const a0 = starts[i]
      const a1 = a0 + (v / total) * Math.PI * 2
      const large = a1 - a0 > Math.PI ? 1 : 0
      const d =
        v === total
          ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`
          : `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large},1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`
      const mid = (a0 + a1) / 2
      return { d, mid, v, i }
    })
    return (
      <svg width={W} height={H} style={box} role="img" aria-label={label}>
        {arcs.map((p) => (
          <path key={p.i} d={p.d} fill={hex(PIE_COLORS[p.i % PIE_COLORS.length])} stroke="#fff" strokeWidth="1.5" />
        ))}
        {el.kind === 'donut' && (
          <>
            <circle cx={cx} cy={cy} r={r * 0.55} fill="#fff" />
            <text x={cx} y={cy + 5} textAnchor="middle" fontSize={FS} fontWeight="700">
              총 {total}
              {el.unit}
            </text>
          </>
        )}
        {arcs.map((p) =>
          p.v / total >= 0.08 ? (
            <text key={`t${p.i}`} x={cx + r * (el.kind === 'donut' ? 0.78 : 0.62) * Math.cos(p.mid)} y={cy + r * (el.kind === 'donut' ? 0.78 : 0.62) * Math.sin(p.mid) + 4} textAnchor="middle" fontSize={FS} fill="#fff" fontWeight="700">
              {Math.round((p.v / total) * 100)}%
            </text>
          ) : null,
        )}
        {!el.legendOutside && el.labels.map((l, i) => (
          <g key={`l${i}`} transform={`translate(${cx + r + 18}, ${cy - (el.labels.length * 18) / 2 + i * 18})`}>
            <rect width="10" height="10" y="2" fill={hex(PIE_COLORS[i % PIE_COLORS.length])} />
            <text x="16" y="11" fontSize={FS}>
              {cut(l, 14)} ({el.values[i]}{el.unit})
            </text>
          </g>
        ))}
      </svg>
    )
  }

  const { top, step } = niceMax(Math.max(...el.values))
  const ticks = []
  for (let v = 0; v <= top; v += step) ticks.push(v)

  if (el.kind === 'hbar') {
    const L = Math.min(W * 0.42, 12 + Math.max(...el.labels.map((l) => cut(l, 12).length)) * 9)
    const T = 4
    const B = 34
    const plotW = W - L - 16
    const plotH = H - T - B
    const rowH = plotH / el.values.length
    return (
      <svg width={W} height={H} style={box} role="img" aria-label={label}>
        {ticks.map((v) => {
          const x = L + (v / top) * plotW
          return (
            <g key={v}>
              <line x1={x} y1={T} x2={x} y2={T + plotH} stroke="#E5E5E5" />
              <text x={x} y={T + plotH + 13} textAnchor="middle" fontSize={FS}>
                {v}
              </text>
            </g>
          )
        })}
        <line x1={L} y1={T} x2={L} y2={T + plotH} stroke="#555" />
        {el.values.map((v, i) => {
          const y = T + rowH * i + rowH * 0.2
          const w = (v / top) * plotW
          return (
            <g key={i}>
              <text x={L - 6} y={y + rowH * 0.3 + 4} textAnchor="end" fontSize={FS}>
                {cut(el.labels[i], 12)}
              </text>
              <rect x={L} y={y} width={w} height={rowH * 0.6} fill={accent} />
              <text x={L + w + 4} y={y + rowH * 0.3 + 4} fontSize={FS}>
                {v}
              </text>
            </g>
          )
        })}
        <text x={L + plotW / 2} y={H - 2} textAnchor="middle" fontSize={FS} fill="#555">
          {el.yTitle}
        </text>
      </svg>
    )
  }

  // 선 그래프 (가로축 날짜): 라벨은 reportSlides.js axisLayout이 고른 것만 (최대 7개 · 첫/마지막 포함), 필요하면 45도
  // 아래 여백 = 라벨 여백(labelPad) + 축 제목 줄 → 라벨 · 축 제목이 겹치지 않게
  const shownTicks = new Set(el.ticks ?? el.labels.map((_, i) => i))
  const titleH = (10 / 72) * 1.35 * PX
  const L = 44
  const B = (el.labelPad ?? 0.25) * PX + titleH + 4
  const T = 14
  const R = 8
  const plotW = W - L - R
  const plotH = H - T - B
  const n = el.values.length
  const xAt = (i) => L + (plotW / n) * (i + 0.5)
  const yAt = (v) => T + plotH - (v / top) * plotH
  const rotate = Boolean(el.rotate)
  return (
    <svg width={W} height={H} style={box} role="img" aria-label={label}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} y1={yAt(v)} x2={L + plotW} y2={yAt(v)} stroke="#E5E5E5" />
          <text x={L - 6} y={yAt(v) + 4} textAnchor="end" fontSize={FS}>
            {v}
          </text>
        </g>
      ))}
      <line x1={L} y1={T + plotH} x2={L + plotW} y2={T + plotH} stroke="#555" />
      {el.kind === 'line' ? (
        <>
          <path d={`M${el.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' L')} L${xAt(n - 1)},${T + plotH} L${xAt(0)},${T + plotH} Z`} fill="#FDECF0" />
          <path d={`M${el.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' L')}`} fill="none" stroke={accent} strokeWidth="2" />
          {el.values.map((v, i) => (
            <circle key={i} cx={xAt(i)} cy={yAt(v)} r="3.5" fill="#fff" stroke={accent} strokeWidth="2" />
          ))}
        </>
      ) : (
        el.values.map((v, i) => {
          const bw = Math.min(40, (plotW / n) * 0.55)
          return (
            <g key={i}>
              <rect x={xAt(i) - bw / 2} y={yAt(v)} width={bw} height={T + plotH - yAt(v)} fill={accent} />
              <text x={xAt(i)} y={yAt(v) - 4} textAnchor="middle" fontSize={FS}>
                {v}
              </text>
            </g>
          )
        })
      )}
      {el.labels.map((l, i) =>
        shownTicks.has(i) ? (
          <g key={i}>
            <line x1={xAt(i)} y1={T + plotH} x2={xAt(i)} y2={T + plotH + 4} stroke="#555" />
            <text x={xAt(i)} y={T + plotH + 16} textAnchor={rotate ? 'end' : 'middle'} fontSize={FS} transform={rotate ? `rotate(-45 ${xAt(i)} ${T + plotH + 16})` : undefined}>
              {cut(l, 10)}
            </text>
          </g>
        ) : null,
      )}
      <text x={L + plotW / 2} y={H - 2} textAnchor="middle" fontSize={FS} fill="#555">
        {el.xTitle}
      </text>
      <text x={11} y={T + plotH / 2} textAnchor="middle" fontSize={FS} fill="#555" transform={`rotate(-90 11 ${T + plotH / 2})`}>
        {el.yTitle}
      </text>
    </svg>
  )
}

function El({ el, total }) {
  const pos = { left: px(el.x), top: px(el.y), width: px(el.w) }
  switch (el.t) {
    case 'text':
      return (
        <div className="rs-text" style={{ ...pos, minHeight: px(el.h), fontSize: `${el.size}pt`, fontWeight: el.bold ? 700 : undefined, color: hex(el.color), textAlign: el.align }}>
          <Runs runs={el.runs} />
        </div>
      )
    case 'rect':
      return <div className="rs-rect" style={{ ...pos, height: px(el.h), background: hex(el.fill), border: el.line ? `1.5px solid ${hex(el.line)}` : undefined, borderRadius: el.radius ? px(el.radius) : undefined }} />
    case 'tri':
      return <div className="rs-rect" style={{ ...pos, height: px(el.h), background: hex(el.fill), clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }} />
    case 'check':
      return (
        <div className="rs-check" style={{ left: px(el.x), top: px(el.y), width: px(el.d), height: px(el.d) }}>
          ✓
        </div>
      )
    case 'line':
      return <div className="rs-line" style={{ ...pos, borderTopColor: hex(el.color) }} />
    case 'pageno':
      return (
        <div className="rs-text rs-pageno" style={{ right: px(PAGE.m), top: px(PAGE.h - 0.42), fontSize: '10pt', fontWeight: 700 }}>
          {el.no} / {total}
        </div>
      )
    case 'chart':
      return <Chart el={el} />
    case 'table':
      return (
        <table className={el.headCol ? 'rs-table rs-table-info' : 'rs-table'} style={{ ...pos, fontSize: `${el.size}pt` }}>
          <colgroup>
            {el.cols.map((w, i) => (
              <col key={i} style={{ width: px(w) }} />
            ))}
          </colgroup>
          <tbody>
            {el.rows.map((r, ri) => (
              <tr key={ri} style={{ height: px(r.h) }}>
                {r.cells.map((c, i) => (i === 0 && el.headCol ? <th key={i}>{c}</th> : <td key={i}>{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    default:
      return null
  }
}

export function ReportSlide({ deck, index }) {
  const page = deck.pages[index]
  return (
    <div className="rs-slide">
      {page.els.map((el, i) => (
        <El key={i} el={el} total={deck.pages.length} />
      ))}
    </div>
  )
}

// 줄여 보이기: width(px)에 맞춘다. width가 없으면 부모 폭에 맞춘다
export function SlideFrame({ deck, index, width }) {
  const ref = useRef(null)
  const [w, setW] = useState(width ?? SLIDE_W)
  useEffect(() => {
    if (width) return undefined
    const el = ref.current
    if (!el) return undefined
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])
  const scale = (width ?? w) / SLIDE_W
  return (
    <div ref={ref} className="rs-frame-wrap">
      <div className="rs-frame" style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: SLIDE_W, height: SLIDE_H }}>
          <ReportSlide deck={deck} index={index} />
        </div>
      </div>
    </div>
  )
}

// PDF: 모든 쪽을 원래 크기로 그려 인쇄 창을 연다 → 「PDF로 저장」. 쪽 크기는 10×7.5in 가로 (App.css @page slides)
// extra: 화면이 받아 둔 추가 데이터 (기사 수 추이용 /api/trends)
export async function printSlides(saved, extra) {
  if (!extra) {
    const { loadReportExtra } = await import('./reportExport.js')
    extra = await loadReportExtra(saved)
  }
  const deck = reportPages(saved, extra)
  const host = document.createElement('div')
  host.className = 'print-slides'
  document.body.appendChild(host)
  // 11/20: 인쇄하는 동안만 기본 쪽 크기를 4:3 가로(10×7.5in, 여백 0)로 — 이름 붙은 쪽(@page slides)을 따르지 않는 인쇄 창에서는
  // 사이트 기본 A4 세로가 쓰여 쪽이 잘리고 다음 장으로 넘어갔다
  const pageStyle = document.createElement('style')
  pageStyle.textContent = '@page { size: 10in 7.5in; margin: 0; }'
  document.head.appendChild(pageStyle)
  const root = createRoot(host)
  root.render(
    <>
      {deck.pages.map((_, i) => (
        <ReportSlide key={i} deck={deck} index={i} />
      ))}
    </>,
  )
  const done = () => {
    window.removeEventListener('afterprint', done)
    document.body.classList.remove('printing-slides')
    root.unmount()
    host.remove()
    pageStyle.remove()
  }
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.body.classList.add('printing-slides')
      window.addEventListener('afterprint', done)
      const go = () => window.print()
      if (document.fonts?.ready) document.fonts.ready.then(go)
      else go()
    }),
  )
}
