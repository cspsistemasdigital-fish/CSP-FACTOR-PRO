import { useNavigate } from 'react-router-dom'
import StatusBadge from '../ui/StatusBadge'
import EmptyState from '../ui/EmptyState'
import { formatBRL, formatDate } from '../../utils/format'

function docRoute(item, fallbackKind) {
  const kind = item.kind || fallbackKind
  return kind === 'BOLETO' ? `/boletos/${item.id}` : `/cheques/${item.id}`
}

function kindLabel(kind) {
  return kind === 'BOLETO' ? 'Boleto' : 'Cheque'
}

export default function DocumentsTable({
  items = [],
  kind,
  mixed = false,
  compact = false,
  emptyTitle = 'Nenhum documento encontrado',
  emptyMessage = 'Ajuste os filtros ou cadastre um novo documento.',
  onOpen,
}) {
  const navigate = useNavigate()

  const open = (item) => {
    if (onOpen) onOpen(item)
    else navigate(docRoute(item, kind))
  }

  if (!items.length) {
    return <EmptyState icon="bi-folder2-open" title={emptyTitle} message={emptyMessage} />
  }

  return (
    <>
      <div className="table-responsive fp-table-wrap d-none d-lg-block">
        <table className="table fp-table align-middle">
          <thead>
            <tr>
              <th>Código</th>
              {mixed && <th>Tipo</th>}
              <th>Cliente</th>
              {!compact && <th>Referência</th>}
              <th>Vencimento</th>
              <th className="text-end">Nominal</th>
              <th className="text-end">Líquido</th>
              <th>Status</th>
              <th aria-label="Abrir" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const itemKind = item.kind || kind
              return (
                <tr
                  key={`${itemKind}-${item.id}`}
                  className="doc-row"
                  onClick={() => open(item)}
                  tabIndex={0}
                  role="link"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      open(item)
                    }
                  }}
                >
                  <td>
                    <span className="doc-code">
                      <i className={`bi ${itemKind === 'BOLETO' ? 'bi-receipt' : 'bi-journal-check'}`} />
                      {item.code}
                    </span>
                  </td>
                  {mixed && <td><span className="type-chip">{kindLabel(itemKind)}</span></td>}
                  <td>
                    <span className="cell-strong">{item.client?.name || '—'}</span>
                    {item.client?.code && <span className="cell-sub">{item.client.code}</span>}
                  </td>
                  {!compact && (
                    <td>
                      <span className="cell-strong">
                        {itemKind === 'BOLETO' ? item.identifier || '—' : item.number || '—'}
                      </span>
                      {item.bank && <span className="cell-sub">{item.bank}</span>}
                    </td>
                  )}
                  <td>
                    <span className={item.is_overdue ? 'date-overdue' : ''}>{formatDate(item.due_date)}</span>
                  </td>
                  <td className="text-end money-cell">{formatBRL(item.nominal_amount)}</td>
                  <td className="text-end money-cell">
                    {formatBRL(item.net_amount)}
                    {item.has_divergence && (
                      <i
                        className="bi bi-exclamation-diamond-fill divergence-flag"
                        title="Valores divergentes: nominal menos descontos/despesas difere do líquido informado."
                      />
                    )}
                  </td>
                  <td>
                    <StatusBadge status={item.status} overdue={item.is_overdue} size="sm" />
                  </td>
                  <td className="text-end">
                    {item.has_attachment && (
                      <i className="bi bi-paperclip attachment-flag" title="Possui anexo" />
                    )}
                    <i className="bi bi-chevron-right row-chevron" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="doc-cards d-lg-none">
        {items.map((item) => {
          const itemKind = item.kind || kind
          return (
            <button
              type="button"
              key={`${itemKind}-${item.id}`}
              className="doc-card"
              onClick={() => open(item)}
            >
              <div className="doc-card-head">
                <span className="doc-code">
                  <i className={`bi ${itemKind === 'BOLETO' ? 'bi-receipt' : 'bi-journal-check'}`} />
                  {item.code}
                </span>
                <StatusBadge status={item.status} overdue={item.is_overdue} size="sm" />
              </div>
              <div className="doc-card-client">
                <strong>{item.client?.name || '—'}</strong>
                <small>
                  {mixed ? `${kindLabel(itemKind)} · ` : ''}
                  Vence em {formatDate(item.due_date)}
                </small>
              </div>
              <div className="doc-card-values">
                <span>
                  Nominal
                  <strong>{formatBRL(item.nominal_amount)}</strong>
                </span>
                <span>
                  Líquido
                  <strong>
                    {formatBRL(item.net_amount)}
                    {item.has_divergence && (
                      <i className="bi bi-exclamation-diamond-fill divergence-flag" title="Valores divergentes" />
                    )}
                  </strong>
                </span>
              </div>
              {(item.has_attachment || item.has_divergence) && (
                <div className="doc-card-flags">
                  {item.has_attachment && (
                    <span><i className="bi bi-paperclip" /> Anexo</span>
                  )}
                  {item.has_divergence && (
                    <span className="text-warning"><i className="bi bi-exclamation-diamond" /> Divergência</span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}
