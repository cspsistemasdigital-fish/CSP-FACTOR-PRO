import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { clientsApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import PageHeader from '../../components/ui/PageHeader'
import SummaryTile from '../../components/ui/SummaryTile'
import StatusBadge from '../../components/ui/StatusBadge'
import Pagination from '../../components/ui/Pagination'
import EmptyState from '../../components/ui/EmptyState'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { formatBRL, formatDocument, formatNumber, formatPhone } from '../../utils/format'

const SORT_OPTIONS = [
  { value: 'name', label: 'Nome' },
  { value: 'code', label: 'Código' },
  { value: 'registered_at', label: 'Data de cadastro' },
  { value: 'operational_limit', label: 'Limite operacional' },
  { value: 'created_at', label: 'Criado em' },
]

export default function ClientsList() {
  const { canWrite } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const page = Number(params.get('page') || 1)
  const search = params.get('search') || ''
  const status = params.get('status') || ''
  const blocked = params.get('blocked') || ''
  const sort = params.get('sort') || 'name'
  const order = params.get('order') || 'asc'

  const [searchInput, setSearchInput] = useState(search)
  const debouncedSearch = useDebouncedValue(searchInput, 350)
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
    if (value) next.set(name, value)
    else next.delete(name)
    if (name !== 'page') next.delete('page')
    setParams(next)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const requestParams = { page, per_page: 20, sort, order }
      if (search) requestParams.search = search
      if (status) requestParams.status = status
      if (blocked) requestParams.blocked = blocked
      const { data } = await clientsApi.list(requestParams)
      setItems(data.items || [])
      setMeta(data.meta)
      setTotals(data.totals || {})
    } catch (requestError) {
      const parsed = apiError(requestError)
      setError(parsed.message)
    } finally {
      setLoading(false)
    }
  }, [page, search, status, blocked, sort, order])

  useEffect(() => {
    load()
  }, [load])

  const clearFilters = () => {
    setSearchInput('')
    setParams(new URLSearchParams())
  }

  const hasFilters = Boolean(search || status || blocked)

  return (
    <div className="page">
      <PageHeader
        title="Clientes"
        subtitle="Cadastro de sacados e emitentes com limite operacional e exposição calculada a partir dos documentos em aberto."
        icon="bi-people-fill"
      >
        {canWrite ? (
          <Link to="/clientes/novo" className="btn btn-primary">
            <i className="bi bi-person-plus" /> Novo cliente
          </Link>
        ) : (
          <span className="btn btn-light disabled" title="Perfil consultor não pode cadastrar clientes">
            <i className="bi bi-eye" /> Somente leitura
          </span>
        )}
      </PageHeader>

      <div className="stats-strip">
        <SummaryTile
          label="Clientes na base"
          value={formatNumber(totals.clients ?? meta?.total ?? 0)}
          icon="bi-people"
          hint="Registros não excluídos"
        />
        <SummaryTile
          label="Ativos"
          value={formatNumber(totals.active || 0)}
          icon="bi-check-circle"
          tone="green"
          hint="Podem receber novos documentos"
        />
        <SummaryTile
          label="Inativos"
          value={formatNumber(totals.inactive || 0)}
          icon="bi-pause-circle"
          tone="warning"
          hint="Bloqueados para novos documentos"
        />
        <SummaryTile
          label="Inadimplentes bloqueados"
          value={formatNumber(totals.blocked || 0)}
          icon="bi-exclamation-triangle"
          tone="danger"
          hint="Decisão manual, registrada na auditoria"
        />
        <SummaryTile
          label="Limite operacional somado"
          value={formatBRL(totals.operational_limit || 0)}
          icon="bi-sliders"
          tone="petroleum"
          hint="Valores informados no cadastro"
        />
      </div>

      <div className="filter-bar">
        <div className="filter-fields">
          <div className="filter-search">
            <i className="bi bi-search" />
            <input
              type="search"
              className="form-control fp-input"
              placeholder="Buscar por nome, código, CPF/CNPJ, e-mail ou cidade…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Buscar clientes"
            />
          </div>
          <label className="filter-select">
            <span>Status</span>
            <select
              className="form-select fp-input"
              value={status}
              onChange={(event) => setParam('status', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="ATIVO">Ativos</option>
              <option value="INATIVO">Inativos</option>
            </select>
          </label>
          <label className="filter-select">
            <span>Inadimplência</span>
            <select
              className="form-select fp-input"
              value={blocked}
              onChange={(event) => setParam('blocked', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="1">Somente bloqueados</option>
              <option value="0">Sem bloqueio</option>
            </select>
          </label>
          <label className="filter-select">
            <span>Ordenar por</span>
            <select
              className="form-select fp-input"
              value={sort}
              onChange={(event) => setParam('sort', event.target.value)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-light"
            onClick={() => setParam('order', order === 'asc' ? 'desc' : 'asc')}
            title={order === 'asc' ? 'Ordem crescente' : 'Ordem decrescente'}
          >
            <i className={`bi bi-sort-${order === 'asc' ? 'down' : 'up'}-alt`} />
            {order === 'asc' ? 'Crescente' : 'Decrescente'}
          </button>
          {hasFilters && (
            <button type="button" className="btn btn-link" onClick={clearFilters}>
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {loading && !items.length ? (
        <LoadingBlock label="Carregando clientes…" />
      ) : error ? (
        <ErrorBlock message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <div className="fp-panel">
          <EmptyState
            icon="bi-people"
            title={hasFilters ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
            message={
              hasFilters
                ? 'Revise a busca, o status ou o filtro de inadimplência para encontrar o cliente desejado.'
                : 'Cadastre o primeiro cliente para começar a registrar cheques e boletos.'
            }
          >
            {hasFilters ? (
              <button type="button" className="btn btn-light" onClick={clearFilters}>
                <i className="bi bi-x-circle" /> Limpar filtros
              </button>
            ) : (
              canWrite && (
                <Link to="/clientes/novo" className="btn btn-primary">
                  <i className="bi bi-person-plus" /> Cadastrar cliente
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
                  <th>Cliente</th>
                  <th>CPF / CNPJ</th>
                  <th>Contato</th>
                  <th className="text-end">Limite</th>
                  <th className="text-end">Em aberto</th>
                  <th style={{ minWidth: 190 }}>Limite disponível</th>
                  <th>Status</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {items.map((client) => {
                  const summary = client.summary || {}
                  const percent = summary.limit_usage_percent
                  return (
                    <tr
                      key={client.id}
                      className="doc-row"
                      onClick={() => navigate(`/clientes/${client.id}`)}
                      tabIndex={0}
                      role="link"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          navigate(`/clientes/${client.id}`)
                        }
                      }}
                    >
                      <td>
                        <div className="client-cell">
                          <span className="client-cell-avatar">
                            {client.name?.trim().charAt(0).toUpperCase() || '?'}
                          </span>
                          <div>
                            <span className="cell-strong">
                              {client.name}
                              {client.is_blocked && (
                                <span className="fp-badge fp-badge-danger fp-badge-sm ms-2">
                                  Inadimplente · bloqueado
                                </span>
                              )}
                            </span>
                            <span className="cell-sub">
                              {client.code} · {client.person_type === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="nowrap">{formatDocument(client.document)}</td>
                      <td>
                        <span className="cell-strong">{client.phone ? formatPhone(client.phone) : '—'}</span>
                        <span className="cell-sub">{client.email || client.city || 'Sem contato'}</span>
                      </td>
                      <td className="text-end money-cell">{formatBRL(client.operational_limit)}</td>
                      <td className="text-end money-cell">{formatBRL(summary.open_amount)}</td>
                      <td>
                        <div className="limit-cell">
                          <span className={`limit-value ${summary.limit_exceeded ? 'text-danger' : ''}`}>
                            {formatBRL(summary.available_limit)}
                          </span>
                          <div className="fp-progress" aria-hidden="true">
                            <span
                              className={summary.limit_exceeded ? 'danger' : percent > 80 ? 'warning' : ''}
                              style={{ width: `${Math.min(Number(percent) || 0, 100)}%` }}
                            />
                          </div>
                          <span className="cell-sub">
                            {percent === null || percent === undefined
                              ? 'Sem limite definido'
                              : `${Number(percent).toFixed(0)}% utilizado`}
                          </span>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={client.status} size="sm" />
                      </td>
                      <td className="text-end">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="icon-btn sm"
                            title="Ver detalhes"
                            aria-label={`Ver detalhes de ${client.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              navigate(`/clientes/${client.id}`)
                            }}
                          >
                            <i className="bi bi-eye" />
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              className="icon-btn sm"
                              title="Editar"
                              aria-label={`Editar ${client.name}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                navigate(`/clientes/${client.id}/editar`)
                              }}
                            >
                              <i className="bi bi-pencil" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="client-cards d-lg-none">
            {items.map((client) => {
              const summary = client.summary || {}
              return (
                <div className="client-card" key={client.id}>
                  <div className="client-card-head" onClick={() => navigate(`/clientes/${client.id}`)}>
                    <span className="client-cell-avatar">{client.name?.trim().charAt(0).toUpperCase()}</span>
                    <div className="client-card-title">
                      <strong>
                        {client.name}
                        {client.is_blocked && (
                          <span className="fp-badge fp-badge-danger fp-badge-sm ms-2">Bloqueado</span>
                        )}
                      </strong>
                      <small>{client.code} · {formatDocument(client.document)}</small>
                    </div>
                    <StatusBadge status={client.status} size="sm" />
                  </div>
                  <div className="client-card-values">
                    <span>Limite<strong>{formatBRL(client.operational_limit)}</strong></span>
                    <span>Em aberto<strong>{formatBRL(summary.open_amount)}</strong></span>
                    <span>Disponível<strong className={summary.limit_exceeded ? 'text-danger' : ''}>{formatBRL(summary.available_limit)}</strong></span>
                  </div>
                  {client.phone && (
                    <div className="client-card-contact">
                      <i className="bi bi-telephone" /> {formatPhone(client.phone)}
                      {client.city && <span>· {client.city}</span>}
                    </div>
                  )}
                  <div className="client-card-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => navigate(`/clientes/${client.id}`)}
                    >
                      <i className="bi bi-eye" /> Detalhes
                    </button>
                    {canWrite && (
                      <button
                        type="button"
                        className="btn btn-sm btn-light"
                        onClick={() => navigate(`/clientes/${client.id}/editar`)}
                      >
                        <i className="bi bi-pencil" /> Editar
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <Pagination meta={meta} onChange={(nextPage) => setParam('page', String(nextPage))} />
        </div>
      )}
    </div>
  )
}
