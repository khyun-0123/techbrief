// 목록 페이지 번호 (13 문서 F2): ‹ 1 … 4 5 [6] 7 8 … 12 › · 페이지당 개수
const SIZES = [10, 20, 50]

function pageList(page, total) {
  const pages = new Set([1, total])
  for (let p = page - 2; p <= page + 2; p += 1) if (p >= 1 && p <= total) pages.add(p)
  const sorted = [...pages].sort((a, b) => a - b)
  const out = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(`gap-${p}`)
    out.push(p)
  })
  return out
}

function Pager({ page, pageSize, total, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav className="pager" aria-label="목록 페이지">
      <span className="pager-range">
        {from}–{to} / {total}
      </span>
      <div className="pager-pages">
        <button type="button" className="pager-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="이전 페이지">
          ‹
        </button>
        {pageList(page, pages).map((p) =>
          typeof p === 'string' ? (
            <span key={p} className="pager-gap">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={p === page ? 'pager-btn active' : 'pager-btn'}
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" className="pager-btn" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="다음 페이지">
          ›
        </button>
      </div>
      <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="페이지당 개수">
        {SIZES.map((n) => (
          <option key={n} value={n}>
            {n}개씩
          </option>
        ))}
      </select>
    </nav>
  )
}

export default Pager
