import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { operationsApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import PageHeader from '../../components/ui/PageHeader'
import SummaryTile from '../../components/ui/SummaryTile'
import Pagination from '../../components/ui/Pagination'
import EmptyState from '../../components/ui/EmptyState'
import StatusBadge from '../../components/ui/StatusBadge'
import ClientSelect from '../../components/form/ClientSelect'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { formatBRL, formatDate, formatNumber } from '../../utils/format'

const SORTS = [
  { value: 'operation_date', label: 'Data da operação' },
  { value: 'code', label: 'Código' },
  { value: 'status', label: 'Situação' },
  { value: 'created_at', label: 'Criado em' },
]

export default function OperacoesList() {
  const { canWrite } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const get = (name) => params.get(name) || ''
  const page = Number(get('page') || 1)
  const search = get('search')
  const status = get('status')
  const clientId = get('client_id')
  const sort = get('sort') || 'operation_date'
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
      ;['search', 'status', 'client_id', 'date_from', 'date_to'].forEach((key) => {
        if (get(key)) requestParams[key] = get(key)
      })
      const { data } = await operationsApi.list(requestParams)
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
  const hasFilters = Boolean(search || status || clientId || activeAdvanced)
  const selectedClientId = clientId ? Number(clientId) : null

  return (
    <div className="page">
      <PageHeader
        title="Operações"
        subtitle="Cada operação reúne cheques e boletos de um mesmo cliente. Os totais são sempre derivados dos documentos vinculados — nunca recalculados."
        icon="bi-arrow-left-right"
      >
        <button type="button" className="btn btn-light" onClick={load} disabled={loading}>
          <i className={`bi ${loading ? 'arrow-repeat spin' : 'arrow-clockwise'}`} /> Atualizar
        </button>
        {canWrite ? (
          <Link to="/operacoes/novo" className="btn btn-primary">
            <i className="bi bi-plus-lg" /> Nova operação
          </Link>
        ) : (
          <span className="btn btn-light disabled" title="Perfil consultor não pode registrar operações">
            <i className="bi bi-eye" /> Somente leitura
          </span>
        )}
      </PageHeader>

      <div className="stats-strip">
        <SummaryTile
          label="Operações encontradas"
          value={formatNumber(totals.operations || 0)}
          icon="bi-arrow-left-right"
          hint="Conforme os filtros aplicados"
        />
        <SummaryTile
          label="Documentos vinculados"
          value={formatNumber(totals.documents || 0)}
          icon="bi-collection"
          tone="light"
          hint="Cheques e boletos agrupados"
        />
        <SummaryTile
          label="Valor nominal"
          value={formatBRL(totals.nominal || 0)}
          icon="bi-cash-stack"
          tone="petroleum"
          hint="Soma dos valores informados"
        />
        <SummaryTile
          label="Valor líquido"
          value={formatBRL(totals.net || 0)}
          icon="bi-wallet2"
          tone="green"
          hint="Soma dos líquidos informados"
        />
        <SummaryTile
          label="Limite aplicado"
          value={formatBRL(totals.applied_limit || 0)}
          icon="bi-sliders"
          tone="warning"
          hint="Soma dos limites informados"
        />
      </div>

      <div className="filter-bar">
        <div className="filter-fields">
          <div className="filter-search">
            <i className="bi bi-search" />
            <input
              type="search"
              className="form-control fp-input"
              placeholder="Buscar por código, descrição ou cliente…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Buscar operações"
            />
          </div>
          <label className="filter-select">
            <span>Situação</span>
            <select className="form-select fp-input" value={status} onChange={(event) => setParam('status', event.target.value)}>
              <option value="">Todas</option>
              <option value="ABERTA">Aberta</option>
              <option value="FECHADA">Fechada</option>
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
              <span>Operação de</span>
              <input
                type="date"
                className="form-control fp-input"
                value={get('date_from')}
                onChange={(event) => setParam('date_from', event.target.value)}
              />
            </label>
            <label className="filter-field">
              <span>Operação até</span>
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
        <LoadingBlock label="Carregando operações…" />
      ) : error ? (
        <ErrorBlock message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <div className="fp-panel">
          <EmptyState
            icon="bi-arrow-left-right"
            title={hasFilters ? 'Nenhuma operação encontrada' : 'Nenhuma operação registrada'}
            message={
              hasFilters
                ? 'Ajuste os filtros para ampliar a busca.'
                : 'Registre a primeira operação reunindo cheques e/ou boletos de um cliente.'
            }
          >
            {hasFilters ? (
              <button type="button" className="btn btn-light" onClick={clearFilters}>
                <i className="bi bi-x-circle" /> Limpar filtros
              </button>
            ) : (
              canWrite && (
                <Link to="/operacoes/novo" className="btn btn-primary">
                  <i className="bi bi-plus-lg" /> Nova operação
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
                  <th>Cliente</th>
                  <th>Data</th>
                  <th className="text-center">Documentos</th>
                  <th className="text-end">Nominal</th>
                  <th className="text-end">Líquido</th>
                  <th>Situação</th>
                  <th aria-label="Abrir" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="doc-row"
                    onClick={() => navigate(`/operacoes/${item.id}`)}
                    tabIndex={0}
                    role="link"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        navigate(`/operacoes/${item.id}`)
                      }
                    }}
                  >
                    <td>
                      <span className="doc-code">
                        <i className="bi bi-arrow-left-right" />
                        {item.code}
                      </span>
                    </td>
                    <td>
                      <span className="cell-strong">{item.client?.name || '—'}</span>
                      {item.client?.code && <span className="cell-sub">{item.client.code}</span>}
                    </td>
                    <td>{formatDate(item.operation_date)}</td>
                    <td className="text-center">
                      <span className="type-chip">{item.documents_count} doc.</span>
                    </td>
                    <td className="text-end money-cell">{formatBRL(item.totals?.nominal)}</td>
                    <td className="text-end money-cell">{formatBRL(item.totals?.net)}</td>
                    <td>
                      <StatusBadge status={item.status} size="sm" />
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
              <button type="button" key={item.id} className="doc-card" onClick={() => navigate(`/operacoes/${item.id}`)}>
                <div className="doc-card-head">
                  <span className="doc-code">
                    <i className="bi bi-arrow-left-right" />
                    {item.code}
                  </span>
                  <StatusBadge status={item.status} size="sm" />
                </div>
                <div className="doc-card-client">
                  <strong>{item.client?.name || '—'}</strong>
                  <small>
                    {item.documents_count} documento(s) · {formatDate(item.operation_date)}
                  </small>
                </div>
                <div className="doc-card-values">
                  <span>
                    Nominal
                    <strong>{formatBRL(item.totals?.nominal)}</strong>
                  </span>
                  <span>
                    Líquido
                    <strong>{formatBRL(item.totals?.net)}</strong>
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
