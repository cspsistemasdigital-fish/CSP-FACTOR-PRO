import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { loansApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import PageHeader from '../../components/ui/PageHeader'
import SummaryTile from '../../components/ui/SummaryTile'
import Pagination from '../../components/ui/Pagination'
import ExportXlsxButton from '../../components/ui/ExportXlsxButton'
import DataVisibility from '../../components/ui/DataVisibility'
import EmptyState from '../../components/ui/EmptyState'
import StatusBadge from '../../components/ui/StatusBadge'
import ClientSelect from '../../components/form/ClientSelect'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { formatBRL, formatDate, formatNumber } from '../../utils/format'

const SORTS = [
  { value: 'loan_date', label: 'Data do empréstimo' },
  { value: 'code', label: 'Código' },
  { value: 'status', label: 'Situação' },
  { value: 'loan_amount', label: 'Valor emprestado' },
  { value: 'created_at', label: 'Criado em' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'Todas as situações' },
  { value: 'ABERTA', label: 'Aberta' },
  { value: 'QUITADA', label: 'Quitada' },
  { value: 'CANCELADA', label: 'Cancelada' },
]

export default function EmprestimosList() {
  const { canWrite } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const get = (name) => params.get(name) || ''

  const page = Number(get('page') || 1)
  const search = get('search')
  const status = get('status')
  const clientId = get('client_id')
  const sort = get('sort') || 'loan_date'
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
      const { data } = await loansApi.list(requestParams)
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

  const advancedCount = ['date_from', 'date_to'].filter((key) => get(key)).length
  const hasFilters = Boolean(search || status || clientId || advancedCount)

  const exportParams = { sort, order }
  ;['search', 'status', 'client_id', 'date_from', 'date_to'].forEach((key) => {
    if (get(key)) exportParams[key] = get(key)
  })

  return (
    <div className="page">
      <PageHeader
        title="Empréstimos"
        subtitle="Valores informados manualmente, parcelas editáveis e limite do cliente atualizado pelas parcelas em aberto. Nada é recalculado pelo sistema."
        icon="bi-cash-coin"
      >
        <ExportXlsxButton resource="loans" params={exportParams} />
        <button type="button" className="btn btn-light" onClick={load} disabled={loading}>
          <i className={`bi ${loading ? 'arrow-repeat spin' : 'arrow-clockwise'}`} /> Atualizar
        </button>
        <Link to="/emprestimos/relatorio" className="btn btn-outline-primary">
          <i className="bi bi-graph-up-arrow" /> Relatório
        </Link>
        {canWrite ? (
          <Link to="/emprestimos/novo" className="btn btn-primary">
            <i className="bi bi-plus-lg" /> Novo empréstimo
          </Link>
        ) : (
          <span className="btn btn-light disabled" title="Perfil consultor não pode registrar empréstimos">
            <i className="bi bi-eye" /> Somente leitura
          </span>
        )}
      </PageHeader>

      <div className="stats-strip">
        <SummaryTile
          label="Empréstimos encontrados"
          value={formatNumber(totals.loans || 0)}
          icon="bi-cash-coin"
          hint="Conforme os filtros aplicados"
        />
        <SummaryTile
          label="Valor emprestado"
          value={formatBRL(totals.loan_amount || 0)}
          icon="bi-cash-stack"
          tone="petroleum"
          hint="Soma exata dos valores informados"
        />
        <SummaryTile
          label="Recebido pelo cliente"
          value={formatBRL(totals.received_amount || 0)}
          icon="bi-wallet2"
          tone="green"
          hint="Valor repassado informado"
        />
        <SummaryTile
          label="Lucro informado"
          value={formatBRL(totals.profit_amount || 0)}
          icon="bi-graph-up"
          tone="green"
          hint="Nenhum cálculo automático"
        />
        <SummaryTile
          label="Saldo em parcelas"
          value={formatBRL(totals.open_amount || 0)}
          icon="bi-hourglass-split"
          tone="warning"
          hint="Entra na exposição do cliente"
        />
      </div>

      <div className="filter-bar">
        <div className="filter-fields">
          <div className="filter-search">
            <i className="bi bi-search" />
            <input
              type="search"
              className="form-control fp-input"
              placeholder="Buscar por código, cliente, CPF/CNPJ ou observações…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Buscar empréstimos"
            />
          </div>
          <label className="filter-select">
            <span>Situação</span>
            <select className="form-select fp-input" value={status} onChange={(event) => setParam('status', event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-client">
            <ClientSelect
              label="Cliente"
              value={clientId ? Number(clientId) : null}
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
            {advancedCount > 0 && <span className="filter-count">{advancedCount}</span>}
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
              <span>Empréstimo de</span>
              <input
                type="date"
                className="form-control fp-input"
                value={get('date_from')}
                onChange={(event) => setParam('date_from', event.target.value)}
              />
            </label>
            <label className="filter-field">
              <span>Empréstimo até</span>
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
        <LoadingBlock label="Carregando empréstimos…" />
      ) : error ? (
        <ErrorBlock message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <div className="fp-panel">
          <EmptyState
            icon="bi-cash-coin"
            title={hasFilters ? 'Nenhum empréstimo encontrado' : 'Nenhum empréstimo registrado'}
            message={
              hasFilters
                ? 'Ajuste os filtros para ampliar a busca.'
                : 'Registre o primeiro empréstimo informando os valores e gerando as parcelas.'
            }
          >
            {hasFilters ? (
              <button type="button" className="btn btn-light" onClick={clearFilters}>
                <i className="bi bi-x-circle" /> Limpar filtros
              </button>
            ) : (
              canWrite && (
                <Link to="/emprestimos/novo" className="btn btn-primary">
                  <i className="bi bi-plus-lg" /> Novo empréstimo
                </Link>
              )
            )}
          </EmptyState>
        </div>
      ) : (
        <DataVisibility id="loans-saved-data" label="empréstimos">
          <div className={`fp-panel table-panel ${loading ? 'is-refreshing' : ''}`}>
            <div className="table-responsive fp-table-wrap d-none d-lg-block">
            <table className="table fp-table align-middle">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Cliente</th>
                  <th>Data</th>
                  <th className="text-center">Parcelas</th>
                  <th className="text-end">Emprestado</th>
                  <th className="text-end">Recebido</th>
                  <th className="text-end">Lucro</th>
                  <th>Situação</th>
                  <th aria-label="Abrir" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="doc-row"
                    onClick={() => navigate(`/emprestimos/${item.id}`)}
                    tabIndex={0}
                    role="link"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        navigate(`/emprestimos/${item.id}`)
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
                      <span className="cell-strong">{item.client?.name || '—'}</span>
                      {item.client?.code && <span className="cell-sub">{item.client.code}</span>}
                    </td>
                    <td className="nowrap">{formatDate(item.loan_date)}</td>
                    <td className="text-center">
                      <span className="type-chip" title={`${item.totals?.open_amount || '0.00'} em aberto`}>
                        {item.totals?.installments || 0} parcela(s)
                      </span>
                      {Number(item.totals?.overdue_installments) > 0 && (
                        <span className="cell-sub text-danger">
                          <i className="bi bi-exclamation-triangle-fill" /> {item.totals.overdue_installments} vencida(s)
                        </span>
                      )}
                    </td>
                    <td className="text-end money-cell">{formatBRL(item.loan_amount)}</td>
                    <td className="text-end money-cell">{formatBRL(item.received_amount)}</td>
                    <td className="text-end money-cell">{formatBRL(item.profit_amount)}</td>
                    <td>
                      <StatusBadge status={item.status} size="sm" />
                      {item.has_divergence && (
                        <span className="cell-sub text-warning" title="Divergência informativa entre os valores">
                          <i className="bi bi-exclamation-diamond-fill" /> divergência
                        </span>
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
              <button type="button" key={item.id} className="doc-card" onClick={() => navigate(`/emprestimos/${item.id}`)}>
                <div className="doc-card-head">
                  <span className="doc-code">
                    <i className="bi bi-cash-coin" />
                    {item.code}
                  </span>
                  <StatusBadge status={item.status} size="sm" />
                </div>
                <div className="doc-card-client">
                  <strong>{item.client?.name || '—'}</strong>
                  <small>
                    {item.totals?.installments || 0} parcela(s) · {formatDate(item.loan_date)}
                  </small>
                </div>
                <div className="loan-card-values">
                  <span>
                    Emprestado
                    <strong>{formatBRL(item.loan_amount)}</strong>
                  </span>
                  <span>
                    Recebido
                    <strong>{formatBRL(item.received_amount)}</strong>
                  </span>
                  <span>
                    Lucro
                    <strong>{formatBRL(item.profit_amount)}</strong>
                  </span>
                </div>
              </button>
            ))}
          </div>

            <Pagination meta={meta} onChange={(nextPage) => setParam('page', String(nextPage))} />
          </div>
        </DataVisibility>
      )}
    </div>
  )
}
