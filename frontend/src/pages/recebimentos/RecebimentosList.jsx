import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { receiptsApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import PageHeader from '../../components/ui/PageHeader'
import SummaryTile from '../../components/ui/SummaryTile'
import Pagination from '../../components/ui/Pagination'
import ExportXlsxButton from '../../components/ui/ExportXlsxButton'
import EmptyState from '../../components/ui/EmptyState'
import ClientSelect from '../../components/form/ClientSelect'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { formatBRL, formatDate, formatNumber } from '../../utils/format'

const SORTS = [
  { value: 'receipt_date', label: 'Data do recebimento' },
  { value: 'code', label: 'Código' },
  { value: 'amount', label: 'Valor recebido' },
  { value: 'created_at', label: 'Criado em' },
]

const KIND_OPTIONS = [
  { value: '', label: 'Todos os títulos' },
  { value: 'CHEQUE', label: 'Cheques' },
  { value: 'BOLETO', label: 'Boletos' },
]

function docRoute(receipt) {
  const kind = receipt.document_kind
  const id = receipt.document_id
  if (!id) return null
  return kind === 'BOLETO' ? `/boletos/${id}` : `/cheques/${id}`
}

export default function RecebimentosList() {
  const { canWrite } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const get = (name) => params.get(name) || ''
  const page = Number(get('page') || 1)
  const search = get('search')
  const kind = get('document_kind')
  const clientId = get('client_id')
  const sort = get('sort') || 'receipt_date'
  const order = get('order') || 'desc'
  const [searchInput, setSearchInput] = useState(search)
  const debouncedSearch = useDebouncedValue(searchInput, 350)
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(get('date_from') || get('date_to')))

  const [items, setItems] = useState([])
  const [meta, setMeta] = useState(null)
  const [totals, setTotals] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setSearchInput(search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => {
    if (debouncedSearch === search) return
    const next = new URLSearchParams(params)
    if (debouncedSearch) next.set('search', debouncedSearch)
    else next.delete('search')
    next.delete('page')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const setParam = (name, value) => {
    const next = new URLSearchParams(params)
    if (value === '' || value === null || value === undefined) next.delete(name)
    else next.set(name, String(value))
    if (name !== 'page') next.delete('page')
    setParams(next)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const requestParams = { page, per_page: 20, sort, order }
      ;['search', 'document_kind', 'client_id', 'date_from', 'date_to'].forEach((key) => {
        if (get(key)) requestParams[key] = get(key)
      })
      const { data } = await receiptsApi.list(requestParams)
      setItems(data.items || [])
      setMeta(data.meta)
      setTotals(data.totals || {})
    } catch (requestError) {
      setError(apiError(requestError).message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, sort, order, page])

  useEffect(() => {
    load()
  }, [load])

  const clearFilters = () => {
    setSearchInput('')
    setParams(new URLSearchParams())
  }

  const activeAdvanced = ['date_from', 'date_to'].filter((key) => get(key)).length
  const hasFilters = Boolean(search || kind || clientId || activeAdvanced)
  const selectedClientId = clientId ? Number(clientId) : null

  const exportParams = { sort, order }
  ;['search', 'document_kind', 'client_id', 'date_from', 'date_to'].forEach((key) => {
    if (get(key)) exportParams[key] = get(key)
  })

  return (
    <div className="page">
      <PageHeader
        title="Recebimentos"
        subtitle="Cada recebimento é uma baixa manual: você informa a data e o valor recebido. O sistema nunca calcula encargos — apenas compara com o saldo em aberto."
        icon="bi-cash-coin"
      >
        <ExportXlsxButton resource="receipts" params={exportParams} />
        <button type="button" className="btn btn-light" onClick={load} disabled={loading}>
          <i className={`bi ${loading ? 'arrow-repeat spin' : 'arrow-clockwise'}`} /> Atualizar
        </button>
        {canWrite ? (
          <Link to="/recebimentos/novo" className="btn btn-primary">
            <i className="bi bi-plus-lg" /> Novo recebimento
          </Link>
        ) : (
          <span className="btn btn-light disabled" title="Perfil consultor não pode registrar recebimentos">
            <i className="bi bi-eye" /> Somente leitura
          </span>
        )}
      </PageHeader>

      <div className="stats-strip">
        <SummaryTile
          label="Recebimentos encontrados"
          value={formatNumber(totals.receipts || 0)}
          icon="bi-cash-coin"
          hint="Conforme os filtros aplicados"
        />
        <SummaryTile
          label="Total recebido"
          value={formatBRL(totals.amount || 0)}
          icon="bi-cash-stack"
          tone="green"
          hint="Soma dos valores informados"
        />
      </div>

      <div className="filter-bar">
        <div className="filter-fields">
          <div className="filter-search">
            <i className="bi bi-search" />
            <input
              type="search"
              className="form-control fp-input"
              placeholder="Buscar por código, cliente ou observação…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Buscar recebimentos"
            />
          </div>
          <label className="filter-select">
            <span>Tipo</span>
            <select
              className="form-select fp-input"
              value={kind}
              onChange={(event) => setParam('document_kind', event.target.value)}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-client">
            <ClientSelect
              label="Cliente"
              value={selectedClientId}
              onChange={(client) => setParam('client_id', client?.id || '')}
              required={false}
              includeInactive
              placeholder="Todos os clientes"
            />
          </div>
          <button
            type="button"
            className={`btn ${advancedOpen ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <i className="bi bi-sliders" /> Filtros
            {activeAdvanced > 0 && <span className="filter-count">{activeAdvanced}</span>}
          </button>
          {hasFilters && (
            <button type="button" className="btn btn-link" onClick={clearFilters}>
              Limpar
            </button>
          )}
        </div>

        {advancedOpen && (
          <div className="advanced-filters">
            <label className="filter-field">
              <span>Recebido de</span>
              <input
                type="date"
                className="form-control fp-input"
                value={get('date_from')}
                onChange={(event) => setParam('date_from', event.target.value)}
              />
            </label>
            <label className="filter-field">
              <span>Recebido até</span>
              <input
                type="date"
                className="form-control fp-input"
                value={get('date_to')}
                onChange={(event) => setParam('date_to', event.target.value)}
              />
            </label>
            <label className="filter-field">
              <span>Ordenar por</span>
              <select className="form-select fp-input" value={sort} onChange={(event) => setParam('sort', event.target.value)}>
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Ordem</span>
              <button
                type="button"
                className="btn btn-light w-100 justify-content-start"
                onClick={() => setParam('order', order === 'desc' ? 'asc' : 'desc')}
              >
                <i className={`bi bi-sort-${order === 'desc' ? 'down' : 'up'}-alt`} />
                {order === 'desc' ? 'Decrescente' : 'Crescente'}
              </button>
            </label>
          </div>
        )}
      </div>

      {loading && !items.length ? (
        <LoadingBlock label="Carregando recebimentos…" />
      ) : error ? (
        <ErrorBlock message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <div className="fp-panel">
          <EmptyState
            icon="bi-cash-coin"
            title={hasFilters ? 'Nenhum recebimento encontrado' : 'Nenhum recebimento registrado'}
            message={
              hasFilters
                ? 'Ajuste os filtros para ampliar a busca.'
                : 'Registre a primeira baixa de um cheque ou boleto em aberto.'
            }
          >
            {hasFilters ? (
              <button type="button" className="btn btn-light" onClick={clearFilters}>
                <i className="bi bi-x-circle" /> Limpar filtros
              </button>
            ) : (
              canWrite && (
                <Link to="/recebimentos/novo" className="btn btn-primary">
                  <i className="bi bi-plus-lg" /> Novo recebimento
                </Link>
              )
            )}
          </EmptyState>
        </div>
      ) : (
        <div className={`fp-panel table-panel ${loading ? 'is-refreshing' : ''}`}>
          <div className="table-responsive fp-table-wrap d-none d-lg-block">
            <table className="table fp-table align-middle">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Título</th>
                  <th>Cliente</th>
                  <th>Data</th>
                  <th className="text-end">Valor recebido</th>
                  <th className="text-center">Anexo</th>
                  <th aria-label="Abrir" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="doc-row"
                    onClick={() => navigate(`/recebimentos/${item.id}`)}
                    tabIndex={0}
                    role="link"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        navigate(`/recebimentos/${item.id}`)
                      }
                    }}
                  >
                    <td>
                      <span className="doc-code">
                        <i className="bi bi-cash-coin" />
                        {item.code}
                      </span>
                    </td>
                    <td>
                      <span className="type-chip">
                        <i className={`bi ${item.document_kind === 'BOLETO' ? 'bi-receipt' : 'bi-journal-check'}`} />{' '}
                        {item.document_label}
                      </span>
                      {item.document?.code && <span className="cell-sub">{item.document.code}</span>}
                    </td>
                    <td>
                      <span className="cell-strong">{item.client?.name || '—'}</span>
                      {item.client?.code && <span className="cell-sub">{item.client.code}</span>}
                    </td>
                    <td>{formatDate(item.receipt_date)}</td>
                    <td className="text-end money-cell">{formatBRL(item.amount)}</td>
                    <td className="text-center">
                      {item.has_attachment ? (
                        <i className="bi bi-paperclip text-muted" title="Possui anexo" />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-end">
                      <i className="bi bi-chevron-right row-chevron" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="doc-cards d-lg-none">
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                className="doc-card"
                onClick={() => navigate(`/recebimentos/${item.id}`)}
              >
                <div className="doc-card-head">
                  <span className="doc-code">
                    <i className="bi bi-cash-coin" />
                    {item.code}
                  </span>
                  <span className="type-chip">{item.document_label}</span>
                </div>
                <div className="doc-card-client">
                  <strong>{item.client?.name || '—'}</strong>
                  <small>
                    {item.document?.code ? `${item.document.code} · ` : ''}
                    {formatDate(item.receipt_date)}
                  </small>
                </div>
                <div className="doc-card-values">
                  <span>
                    Valor recebido
                    <strong>{formatBRL(item.amount)}</strong>
                  </span>
                </div>
              </button>
            ))}
          </div>

          <Pagination meta={meta} onChange={(nextPage) => setParam('page', String(nextPage))} />
        </div>
      )}
    </div>
  )
}
