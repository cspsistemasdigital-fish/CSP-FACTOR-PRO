import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Chart from 'react-apexcharts'
import { reportsApi } from '../../api'
import { apiError } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'
import { useToast } from '../../context/ToastContext'
import PageHeader from '../../components/ui/PageHeader'
import StatCard from '../../components/ui/StatCard'
import Panel from '../../components/ui/Panel'
import StatusBadge from '../../components/ui/StatusBadge'
import EmptyState from '../../components/ui/EmptyState'
import Pagination from '../../components/ui/Pagination'
import Modal from '../../components/ui/Modal'
import ClientSelect from '../../components/form/ClientSelect'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import {
  describePeriod,
  formatBRL,
  formatDate,
  formatNumber,
  presetRange,
} from '../../utils/format'

const PAGE_SIZE = 25

const PRESETS = [
  { key: 'all', label: 'Tudo' },
  { key: 'hoje', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'mes_atual', label: 'Mês atual' },
  { key: 'mes_anterior', label: 'Mês anterior' },
  { key: 'ano_atual', label: 'Ano atual' },
]

const EMPTY_FILTERS = {
  date_from: '',
  date_to: '',
  client: null,
  kind: '',
  status: '',
  loan_status: '',
  overdue: false,
  search: '',
}

const KIND_OPTIONS = [
  { value: '', label: 'Todos (cheques, boletos e empréstimos)' },
  { value: 'CHEQUE', label: 'Cheques' },
  { value: 'BOLETO', label: 'Boletos' },
  { value: 'EMPRESTIMO', label: 'Empréstimos' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'Todas as situações' },
  { value: 'EM_ABERTO', label: 'Em aberto' },
  { value: 'LIQUIDADO', label: 'Liquidado' },
  { value: 'DEVOLVIDO', label: 'Devolvido' },
  { value: 'CANCELADO', label: 'Cancelado' },
]

const LOAN_STATUS_OPTIONS = [
  { value: '', label: 'Todas as situações' },
  { value: 'ABERTA', label: 'Aberta' },
  { value: 'QUITADA', label: 'Quitada' },
  { value: 'CANCELADA', label: 'Cancelada' },
]

// Etapa 8: a single dropdown carries both domains. The prefix is stripped
// before the request, so the API still receives `status` and `loan_status`.
const COMBINED_STATUS_OPTIONS = [
  { value: '', label: 'Todas as situações' },
  ...STATUS_OPTIONS.slice(1).map((option) => ({
    value: `doc:${option.value}`,
    label: `Título · ${option.label}`,
  })),
  ...LOAN_STATUS_OPTIONS.slice(1).map((option) => ({
    value: `loan:${option.value}`,
    label: `Empréstimo · ${option.label}`,
  })),
]

function combinedStatusValue(filters) {
  if (filters.status) return `doc:${filters.status}`
  if (filters.loan_status) return `loan:${filters.loan_status}`
  return ''
}

function changeCombinedStatus(draft, value) {
  if (!value) return { ...draft, status: '', loan_status: '' }
  if (value.startsWith('doc:')) return { ...draft, status: value.slice(4), loan_status: '' }
  return { ...draft, status: '', loan_status: value.slice(5) }
}

const TABS = [
  { key: 'geral', label: 'Visão geral', icon: 'bi-grid-1x2' },
  { key: 'clientes', label: 'Clientes e limites', icon: 'bi-people' },
  { key: 'titulos', label: 'Cheques e boletos', icon: 'bi-collection' },
  { key: 'emprestimos', label: 'Empréstimos', icon: 'bi-cash-coin' },
  { key: 'operacoes', label: 'Operações', icon: 'bi-arrow-left-right' },
  { key: 'recebimentos', label: 'Recebimentos', icon: 'bi-cash-coin' },
]

const STATUS_COLORS = {
  EM_ABERTO: '#E0A106',
  LIQUIDADO: '#16845B',
  DEVOLVIDO: '#C9463D',
  CANCELADO: '#7C8C86',
  ABERTA: '#E0A106',
  QUITADA: '#16845B',
  CANCELADA: '#7C8C86',
}

function emptyReport() {
  return {
    cards: {},
    by_kind: [],
    by_status: [],
    by_loan_status: [],
    by_month: [],
    clients: [],
    documents: [],
    loans: [],
    installments: [],
    operations: [],
    receipts: [],
    counts: {},
    filters: {},
    period_label: 'Todo o período',
    generated_at: null,
  }
}

function buildQuery(filters) {
  const params = {}
  if (filters.date_from) params.date_from = filters.date_from
  if (filters.date_to) params.date_to = filters.date_to
  if (filters.client?.id) params.client_id = filters.client.id
  if (filters.kind) params.kind = filters.kind
  if (filters.status) params.status = filters.status
  if (filters.loan_status) params.loan_status = filters.loan_status
  if (filters.overdue) params.overdue = 1
  if (filters.search?.trim()) params.search = filters.search.trim()
  return params
}

function hasActiveFilters(filters) {
  return Boolean(
    filters.date_from ||
      filters.date_to ||
      filters.client?.id ||
      filters.kind ||
      filters.status ||
      filters.loan_status ||
      filters.overdue ||
      filters.search?.trim(),
  )
}

function useLocalPage(rows) {
  const [page, setPage] = useState(1)
  const total = rows.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const current = Math.min(page, pages)
  const meta = total ? { page: current, pages, total, per_page: PAGE_SIZE } : null
  return {
    meta,
    page: current,
    setPage,
    slice: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
  }
}

export default function Relatorios() {
  const navigate = useNavigate()
  const { isDark } = useTheme()
  const toast = useToast()

  const [tab, setTab] = useState('geral')
  const [preset, setPreset] = useState('all')
  const [draft, setDraft] = useState(EMPTY_FILTERS)
  const [applied, setApplied] = useState(EMPTY_FILTERS)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savedFilters, setSavedFilters] = useState([])
  const [filterName, setFilterName] = useState('')
  const [exporting, setExporting] = useState('')

  const [waOpen, setWaOpen] = useState(false)
  const [waLoading, setWaLoading] = useState(false)
  const [waError, setWaError] = useState('')
  const [waData, setWaData] = useState(null)
  const [waMessage, setWaMessage] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data } = await reportsApi.filters()
        if (active) setSavedFilters(data.items || [])
      } catch {
        if (active) setSavedFilters([])
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await reportsApi.summary(buildQuery(applied))
      setData(response.data)
    } catch (requestError) {
      const parsed = apiError(requestError)
      setError(parsed.message)
      toast.error('Falha ao carregar o relatório', parsed.message)
    } finally {
      setLoading(false)
    }
  }, [applied, toast])

  useEffect(() => {
    load()
  }, [load])

  const report = data || emptyReport()
  const cards = report.cards || {}
  const documents = report.documents || []
  const clients = report.clients || []
  const loans = report.loans || []
  const installments = report.installments || []
  const byLoanStatus = report.by_loan_status || []
  const operations = report.operations || []
  const receipts = report.receipts || []

  const visibleClients = useMemo(
    () => clients.filter((row) => row.period_documents || row.open_documents),
    [clients],
  )

  const clientsPage = useLocalPage(visibleClients)
  const documentsPage = useLocalPage(documents)
  const loansPage = useLocalPage(loans)
  const installmentsPage = useLocalPage(installments)
  const operationsPage = useLocalPage(operations)
  const receiptsPage = useLocalPage(receipts)

  const chartsTheme = isDark ? 'dark' : 'light'
  const textColor = isDark ? '#DCE9E3' : '#3B4F48'
  const mutedLine = isDark ? 'rgba(255,255,255,.10)' : '#E4ECE8'

  const monthlyOptions = useMemo(
    () => ({
      chart: {
        type: 'bar',
        background: 'transparent',
        fontFamily: 'inherit',
        toolbar: { show: false },
        stacked: false,
      },
      theme: { mode: chartsTheme },
      colors: ['#16845B', '#173B57', '#E0A106', '#6F4DB5'],
      plotOptions: { bar: { columnWidth: '55%', borderRadius: 5, borderRadiusApplication: 'end' } },
      dataLabels: { enabled: false },
      stroke: { show: true, width: 0 },
      grid: { borderColor: mutedLine, strokeDashArray: 4 },
      xaxis: {
        categories: report.by_month.map((item) => item.label),
        labels: { style: { colors: textColor }, rotate: -35, rotateAlways: false },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: textColor },
          formatter: (value) =>
            value >= 1000000
              ? `R$ ${(value / 1000000).toFixed(1)} mi`
              : value >= 1000
                ? `R$ ${(value / 1000).toFixed(0)} mil`
                : `R$ ${value}`,
        },
      },
      legend: { labels: { colors: textColor }, position: 'top', horizontalAlign: 'left' },
      tooltip: { y: { formatter: (value) => formatBRL(value) } },
      noData: { text: 'Nenhum movimento no período', style: { color: textColor } },
    }),
    [chartsTheme, report.by_month, textColor, mutedLine],
  )

  const monthlySeries = useMemo(
    () => [
      { name: 'Nominal', data: report.by_month.map((item) => Number(item.nominal || 0)) },
      { name: 'Líquido', data: report.by_month.map((item) => Number(item.net || 0)) },
      { name: 'Recebido', data: report.by_month.map((item) => Number(item.received || 0)) },
      { name: 'Empréstimos', data: report.by_month.map((item) => Number(item.loan_amount || 0)) },
    ],
    [report.by_month],
  )

  const statusOptions = useMemo(
    () => ({
      chart: { type: 'donut', background: 'transparent', fontFamily: 'inherit' },
      theme: { mode: chartsTheme },
      labels: report.by_status.map((item) => item.label),
      colors: report.by_status.map((item) => STATUS_COLORS[item.status] || '#7C8C86'),
      legend: {
        position: 'bottom',
        labels: { colors: textColor },
        fontSize: '13px',
        markers: { size: 6 },
      },
      dataLabels: { enabled: false },
      stroke: { colors: [isDark ? '#16241F' : '#FFFFFF'], width: 3 },
      tooltip: { y: { formatter: (value) => `${formatNumber(value)} título(s)` } },
      plotOptions: {
        pie: {
          donut: {
            size: '66%',
            labels: {
              show: true,
              total: {
                show: true,
                label: 'Títulos',
                color: textColor,
                formatter: () => formatNumber(cards.documents_count || 0),
              },
              value: { color: textColor, fontSize: '22px', fontWeight: 700 },
            },
          },
        },
      },
      noData: { text: 'Nenhum título no período', style: { color: textColor } },
    }),
    [chartsTheme, report.by_status, cards.documents_count, textColor, isDark],
  )

  const loanStatusOptions = useMemo(
    () => ({
      chart: { type: 'donut', background: 'transparent', fontFamily: 'inherit' },
      theme: { mode: chartsTheme },
      labels: byLoanStatus.map((item) => item.label),
      colors: byLoanStatus.map((item) => STATUS_COLORS[item.status] || '#7C8C86'),
      legend: {
        position: 'bottom',
        labels: { colors: textColor },
        fontSize: '13px',
        markers: { size: 6 },
      },
      dataLabels: { enabled: false },
      stroke: { colors: [isDark ? '#16241F' : '#FFFFFF'], width: 3 },
      tooltip: { y: { formatter: (value) => `${formatNumber(value)} empréstimo(s)` } },
      plotOptions: {
        pie: {
          donut: {
            size: '66%',
            labels: {
              show: true,
              total: {
                show: true,
                label: 'Empréstimos',
                color: textColor,
                formatter: () => formatNumber(cards.loans_count || 0),
              },
              value: { color: textColor, fontSize: '22px', fontWeight: 700 },
            },
          },
        },
      },
      noData: { text: 'Nenhum empréstimo no período', style: { color: textColor } },
    }),
    [chartsTheme, byLoanStatus, cards.loans_count, textColor, isDark],
  )

  const applyPreset = (key) => {
    setPreset(key)
    if (key === 'all') {
      const next = { ...EMPTY_FILTERS, client: draft.client }
      setDraft(next)
      setApplied({ ...next })
      return
    }
    const range = presetRange(key)
    const next = { ...draft, date_from: range.from, date_to: range.to }
    setDraft(next)
    setApplied({ ...next })
  }

  const applyFilters = (event) => {
    event.preventDefault()
    if (draft.date_from && draft.date_to && draft.date_from > draft.date_to) {
      toast.warning('Período inválido', 'A data inicial não pode ser maior que a data final.')
      return
    }
    setPreset('custom')
    setApplied({ ...draft })
  }

  const clearFilters = () => {
    setPreset('all')
    setDraft({ ...EMPTY_FILTERS })
    setApplied({ ...EMPTY_FILTERS })
    setFilterName('')
  }

  const saveCurrentFilter = async () => {
    const name = filterName.trim()
    if (!name) {
      toast.warning('Dê um nome ao filtro', 'Ex.: “Vencidos do mês” ou “Carteira do cliente X”.')
      return
    }
    if (!hasActiveFilters(applied)) {
      toast.warning('Filtro vazio', 'Informe ao menos um critério antes de salvar.')
      return
    }
    const filters = buildQuery(applied)
    if (applied.client?.id) {
      filters.client_name = applied.client.name
      filters.client_code = applied.client.code
    }
    try {
      const { data } = await reportsApi.saveFilter({ name: name.slice(0, 60), filters })
      setSavedFilters((current) => [data.item, ...current])
      setFilterName('')
      toast.success('Filtro salvo', 'Ele fica disponível na sua conta em qualquer dispositivo.')
    } catch (requestError) {
      const parsed = apiError(requestError)
      toast.error('Não foi possível salvar o filtro', parsed.message)
    }
  }

  const applySavedFilter = (entry) => {
    const saved = entry.filters || {}
    const filters = {
      ...EMPTY_FILTERS,
      date_from: saved.date_from || '',
      date_to: saved.date_to || '',
      kind: saved.kind || '',
      status: saved.status || '',
      loan_status: saved.loan_status || '',
      overdue: Boolean(saved.overdue),
      search: saved.search || '',
      client: saved.client_id
        ? {
            id: saved.client_id,
            name: saved.client_name || `Cliente #${saved.client_id}`,
            code: saved.client_code || '',
          }
        : null,
    }
    setDraft(filters)
    setApplied(filters)
    setPreset('custom')
  }

  const removeSavedFilter = async (entry) => {
    try {
      await reportsApi.removeFilter(entry.id)
      setSavedFilters((current) => current.filter((item) => item.id !== entry.id))
      toast.success('Filtro removido', 'Ele não aparece mais na sua conta.')
    } catch (requestError) {
      toast.error('Não foi possível remover o filtro', apiError(requestError).message)
    }
  }

  const exportReport = async (format) => {
    setExporting(format)
    try {
      const query = buildQuery(applied)
      if (format === 'pdf') await reportsApi.exportPdf(query)
      else await reportsApi.exportXlsx(query)
      toast.success(
        `Relatório em ${format.toUpperCase()} gerado`,
        'A exportação foi registrada na auditoria do sistema.',
      )
    } catch (requestError) {
      const parsed = apiError(requestError)
      toast.error('Não foi possível exportar', parsed.message)
    } finally {
      setExporting('')
    }
  }

  const openWhatsApp = async (client) => {
    setWaOpen(true)
    setWaLoading(true)
    setWaError('')
    setWaData(null)
    setWaMessage('')
    try {
      const response = await reportsApi.whatsapp(client.id, buildQuery(applied))
      setWaData(response.data.item)
      setWaMessage(response.data.item.message || '')
    } catch (requestError) {
      setWaError(apiError(requestError).message)
    } finally {
      setWaLoading(false)
    }
  }

  const closeWhatsApp = () => {
    setWaOpen(false)
    setWaData(null)
    setWaMessage('')
    setWaError('')
  }

  const whatsappUrl = useMemo(() => {
    if (!waData?.phone || !waMessage.trim()) return null
    return `https://wa.me/${waData.phone}?text=${encodeURIComponent(waMessage)}`
  }, [waData, waMessage])

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(waMessage)
      toast.success('Mensagem copiada', 'Cole no WhatsApp ou em outro aplicativo.')
    } catch {
      toast.warning('Não foi possível copiar', 'Selecione o texto e copie manualmente.')
    }
  }

  const openDocument = (item) => {
    navigate(item.kind === 'BOLETO' ? `/boletos/${item.id}` : `/cheques/${item.id}`)
  }

  const openLoan = (item) => {
    navigate(`/emprestimos/${item.id}`)
  }

  const periodLabel = describePeriod(applied.date_from, applied.date_to)
  const activeFilterCount = [
    applied.client?.id,
    applied.kind,
    applied.status,
    applied.loan_status,
    applied.overdue,
    applied.search?.trim(),
    applied.date_from || applied.date_to,
  ].filter(Boolean).length

  const tabCounts = {
    clientes: visibleClients.length,
    titulos: documents.length,
    emprestimos: loans.length,
    operacoes: operations.length,
    recebimentos: receipts.length,
  }

  return (
    <div className="page">
      <PageHeader
        title="Relatório Geral"
        subtitle="Cheques, boletos e empréstimos em um só lugar: filtre por período, cliente, tipo e situação para analisar cada caso. Todos os números derivam dos lançamentos reais — nada é recalculado."
        icon="bi-graph-up-arrow"
        badge={
          <span className="fp-badge fp-badge-success">
            <i className="bi bi-check-circle-fill" /> Etapa 7
          </span>
        }
      >
        <button type="button" className="btn btn-light" onClick={load} disabled={loading}>
          <i className={`bi ${loading ? 'arrow-repeat spin' : 'arrow-clockwise'}`} /> Atualizar
        </button>
        <button
          type="button"
          className="btn btn-outline-primary"
          onClick={() => exportReport('pdf')}
          disabled={Boolean(exporting)}
        >
          <i className={`bi ${exporting === 'pdf' ? 'arrow-repeat spin' : 'file-earmark-pdf'}`} /> PDF
        </button>
        <button
          type="button"
          className="btn btn-outline-primary"
          onClick={() => exportReport('xlsx')}
          disabled={Boolean(exporting)}
        >
          <i className={`bi ${exporting === 'xlsx' ? 'arrow-repeat spin' : 'file-earmark-spreadsheet'}`} />{' '}
          Planilha
        </button>
      </PageHeader>

      <form className="filter-bar" onSubmit={applyFilters}>
        <div className="preset-row" role="group" aria-label="Períodos rápidos">
          {PRESETS.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`preset-chip ${preset === item.key ? 'active' : ''}`}
              onClick={() => applyPreset(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="filter-fields">
          <label className="filter-date">
            <span>De</span>
            <input
              type="date"
              className="form-control fp-input"
              value={draft.date_from}
              max={draft.date_to || undefined}
              onChange={(event) => setDraft({ ...draft, date_from: event.target.value })}
            />
          </label>
          <label className="filter-date">
            <span>Até</span>
            <input
              type="date"
              className="form-control fp-input"
              value={draft.date_to}
              min={draft.date_from || undefined}
              onChange={(event) => setDraft({ ...draft, date_to: event.target.value })}
            />
          </label>
          <div className="filter-client">
            <ClientSelect
              label="Cliente (opcional)"
              value={draft.client?.id || null}
              initialClient={draft.client}
              onChange={(client) => setDraft({ ...draft, client })}
              required={false}
              includeInactive
              placeholder="Todos os clientes"
            />
          </div>
          <label className="filter-select">
            <span>Tipo</span>
            <select
              className="form-select fp-input"
              value={draft.kind}
              onChange={(event) => setDraft({ ...draft, kind: event.target.value })}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-select">
            <span>Situação</span>
            <select
              className="form-select fp-input"
              value={combinedStatusValue(draft)}
              onChange={(event) => setDraft(changeCombinedStatus(draft, event.target.value))}
              aria-label="Situação do título ou do empréstimo"
            >
              {COMBINED_STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-check">
            <input
              type="checkbox"
              className="form-check-input"
              checked={draft.overdue}
              onChange={(event) => setDraft({ ...draft, overdue: event.target.checked })}
            />
            <span>Somente vencidos</span>
          </label>
          <div className="filter-search">
            <i className="bi bi-search" />
            <input
              type="search"
              className="form-control fp-input"
              placeholder="Buscar por cliente, código, banco…"
              value={draft.search}
              onChange={(event) => setDraft({ ...draft, search: event.target.value })}
              aria-label="Buscar no relatório"
            />
          </div>
          <button type="submit" className="btn btn-outline-primary">
            <i className="bi bi-funnel" /> Aplicar
          </button>
          <button type="button" className="btn btn-light" onClick={clearFilters}>
            Limpar
          </button>
        </div>

        <div className="report-saved">
          <div className="report-saved-form">
            <input
              type="text"
              className="form-control fp-input"
              placeholder="Nome do filtro (ex.: Vencidos do mês)"
              value={filterName}
              maxLength={60}
              onChange={(event) => setFilterName(event.target.value)}
              aria-label="Nome do filtro salvo"
            />
            <button type="button" className="btn btn-outline-secondary" onClick={saveCurrentFilter}>
              <i className="bi bi-bookmark-plus" /> Salvar filtro
            </button>
          </div>
          {savedFilters.length > 0 && (
            <div className="report-saved-list" aria-label="Filtros salvos na sua conta">
              {savedFilters.map((entry) => (
                <span className="report-saved-chip" key={entry.id}>
                  <button
                    type="button"
                    className="report-saved-apply"
                    onClick={() => applySavedFilter(entry)}
                    title="Aplicar este filtro"
                  >
                    <i className="bi bi-bookmark-fill" /> {entry.name}
                  </button>
                  <button
                    type="button"
                    className="report-saved-remove"
                    onClick={() => removeSavedFilter(entry)}
                    aria-label={`Remover filtro ${entry.name}`}
                  >
                    <i className="bi bi-x-lg" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="filter-summary">
          <i className="bi bi-calendar3" />
          <span>
            Período: <strong>{periodLabel}</strong>
          </span>
          {applied.client?.name && (
            <span className="filter-summary-client">
              <i className="bi bi-person" /> {applied.client.name}
            </span>
          )}
          <span>
            <i className="bi bi-list-check" /> {activeFilterCount} critério(s) ativo(s)
          </span>
          {report.generated_at && (
            <span className="report-generated">
              <i className="bi bi-clock" /> Gerado em{' '}
              {new Date(report.generated_at).toLocaleString('pt-BR')}
            </span>
          )}
        </div>
      </form>

      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {loading && !data ? (
        <LoadingBlock label="Consolidando o relatório…" />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              label="Títulos no período"
              value={formatNumber(cards.documents_count || 0)}
              hint={`${formatNumber(cards.clients_count || 0)} cliente(s) com movimento ou saldo.`}
              icon="bi-collection"
              tone="petroleum"
              loading={loading}
            />
            <StatCard
              label="Valor nominal"
              value={formatBRL(cards.nominal_total || 0)}
              hint={`Custos informados: ${formatBRL(cards.costs_total || 0)}`}
              icon="bi-cash-stack"
              tone="light"
              loading={loading}
            />
            <StatCard
              label="Valor líquido"
              value={formatBRL(cards.net_total || 0)}
              hint="Soma exata dos líquidos informados nos títulos."
              icon="bi-wallet2"
              tone="green"
              loading={loading}
            />
            <StatCard
              label="Em aberto"
              value={formatBRL(cards.open_total || 0)}
              hint="Títulos em aberto ou devolvidos."
              icon="bi-hourglass-split"
              tone="warning"
              loading={loading}
            />
            <StatCard
              label="Vencidos"
              value={formatBRL(cards.overdue_total || 0)}
              hint="Pendentes com vencimento anterior a hoje."
              icon="bi-exclamation-triangle"
              tone="danger"
              loading={loading}
            />
            <StatCard
              label="Recebido no período"
              value={formatBRL(cards.receipts_total || 0)}
              hint={`${formatNumber(cards.receipts_count || 0)} recebimento(s) e ${formatNumber(cards.operations_count || 0)} operação(ões).`}
              icon="bi-cash-coin"
              tone="green"
              loading={loading}
            />
            <StatCard
              label="Empréstimos no período"
              value={formatNumber(cards.loans_count || 0)}
              hint={`${formatBRL(cards.loan_amount_total || 0)} emprestados · ${formatBRL(cards.loan_received_total || 0)} recebidos.`}
              icon="bi-cash-coin"
              tone="petroleum"
              loading={loading}
            />
            <StatCard
              label="Lucro informado"
              value={formatBRL(cards.profit_total || 0)}
              hint={`${formatNumber(cards.installments_count || 0)} parcela(s) · ${formatBRL(cards.loan_open_total || 0)} em aberto.`}
              icon="bi-graph-up"
              tone="green"
              loading={loading}
            />
          </div>

          <div className="fp-panel settings-shell">
            <div className="fp-tabs" role="tablist" aria-label="Seções do relatório">
              {TABS.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  role="tab"
                  aria-selected={tab === item.key}
                  className={`fp-tab ${tab === item.key ? 'active' : ''}`}
                  onClick={() => setTab(item.key)}
                >
                  <i className={`bi ${item.icon}`} />
                  {item.label}
                  {tabCounts[item.key] !== undefined && (
                    <span className="tab-count">{formatNumber(tabCounts[item.key])}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="tab-body">
              {tab === 'geral' && (
                <div className="report-stack">
                  <div className="dash-grid-2">
                    <Panel
                      title="Movimento mensal"
                      subtitle="Nominal, líquido e recebido por mês."
                      icon="bi-bar-chart"
                    >
                      {loading ? (
                        <LoadingBlock label="Carregando gráfico…" />
                      ) : (
                        <Chart
                          key={`monthly-${chartsTheme}-${report.by_month.length}`}
                          options={monthlyOptions}
                          series={monthlySeries}
                          type="bar"
                          height={300}
                        />
                      )}
                    </Panel>
                    <Panel
                      title="Composição por situação"
                      subtitle={`${formatNumber(cards.documents_count || 0)} título(s) no período`}
                      icon="bi-pie-chart"
                    >
                      {loading ? (
                        <LoadingBlock label="Carregando gráfico…" />
                      ) : (
                        <Chart
                          key={`status-${chartsTheme}-${cards.documents_count}`}
                          options={statusOptions}
                          series={report.by_status.map((item) => item.count)}
                          type="donut"
                          height={300}
                        />
                      )}
                    </Panel>
                  </div>

                  <div className="report-split">
                    <Panel
                      title="Empréstimos por situação"
                      subtitle={`${formatNumber(cards.loans_count || 0)} empréstimo(s) no período`}
                      icon="bi-pie-chart"
                    >
                      {loading ? (
                        <LoadingBlock label="Carregando gráfico…" />
                      ) : (
                        <Chart
                          key={`loan-status-${chartsTheme}-${cards.loans_count}`}
                          options={loanStatusOptions}
                          series={byLoanStatus.map((item) => item.count)}
                          type="donut"
                          height={300}
                        />
                      )}
                    </Panel>
                    <Panel
                      title="Resumo por situação do empréstimo"
                      subtitle="Valores informados, sem cálculo automático."
                      icon="bi-clipboard-data"
                    >
                      <div className="table-responsive fp-table-wrap">
                        <table className="table fp-table report-table">
                          <thead>
                            <tr>
                              <th>Situação</th>
                              <th className="text-end">Empréstimos</th>
                              <th className="text-end">Valor emprestado</th>
                              <th className="text-end">Lucro informado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {byLoanStatus.map((item) => (
                              <tr key={item.status}>
                                <td>
                                  <StatusBadge status={item.status} size="sm" />
                                </td>
                                <td className="text-end">{formatNumber(item.count)}</td>
                                <td className="text-end money-cell">{formatBRL(item.loan_amount)}</td>
                                <td className="text-end money-cell">{formatBRL(item.profit_amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Panel>
                  </div>

                  <div className="report-split">
                    <Panel title="Resumo por tipo" subtitle="Totais derivados dos lançamentos filtrados." icon="bi-layers">
                      <div className="table-responsive fp-table-wrap">
                        <table className="table fp-table report-table">
                          <thead>
                            <tr>
                              <th>Tipo</th>
                              <th className="text-end">Qtd.</th>
                              <th className="text-end">Nominal</th>
                              <th className="text-end">Líquido</th>
                              <th className="text-end">Em aberto</th>
                              <th className="text-end">Emprestado</th>
                              <th className="text-end">Lucro</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.by_kind.map((item) => (
                              <tr key={item.kind}>
                                <td>
                                  <span className="type-chip">
                                    <i
                                      className={`bi ${
                                        item.kind === 'BOLETO'
                                          ? 'bi-receipt'
                                          : item.kind === 'EMPRESTIMO'
                                            ? 'bi-cash-coin'
                                            : 'bi-journal-check'
                                      }`}
                                    />{' '}
                                    {item.label}
                                  </span>
                                </td>
                                <td className="text-end">{formatNumber(item.count)}</td>
                                <td className="text-end money-cell">{formatBRL(item.nominal)}</td>
                                <td className="text-end money-cell">{formatBRL(item.net)}</td>
                                <td className="text-end money-cell">
                                  {item.kind === 'EMPRESTIMO' ? '—' : formatBRL(item.open)}
                                </td>
                                <td className="text-end money-cell">
                                  {item.kind === 'EMPRESTIMO' ? formatBRL(item.loan_amount) : '—'}
                                </td>
                                <td className="text-end money-cell">
                                  {item.kind === 'EMPRESTIMO' ? formatBRL(item.profit_amount) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Panel>

                    <Panel
                      title="Resumo por situação"
                      subtitle="Situação atual dos títulos no período."
                      icon="bi-clipboard-check"
                    >
                      <div className="table-responsive fp-table-wrap">
                        <table className="table fp-table report-table">
                          <thead>
                            <tr>
                              <th>Situação</th>
                              <th className="text-end">Títulos</th>
                              <th className="text-end">Nominal</th>
                              <th className="text-end">Líquido</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.by_status.map((item) => (
                              <tr key={item.status}>
                                <td>
                                  <StatusBadge status={item.status} size="sm" />
                                </td>
                                <td className="text-end">{formatNumber(item.count)}</td>
                                <td className="text-end money-cell">{formatBRL(item.nominal)}</td>
                                <td className="text-end money-cell">{formatBRL(item.net)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Panel>
                  </div>

                  <div className="info-note">
                    <i className="bi bi-info-circle" />
                    <div>
                      <strong>Como os valores são obtidos</strong>
                      <p>
                        Nominal, custos e líquido são exatamente os valores informados nos cheques e boletos;
                        emprestado, recebido e lucro são os valores informados nos empréstimos. O relatório
                        apenas soma, agrupa e compara — nunca calcula juros, descontos, taxas ou encargos.{' '}
                        {formatNumber(cards.divergences_count || 0)} título(s) e{' '}
                        {formatNumber(cards.loan_divergences_count || 0)} empréstimo(s) com divergência de
                        valores, {formatNumber(cards.overdue_installments || 0)} parcela(s) vencida(s) e{' '}
                        {formatNumber(cards.limits_exceeded_count || 0)} cliente(s) acima do limite operacional.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'clientes' && (
                <div className="report-stack">
                  {visibleClients.length === 0 ? (
                    <EmptyState
                      icon="bi-people"
                      title="Nenhum cliente com movimento"
                      message="Ajuste os filtros ou cadastre títulos para visualizar a carteira por cliente."
                    />
                  ) : (
                    <>
                      <div className="table-responsive fp-table-wrap">
                        <table className="table fp-table report-table">
                          <thead>
                            <tr>
                              <th>Cliente</th>
                              <th className="text-end">Limite</th>
                              <th className="text-end">Em aberto</th>
                              <th className="text-end">Disponível</th>
                              <th>Uso do limite</th>
                              <th className="text-end">Títulos</th>
                              <th className="text-end">Líquido no período</th>
                              <th className="text-end">Recebido</th>
                              <th aria-label="Ações" />
                            </tr>
                          </thead>
                          <tbody>
                            {clientsPage.slice.map((row) => (
                              <tr key={row.id}>
                                <td>
                                  <span className="cell-strong">{row.name}</span>
                                  <span className="cell-sub">
                                    {row.code} · {row.status_label}
                                  </span>
                                </td>
                                <td className="text-end money-cell">{formatBRL(row.operational_limit)}</td>
                                <td className="text-end money-cell">
                                  {formatBRL(row.open_amount)}
                                  {row.overdue_amount > 0 && (
                                    <span className="cell-sub text-danger">
                                      Vencido: {formatBRL(row.overdue_amount)}
                                    </span>
                                  )}
                                </td>
                                <td className={`text-end money-cell ${row.available_limit < 0 ? 'text-danger' : ''}`}>
                                  {formatBRL(row.available_limit)}
                                </td>
                                <td>
                                  <div className="report-usage">
                                    <span className="report-usage-label">
                                      {row.limit_usage_percent === null
                                        ? 'Sem limite definido'
                                        : `${row.limit_usage_percent.toFixed(2)}%`}
                                    </span>
                                    <span
                                      className={`report-usage-bar ${row.limit_exceeded ? 'is-over' : ''}`}
                                      role="img"
                                      aria-label={
                                        row.limit_usage_percent === null
                                          ? 'Cliente sem limite operacional definido'
                                          : `Uso de ${row.limit_usage_percent.toFixed(2)}% do limite operacional`
                                      }
                                    >
                                      <span
                                        style={{
                                          width: `${Math.min(Number(row.limit_usage_percent || 0), 100)}%`,
                                        }}
                                      />
                                    </span>
                                  </div>
                                </td>
                                <td className="text-end">{formatNumber(row.period_documents)}</td>
                                <td className="text-end money-cell">{formatBRL(row.period_net)}</td>
                                <td className="text-end money-cell">{formatBRL(row.period_received)}</td>
                                <td className="text-end">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-primary"
                                    onClick={() => openWhatsApp(row)}
                                  >
                                    <i className="bi bi-whatsapp" /> WhatsApp
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination meta={clientsPage.meta} onChange={clientsPage.setPage} />
                      <p className="report-caption">
                        Limite disponível = limite operacional menos a exposição em aberto (títulos em aberto
                        ou devolvidos). Ultrapassar o limite é um aviso, nunca um bloqueio.
                      </p>
                    </>
                  )}
                </div>
              )}

              {tab === 'titulos' && (
                <div className="report-stack">
                  {documents.length === 0 ? (
                    <EmptyState
                      icon="bi-collection"
                      title="Nenhum título encontrado"
                      message="Ajuste os filtros para ampliar a consulta."
                    />
                  ) : (
                    <>
                      <div className="table-responsive fp-table-wrap">
                        <table className="table fp-table report-table">
                          <thead>
                            <tr>
                              <th>Título</th>
                              <th>Cliente</th>
                              <th>Vencimento</th>
                              <th>Operação</th>
                              <th>Situação</th>
                              <th className="text-end">Nominal</th>
                              <th className="text-end">Líquido</th>
                              <th className="text-end">Recebido</th>
                              <th className="text-end">Saldo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {documentsPage.slice.map((item) => (
                              <tr
                                key={`${item.kind}-${item.id}`}
                                className="doc-row"
                                tabIndex={0}
                                role="link"
                                onClick={() => openDocument(item)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    openDocument(item)
                                  }
                                }}
                              >
                                <td>
                                  <span className="doc-code">
                                    <i
                                      className={`bi ${item.kind === 'BOLETO' ? 'bi-receipt' : 'bi-journal-check'}`}
                                    />
                                    {item.code}
                                  </span>
                                  <span className="cell-sub">{item.kind_label}</span>
                                </td>
                                <td>
                                  <span className="cell-strong">{item.client_name || '—'}</span>
                                  {item.client_code && <span className="cell-sub">{item.client_code}</span>}
                                </td>
                                <td>
                                  <span className={item.is_overdue ? 'date-overdue' : ''}>
                                    {formatDate(item.due_date)}
                                  </span>
                                </td>
                                <td>{item.operation?.code || '—'}</td>
                                <td>
                                  <StatusBadge status={item.status} overdue={item.is_overdue} size="sm" />
                                </td>
                                <td className="text-end money-cell">{formatBRL(item.nominal_amount)}</td>
                                <td className="text-end money-cell">{formatBRL(item.net_amount)}</td>
                                <td className="text-end money-cell">{formatBRL(item.received_total)}</td>
                                <td className="text-end money-cell">{formatBRL(item.remaining_value)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination meta={documentsPage.meta} onChange={documentsPage.setPage} />
                      <p className="report-caption">
                        O saldo é apenas a diferença entre o líquido informado e o total já recebido. Títulos
                        cancelados ou excluídos logicamente não entram no relatório.
                      </p>
                    </>
                  )}
                </div>
              )}

              {tab === 'emprestimos' && (
                <div className="report-stack">
                  <div className="stat-grid">
                    <StatCard
                      label="Empréstimos"
                      value={formatNumber(cards.loans_count || 0)}
                      hint="Quantidade no período filtrado."
                      icon="bi-cash-coin"
                      tone="petroleum"
                      loading={loading}
                    />
                    <StatCard
                      label="Valor emprestado"
                      value={formatBRL(cards.loan_amount_total || 0)}
                      hint="Exatamente o valor informado."
                      icon="bi-cash-stack"
                      tone="light"
                      loading={loading}
                    />
                    <StatCard
                      label="Valor recebido"
                      value={formatBRL(cards.loan_received_total || 0)}
                      hint="Exatamente o valor informado."
                      icon="bi-wallet2"
                      tone="green"
                      loading={loading}
                    />
                    <StatCard
                      label="Lucro informado"
                      value={formatBRL(cards.profit_total || 0)}
                      hint="Diferença informada pelo usuário."
                      icon="bi-graph-up"
                      tone="green"
                      loading={loading}
                    />
                    <StatCard
                      label="Saldo em parcelas"
                      value={formatBRL(cards.loan_open_total || 0)}
                      hint="Parcelas em aberto ou devolvidas."
                      icon="bi-hourglass-split"
                      tone="warning"
                      loading={loading}
                    />
                  </div>

                  {byLoanStatus.length > 0 && (
                    <div className="table-responsive fp-table-wrap">
                      <table className="table fp-table report-table">
                        <thead>
                          <tr>
                            <th>Situação do empréstimo</th>
                            <th className="text-end">Empréstimos</th>
                            <th className="text-end">Valor emprestado</th>
                            <th className="text-end">Lucro informado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byLoanStatus.map((item) => (
                            <tr key={item.status}>
                              <td>
                                <StatusBadge status={item.status} size="sm" />
                              </td>
                              <td className="text-end">{formatNumber(item.count)}</td>
                              <td className="text-end money-cell">{formatBRL(item.loan_amount)}</td>
                              <td className="text-end money-cell">{formatBRL(item.profit_amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {loans.length === 0 ? (
                    <EmptyState
                      icon="bi-cash-coin"
                      title="Nenhum empréstimo encontrado"
                      message="Ajuste os filtros ou cadastre um empréstimo para analisá-lo aqui."
                    >
                      <Link to="/emprestimos/novo" className="btn btn-primary">
                        <i className="bi bi-plus-lg" /> Novo empréstimo
                      </Link>
                    </EmptyState>
                  ) : (
                    <>
                      <div className="table-responsive fp-table-wrap">
                        <table className="table fp-table report-table">
                          <thead>
                            <tr>
                              <th>Empréstimo</th>
                              <th>Cliente</th>
                              <th>Data</th>
                              <th>Situação</th>
                              <th className="text-end">Emprestado</th>
                              <th className="text-end">Recebido</th>
                              <th className="text-end">Lucro</th>
                              <th className="text-end">Parcelas</th>
                            </tr>
                          </thead>
                          <tbody>
                            {loansPage.slice.map((item) => (
                              <tr
                                key={item.id}
                                className="doc-row"
                                tabIndex={0}
                                role="link"
                                onClick={() => openLoan(item)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    openLoan(item)
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
                                <td>{formatDate(item.loan_date)}</td>
                                <td>
                                  <StatusBadge status={item.status} size="sm" />
                                </td>
                                <td className="text-end money-cell">{formatBRL(item.loan_amount)}</td>
                                <td className="text-end money-cell">{formatBRL(item.received_amount)}</td>
                                <td className="text-end money-cell">{formatBRL(item.profit_amount)}</td>
                                <td className="text-end">
                                  {formatNumber(item.totals?.installments || 0)}
                                  {item.totals?.overdue_installments > 0 && (
                                    <span className="cell-sub text-danger">
                                      {formatNumber(item.totals.overdue_installments)} vencida(s)
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination meta={loansPage.meta} onChange={loansPage.setPage} />

                      {installments.length > 0 && (
                        <Panel
                          title="Parcelas"
                          subtitle={`${formatNumber(installments.length)} parcela(s) dos empréstimos filtrados.`}
                          icon="bi-calendar2-check"
                        >
                          <div className="table-responsive fp-table-wrap">
                            <table className="table fp-table report-table">
                              <thead>
                                <tr>
                                  <th>Empréstimo</th>
                                  <th>Cliente</th>
                                  <th>Parcela</th>
                                  <th>Vencimento</th>
                                  <th>Situação</th>
                                  <th className="text-end">Valor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {installmentsPage.slice.map((item) => (
                                  <tr key={`${item.loan_id}-${item.id}`}>
                                    <td>{item.loan_code || '—'}</td>
                                    <td>{item.client_name || '—'}</td>
                                    <td>{String(item.number).padStart(2, '0')}</td>
                                    <td>
                                      <span className={item.is_overdue ? 'date-overdue' : ''}>
                                        {formatDate(item.due_date)}
                                      </span>
                                    </td>
                                    <td>
                                      <StatusBadge status={item.status} overdue={item.is_overdue} size="sm" />
                                    </td>
                                    <td className="text-end money-cell">{formatBRL(item.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <Pagination meta={installmentsPage.meta} onChange={installmentsPage.setPage} />
                        </Panel>
                      )}

                      <p className="report-caption">
                        Valores emprestados, recebidos e lucro são informados e gravados exatamente como
                        digitados. As parcelas são uma sugestão editável de vencimentos — o sistema não calcula
                        juros, taxas ou encargos. Empréstimos excluídos logicamente não entram no relatório.
                      </p>
                    </>
                  )}
                </div>
              )}

              {tab === 'operacoes' && (
                <div className="report-stack">
                  {operations.length === 0 ? (
                    <EmptyState
                      icon="bi-arrow-left-right"
                      title="Nenhuma operação no período"
                      message="As operações agrupam cheques e boletos de um mesmo cliente."
                    />
                  ) : (
                    <>
                      <div className="table-responsive fp-table-wrap">
                        <table className="table fp-table report-table">
                          <thead>
                            <tr>
                              <th>Código</th>
                              <th>Cliente</th>
                              <th>Data</th>
                              <th className="text-end">Títulos</th>
                              <th className="text-end">Nominal</th>
                              <th className="text-end">Líquido</th>
                              <th>Situação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {operationsPage.slice.map((item) => (
                              <tr
                                key={item.id}
                                className="doc-row"
                                tabIndex={0}
                                role="link"
                                onClick={() => navigate(`/operacoes/${item.id}`)}
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
                                  <span className="cell-strong">{item.client_name || item.client?.name || '—'}</span>
                                  {(item.client_code || item.client?.code) && (
                                    <span className="cell-sub">{item.client_code || item.client.code}</span>
                                  )}
                                </td>
                                <td>{formatDate(item.operation_date)}</td>
                                <td className="text-end">{formatNumber(item.documents_count)}</td>
                                <td className="text-end money-cell">{formatBRL(item.totals?.nominal)}</td>
                                <td className="text-end money-cell">{formatBRL(item.totals?.net)}</td>
                                <td>
                                  <StatusBadge status={item.status} size="sm" />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination meta={operationsPage.meta} onChange={operationsPage.setPage} />
                    </>
                  )}
                </div>
              )}

              {tab === 'recebimentos' && (
                <div className="report-stack">
                  {receipts.length === 0 ? (
                    <EmptyState
                      icon="bi-cash-coin"
                      title="Nenhum recebimento no período"
                      message="As baixas são registradas manualmente na tela de recebimentos."
                    >
                      <Link to="/recebimentos" className="btn btn-primary">
                        <i className="bi bi-arrow-right" /> Ir para recebimentos
                      </Link>
                    </EmptyState>
                  ) : (
                    <>
                      <div className="table-responsive fp-table-wrap">
                        <table className="table fp-table report-table">
                          <thead>
                            <tr>
                              <th>Código</th>
                              <th>Título</th>
                              <th>Cliente</th>
                              <th>Data</th>
                              <th className="text-end">Valor recebido</th>
                              <th className="text-end">Líquido do título</th>
                              <th className="text-end">Saldo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {receiptsPage.slice.map((item) => (
                              <tr
                                key={item.id}
                                className="doc-row"
                                tabIndex={0}
                                role="link"
                                onClick={() => navigate(`/recebimentos/${item.id}`)}
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
                                    <i
                                      className={`bi ${
                                        item.document_kind === 'BOLETO' ? 'bi-receipt' : 'bi-journal-check'
                                      }`}
                                    />{' '}
                                    {item.document_label}
                                  </span>
                                  {item.document_code && <span className="cell-sub">{item.document_code}</span>}
                                </td>
                                <td>
                                  <span className="cell-strong">{item.client?.name || '—'}</span>
                                  {item.client?.code && <span className="cell-sub">{item.client.code}</span>}
                                </td>
                                <td>{formatDate(item.receipt_date)}</td>
                                <td className="text-end money-cell">{formatBRL(item.amount)}</td>
                                <td className="text-end money-cell">{formatBRL(item.document_net)}</td>
                                <td className="text-end money-cell">{formatBRL(item.remaining_amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination meta={receiptsPage.meta} onChange={receiptsPage.setPage} />
                      <p className="report-caption">
                        Cada recebimento é uma baixa manual com data e valor informados. O sistema apenas
                        compara o valor recebido com o líquido do título para exibir o saldo.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <Modal
        open={waOpen}
        onClose={closeWhatsApp}
        title="Mensagem para WhatsApp"
        subtitle={waData?.client?.name || 'Títulos em aberto do cliente'}
        icon="bi-whatsapp"
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={closeWhatsApp}>
              Fechar
            </button>
            <button type="button" className="btn btn-outline-secondary" onClick={copyMessage} disabled={!waMessage}>
              <i className="bi bi-clipboard" /> Copiar
            </button>
            <a
              className={`btn btn-primary ${whatsappUrl ? '' : 'disabled'}`}
              href={whatsappUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (!whatsappUrl) {
                  event.preventDefault()
                  toast.warning('Telefone não informado', 'Cadastre o WhatsApp do cliente para abrir a conversa.')
                }
              }}
              aria-disabled={!whatsappUrl}
            >
              <i className="bi bi-whatsapp" /> Abrir WhatsApp
            </a>
          </>
        }
      >
        {waLoading ? (
          <LoadingBlock label="Preparando a mensagem…" />
        ) : waError ? (
          <ErrorBlock message={waError} />
        ) : (
          <>
            <div className="report-wa-meta">
              <span>
                <i className="bi bi-collection" /> {formatNumber(waData?.documents_count || 0)} título(s) em
                aberto
              </span>
              {(waData?.loans_count || 0) > 0 && (
                <span>
                  <i className="bi bi-cash-coin" /> {formatNumber(waData.loans_count)} empréstimo(s) ·{' '}
                  {formatNumber(waData.installments_count || 0)} parcela(s)
                </span>
              )}
              <span>
                <i className="bi bi-cash-stack" /> Total: <strong>{formatBRL(waData?.total || 0)}</strong>
              </span>
              <span>
                <i className="bi bi-telephone" /> {waData?.phone || 'Telefone não informado'}
              </span>
            </div>
            <label className="fp-label" htmlFor="report-wa-message">
              Texto da mensagem (editável)
            </label>
            <textarea
              id="report-wa-message"
              className="form-control fp-input report-wa-text"
              rows={12}
              value={waMessage}
              onChange={(event) => setWaMessage(event.target.value)}
            />
            <div className="info-note">
              <i className="bi bi-shield-check" />
              <div>
                <strong>Nada é enviado automaticamente</strong>
                <p>
                  Revise o texto e abra a conversa no WhatsApp. O sistema não dispara mensagens nem armazena
                  conversas.
                </p>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
