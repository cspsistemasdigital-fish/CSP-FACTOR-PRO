import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import PageHeader from '../../components/ui/PageHeader'
import SummaryTile from '../../components/ui/SummaryTile'
import Pagination from '../../components/ui/Pagination'
import DocumentsTable from '../documents/DocumentsTable'
import EmptyState from '../ui/EmptyState'
import ClientSelect from '../form/ClientSelect'
import { ErrorBlock, LoadingBlock } from '../ui/Feedback'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { formatBRL, formatNumber } from '../../utils/format'

const SORTS = [
  { value: 'operation_date', label: 'Data da operação' },
  { value: 'due_date', label: 'Vencimento' },
  { value: 'code', label: 'Código' },
  { value: 'nominal_amount', label: 'Valor nominal' },
  { value: 'net_amount', label: 'Valor líquido' },
  { value: 'created_at', label: 'Criado em' },
]

export default function DocumentsListPage({ config }) {
  const { api, basePath, kind, title, subtitle, icon, nominalLabel, newLabel } = config
  const { canWrite } = useAuth()
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
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(get('bank') || get('date_from') || get('date_to') || get('due_from') || get('due_to') || get('overdue') || get('divergent')),
  )

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
    if (value === '' || value === null || value === undefined || value === false) next.delete(name)
    else next.set(name, String(value))
    if (name !== 'page') next.delete('page')
    setParams(next)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const requestParams = { page, per_page: 20, sort, order }
      ;['search', 'status', 'client_id', 'bank', 'date_from', 'date_to', 'due_from', 'due_to'].forEach((key) => {
        if (get(key)) requestParams[key] = get(key)
      })
      if (get('overdue') === '1') requestParams.overdue = 1
      if (get('divergent') === '1') requestParams.divergent = 1
      const { data } = await api.list(requestParams)
      setItems(data.items || [])
      setMeta(data.meta)
      setTotals(data.totals || {})
    } catch (requestError) {
      setError(apiError(requestError).message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, api, sort, order, page])

  useEffect(() => {
    load()
  }, [load])

  const clearFilters = () => {
    setSearchInput('')
    setParams(new URLSearchParams())
  }

  const activeAdvanced = ['bank', 'date_from', 'date_to', 'due_from', 'due_to', 'overdue', 'divergent'].filter((key) => get(key)).length
  const hasFilters = Boolean(search || status || clientId || activeAdvanced)
  const selectedClientId = clientId ? Number(clientId) : null

  return (
    <div className="page">
      <PageHeader title={title} subtitle={subtitle} icon={icon}>
        <button type="button" className="btn btn-light" onClick={load} disabled={loading}>
          <i className={`bi ${loading ? 'arrow-repeat spin' : 'arrow-clockwise'}`} /> Atualizar
        </button>
        {canWrite ? (
          <Link to={`${basePath}/novo`} className="btn btn-primary">
            <i className="bi bi-plus-lg" /> {newLabel}
          </Link>
        ) : (
          <span className="btn btn-light disabled" title="Perfil consultor não pode cadastrar documentos">
            <i className="bi bi-eye" /> Somente leitura
          </span>
        )}
      </PageHeader>

      <div className="stats-strip">
        <SummaryTile
          label="Documentos encontrados"
          value={formatNumber(totals.count || 0)}
          icon="bi-collection"
          hint="Conforme os filtros aplicados"
        />
        <SummaryTile
          label={nominalLabel}
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
          label="Em aberto"
          value={formatBRL(totals.open || 0)}
          icon="bi-hourglass-split"
          tone="warning"
          hint="Status em aberto ou devolvido"
        />
        <SummaryTile
          label="Nominal − líquido"
          value={formatBRL(totals.gains || 0)}
          icon="bi-calculator"
          tone="light"
          hint="Diferença derivada; não é cálculo de encargos"
        />
      </div>

      <div className="filter-bar">
        <div className="filter-fields">
          <div className="filter-search">
            <i className="bi bi-search" />
            <input
              type="search"
              className="form-control fp-input"
              placeholder="Buscar por código, cliente, banco, documento…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Buscar documentos"
            />
          </div>
          <label className="filter-select">
            <span>Status</span>
            <select className="form-select fp-input" value={status} onChange={(event) => setParam('status', event.target.value)}>
              <option value="">Todos</option>
              <option value="EM_ABERTO">Em aberto</option>
              <option value="VENCIDO">Vencidos</option>
              <option value="LIQUIDADO">Liquidado</option>
              <option value="DEVOLVIDO">Devolvido</option>
              <option value="CANCELADO">Cancelado</option>
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
              <span>Banco</span>
              <input
                type="text"
                className="form-control fp-input"
                value={get('bank')}
                placeholder="Ex.: Banco do Brasil"
                onChange={(event) => setParam('bank', event.target.value)}
              />
            </label>
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
              <span>Vence de</span>
              <input
                type="date"
                className="form-control fp-input"
                value={get('due_from')}
                onChange={(event) => setParam('due_from', event.target.value)}
              />
            </label>
            <label className="filter-field">
              <span>Vence até</span>
              <input
                type="date"
                className="form-control fp-input"
                value={get('due_to')}
                onChange={(event) => setParam('due_to', event.target.value)}
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
            <label className="filter-check">
              <input
                type="checkbox"
                className="form-check-input"
                checked={get('overdue') === '1'}
                onChange={(event) => setParam('overdue', event.target.checked ? '1' : '')}
              />
              Somente vencidos
            </label>
            <label className="filter-check">
              <input
                type="checkbox"
                className="form-check-input"
                checked={get('divergent') === '1'}
                onChange={(event) => setParam('divergent', event.target.checked ? '1' : '')}
              />
              Somente com divergência
            </label>
          </div>
        )}
      </div>

      {loading && !items.length ? (
        <LoadingBlock label="Carregando documentos…" />
      ) : error ? (
        <ErrorBlock message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <div className="fp-panel">
          <EmptyState
            icon="bi-folder2-open"
            title={hasFilters ? 'Nenhum documento encontrado' : `Nenhum ${title.toLowerCase().replace(/s$/, '')} cadastrado`}
            message={
              hasFilters
                ? 'Ajuste os filtros para ampliar a busca.'
                : `Cadastre o primeiro ${title.toLowerCase().replace(/s$/, '')} para acompanhar a carteira.`
            }
          >
            {hasFilters ? (
              <button type="button" className="btn btn-light" onClick={clearFilters}>
                <i className="bi bi-x-circle" /> Limpar filtros
              </button>
            ) : (
              canWrite && (
                <Link to={`${basePath}/novo`} className="btn btn-primary">
                  <i className="bi bi-plus-lg" /> {newLabel}
                </Link>
              )
            )}
          </EmptyState>
        </div>
      ) : (
        <div className={`fp-panel table-panel ${loading ? 'is-refreshing' : ''}`}>
          <DocumentsTable items={items} kind={kind} />
          <Pagination meta={meta} onChange={(nextPage) => setParam('page', String(nextPage))} />
        </div>
      )}
    </div>
  )
}
