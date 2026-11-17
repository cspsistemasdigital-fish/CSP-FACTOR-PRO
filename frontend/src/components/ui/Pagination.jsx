function pagesList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const pages = new Set([1, total, current, current - 1, current + 1])
  if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page))
  if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((page) => pages.add(page))
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b)
  const output = []
  let previous = 0
  sorted.forEach((page) => {
    if (previous && page - previous > 1) output.push('…')
    output.push(page)
    previous = page
  })
  return output
}

export default function Pagination({ meta, onChange }) {
  if (!meta || !meta.total) return null
  const { page, pages, total, per_page: perPage } = meta
  const from = (page - 1) * perPage + 1
  const to = Math.min(page * perPage, total)

  return (
    <div className="fp-pagination">
      <span className="pagination-info">
        Exibindo <strong>{from}</strong>–<strong>{to}</strong> de <strong>{total}</strong> registro(s)
      </span>
      <div className="pagination-controls">
        <button
          type="button"
          className="page-btn"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Página anterior"
        >
          <i className="bi bi-chevron-left" />
        </button>
        {pagesList(page, pages).map((item, index) =>
          item === '…' ? (
            <span className="page-ellipsis" key={`ellipsis-${index}`}>
              …
            </span>
          ) : (
            <button
              type="button"
              key={item}
              className={`page-btn ${item === page ? 'active' : ''}`}
              onClick={() => onChange(item)}
              aria-current={item === page ? 'page' : undefined}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          className="page-btn"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          aria-label="Próxima página"
        >
          <i className="bi bi-chevron-right" />
        </button>
      </div>
    </div>
  )
}
