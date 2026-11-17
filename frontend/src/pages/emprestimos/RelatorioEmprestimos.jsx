import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Chart from 'react-apexcharts'
import { loansApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
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
  formatDateTime,
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

const STATUS_OPTIONS = [
  { value: '', label: 'Todas as situações' },
  { value: 'ABERTA', label: 'Aberta' },
  { value: 'QUITADA', label: 'Quitada' },
  { value: 'CANCELADA', label: 'Cancelada' },
]

const TABS = [
  { key: 'geral', label: 'Visão geral', icon: 'bi-grid-1x2' },
  { key: 'clientes', label: 'Clientes e limites', icon: 'bi-people' },
  { key: 'emprestimos', label: 'Empréstimos', icon: 'bi-cash-coin' },
  { key: 'parcelas', label: 'Parcelas', icon: 'bi-calendar2-range' },
]

const STATUS_COLORS = {
  ABERTA: '#E0A106',
  QUITADA: '#16845B',
  CANCELADA: '#7C8C86',
}

const EMPTY_FILTERS = {
  date_from: '',
  date_to: '',
  client: null,
  status: '',
  search: '',
}

function emptyReport() {
  return {
    cards: {},
    by_status: [],
    by_month: [],
    clients: [],
    loans: [],
    installments: [],
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
  if (filters.status) params.status = filters.status
  if (filters.search?.trim()) params.search = filters.search.trim()
  return params
}

function useLocalPage(rows) {
  const [page, setPage] = useState(1)
  const total = rows.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const current = Math.min(page, pages)
  const meta = total ? { page: current, pages, total, per_page: PAGE_SIZE } : null
  return {
    meta,
    setPage,
    slice: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
  }
}

export default function RelatorioEmprestimos() {
  const navigate = useNavigate()
  const { isDark } = useTheme()
  const toast = useToast()
  const { canWrite } = useAuth()

  const [tab, setTab] = useState('geral')
  const [preset, setPreset] = useState('all')
  const [draft, setDraft] = useState(EMPTY_FILTERS)
  const [applied, setApplied] = useState(EMPTY_FILTERS)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState('')

  const [waOpen, setWaOpen] = useState(false)
  const [waLoading, setWaLoading] = useState(false)
  const [waData, setWaData] = useState(null)
  const [waMessage, setWaMessage] = useState('')
  const [waError, setWaError] = useState('')

  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailResult, setEmailResult] = useState(null)
  const [emailError, setEmailError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await loansApi.report(buildQuery(applied))
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
  const clients = report.clients || []
  const loans = report.loans || []
  const installments = report.installments || []

  const clientsPage = useLocalPage(clients)
  const loansPage = useLocalPage(loans)
  const installmentsPage = useLocalPage(installments)

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
      },
      theme: { mode: chartsTheme },
      colors: ['#16845B', '#173B57', '#E0A106'],
      plotOptions: { bar: { columnWidth: '55%', borderRadius: 5, borderRadiusApplication: 'end' } },
      dataLabels: { enabled: false },
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
      noData: { text: 'Nenhum empréstimo no período', style: { color: textColor } },
    }),
    [chartsTheme, report.by_month, textColor, mutedLine],
  )

  const monthlySeries = useMemo(
    () => [
      { name: 'Emprestado', data: report.by_month.map((item) => Number(item.loan_amount || 0)) },
      { name: 'Recebido', data: report.by_month.map((item) => Number(item.received_amount || 0)) },
      { name: 'Lucro informado', data: report.by_month.map((item) => Number(item.profit_amount || 0)) },
    ],
    [report.by_month],
  )

  const countOptions = useMemo(
    () => ({
      chart: {
        type: 'bar',
        background: 'transparent',
        fontFamily: 'inherit',
        toolbar: { show: false },
      },
      theme: { mode: chartsTheme },
      colors: ['#173B57'],
      plotOptions: { bar: { columnWidth: '48%', borderRadius: 5, borderRadiusApplication: 'end' } },
      dataLabels: { enabled: true, style: { colors: ['#173B57'] } },
      grid: { borderColor: mutedLine, strokeDashArray: 4 },
      xaxis: {
        categories: report.by_month.map((item) => item.label),
        labels: { style: { colors: textColor }, rotate: -35, rotateAlways: false },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: { style: { colors: textColor }, formatter: (value) => formatNumber(value) },
      },
      legend: { show: false },
      tooltip: { y: { formatter: (value) => `${formatNumber(value)} empréstimo(s)` } },
      noData: { text: 'Sem quantidades no período', style: { color: textColor } },
    }),
    [chartsTheme, report.by_month, textColor, mutedLine],
  )

  const countSeries = useMemo(
    () => [{ name: 'Empréstimos', data: report.by_month.map((item) => Number(item.count || 0)) }],
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
    [chartsTheme, report.by_status, cards.loans_count, textColor, isDark],
  )

  const statusSeries = useMemo(
    () => report.by_status.map((item) => Number(item.count || 0)),
    [report.by_status],
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
  }

  const exportReport = async (format) => {
    setExporting(format)
    try {
      const query = buildQuery(applied)
      if (format === 'pdf') await loansApi.exportPdf(query)
      else await loansApi.exportXlsx(query)
      toast.success(
        `Relatório em ${format.toUpperCase()} gerado`,
        'A exportação foi registrada na auditoria do sistema.',
      )
    } catch (requestError) {
      toast.error('Não foi possível exportar', apiError(requestError).message)
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
      const response = await loansApi.whatsapp(client.id, buildQuery(applied))
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

  const openEmail = () => {
    setEmailOpen(true)
    setEmailError('')
    setEmailResult(null)
    setEmailTo('')
    setEmailMessage('')
  }

  const sendEmail = async () => {
    if (!emailTo.trim()) {
      toast.warning('Informe o destinatário', 'Digite um e-mail válido para enviar o resumo.')
      return
    }
    setEmailSending(true)
    setEmailError('')
    setEmailResult(null)
    try {
      const response = await loansApi.sendEmail(
        { to: emailTo.trim(), message: emailMessage.trim() || undefined },
        buildQuery(applied),
      )
      setEmailResult(response.data)
      setEmailMessage(response.data.preview || '')
      toast.success('Envio processado', response.data.message)
      load()
    } catch (requestError) {
      const parsed = apiError(requestError)
      setEmailError(parsed.errors?.to || parsed.message)
    } finally {
      setEmailSending(false)
    }
  }

  const copyMessage = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Mensagem copiada', 'Cole no aplicativo de sua preferência.')
    } catch {
      toast.warning('Não foi possível copiar', 'Selecione o texto e copie manualmente.')
    }
  }

  const periodLabel = describePeriod(applied.date_from, applied.date_to)
  const activeFilterCount = [
    applied.client?.id,
    applied.status,
    applied.search?.trim(),
    applied.date_from || applied.date_to,
  ].filter(Boolean).length

  const tabCounts = {
    clientes: clients.length,
    emprestimos: loans.length,
    parcelas: installments.length,
  }

  return (
    <div className="page">
      <div className="no-print">
        <PageHeader
          title="Relatório de Empréstimos"
          subtitle="Resumo por período, cliente e situação, com valores informados e parcelas derivadas dos lançamentos reais."
          icon="bi-graph-up-arrow"
        >
          <button type="button" className="btn btn-light" onClick={load} disabled={loading}>
            <i className={`bi ${loading ? 'arrow-repeat spin' : 'arrow-clockwise'}`} /> Atualizar
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => window.print()}>
            <i className="bi bi-printer" /> Imprimir
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
            <i className={`bi ${exporting === 'xlsx' ? 'arrow-repeat spin' : 'file-earmark-spreadsheet'}`} /> Planilha
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
              <span>Situação</span>
              <select
                className="form-select fp-input"
                value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value })}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="filter-search">
              <i className="bi bi-search" />
              <input
                type="search"
                className="form-control fp-input"
                placeholder="Buscar por cliente, código, CPF/CNPJ…"
                value={draft.search}
                onChange={(event) => setDraft({ ...draft, search: event.target.value })}
                aria-label="Buscar no relatório de empréstimos"
              />
            </div>
            <button type="submit" className="btn btn-outline-primary">
              <i className="bi bi-funnel" /> Aplicar
            </button>
            <button type="button" className="btn btn-light" onClick={clearFilters}>
              Limpar
            </button>
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
                <i className="bi bi-clock" /> Gerado em {formatDateTime(report.generated_at)}
              </span>
            )}
          </div>
        </form>

        {error && !loading && <ErrorBlock message={error} onRetry={load} />}

        {loading && !data ? (
          <LoadingBlock label="Consolidando o relatório de empréstimos…" />
        ) : (
          <>
            <div className="stat-grid">
              <StatCard
                label="Empréstimos"
                value={formatNumber(cards.loans_count || 0)}
                hint={`${formatNumber(cards.clients_count || 0)} cliente(s) no período.`}
                icon="bi-cash-coin"
                tone="petroleum"
                loading={loading}
              />
              <StatCard
                label="Valor emprestado"
                value={formatBRL(cards.loan_amount_total || 0)}
                hint="Soma exata dos valores informados."
                icon="bi-cash-stack"
                tone="light"
                loading={loading}
              />
              <StatCard
                label="Recebido pelo cliente"
                value={formatBRL(cards.received_amount_total || 0)}
                hint="Valor repassado informado."
                icon="bi-wallet2"
                tone="green"
                loading={loading}
              />
              <StatCard
                label="Lucro informado"
                value={formatBRL(cards.profit_total || 0)}
                hint="Nenhum cálculo automático."
                icon="bi-graph-up"
                tone="green"
                loading={loading}
              />
              <StatCard
                label="Saldo em parcelas"
                value={formatBRL(cards.open_amount_total || 0)}
                hint={`${formatNumber(cards.overdue_installments || 0)} parcela(s) vencida(s).`}
                icon="bi-hourglass-split"
                tone="warning"
                loading={loading}
              />
              <StatCard
                label="Divergências"
                value={formatNumber(cards.divergences_count || 0)}
                hint={`${formatNumber(cards.limits_exceeded_count || 0)} cliente(s) acima do limite.`}
                icon="bi-exclamation-diamond"
                tone="danger"
                loading={loading}
              />
            </div>

            <div className="fp-panel settings-shell">
              <div className="fp-tabs" role="tablist" aria-label="Seções do relatório de empréstimos">
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
                      <Panel title="Movimento mensal" subtitle="Valores informados por mês." icon="bi-bar-chart">
                        <Chart
                          key={`loan-values-${chartsTheme}-${report.by_month.length}`}
                          options={monthlyOptions}
                          series={monthlySeries}
                          type="bar"
                          height={300}
                        />
                      </Panel>
                      <Panel title="Situação dos empréstimos" subtitle="Quantidade por situação." icon="bi-pie-chart">
                        <Chart
                          key={`loan-status-${chartsTheme}-${report.by_status.length}`}
                          options={statusOptions}
                          series={statusSeries}
                          type="donut"
                          height={300}
                        />
                      </Panel>
                    </div>
                    <Panel title="Quantidade de empréstimos por mês" subtitle="Volume de lançamentos." icon="bi-collection">
                      <Chart
                        key={`loan-count-${chartsTheme}-${report.by_month.length}`}
                        options={countOptions}
                        series={countSeries}
                        type="bar"
                        height={240}
                      />
                    </Panel>
                  </div>
                )}

                {tab === 'clientes' && (
                  <Panel
                    title="Clientes e limites"
                    subtitle="Exposição calculada com as parcelas em aberto dos empréstimos."
                    icon="bi-people"
                    padded={false}
                  >
                    {clients.length === 0 ? (
                      <EmptyState icon="bi-people" title="Nenhum cliente no período" message="Ajuste os filtros para ver clientes." />
                    ) : (
                      <>
                        <div className="table-responsive fp-table-wrap">
                          <table className="table fp-table align-middle report-table">
                            <thead>
                              <tr>
                                <th>Cliente</th>
                                <th className="text-center">Empréstimos</th>
                                <th className="text-end">Emprestado</th>
                                <th className="text-end">Recebido</th>
                                <th className="text-end">Lucro</th>
                                <th className="text-end">Em aberto</th>
                                <th className="text-end">Limite</th>
                                <th className="text-end">Disponível</th>
                                <th aria-label="Ações" />
                              </tr>
                            </thead>
                            <tbody>
                              {clientsPage.slice.map((row) => (
                                <tr key={row.client_id}>
                                  <td>
                                    <span className="cell-strong">{row.name || '—'}</span>
                                    <span className="cell-sub">{row.code || `#${row.client_id}`}</span>
                                  </td>
                                  <td className="text-center">{formatNumber(row.loans)}</td>
                                  <td className="text-end money-cell">{formatBRL(row.loan_amount)}</td>
                                  <td className="text-end money-cell">{formatBRL(row.received_amount)}</td>
                                  <td className="text-end money-cell">{formatBRL(row.profit_amount)}</td>
                                  <td className="text-end money-cell">{formatBRL(row.open_amount)}</td>
                                  <td className="text-end money-cell">{formatBRL(row.operational_limit)}</td>
                                  <td className={`text-end money-cell ${row.limit_exceeded ? 'text-danger' : ''}`}>
                                    {formatBRL(row.available_limit)}
                                  </td>
                                  <td className="text-end">
                                    <div className="row-actions">
                                      {row.whatsapp && (
                                        <button
                                          type="button"
                                          className="icon-btn sm"
                                          title="Gerar mensagem de WhatsApp"
                                          onClick={() => openWhatsApp(row)}
                                        >
                                          <i className="bi bi-whatsapp" />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="icon-btn sm"
                                        title="Ver cliente"
                                        onClick={() => navigate(`/clientes/${row.client_id}`)}
                                      >
                                        <i className="bi bi-eye" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <Pagination meta={clientsPage.meta} onChange={clientsPage.setPage} />
                      </>
                    )}
                  </Panel>
                )}

                {tab === 'emprestimos' && (
                  <Panel title="Empréstimos" subtitle="Lançamentos conforme os filtros aplicados." icon="bi-cash-coin" padded={false}>
                    {loans.length === 0 ? (
                      <EmptyState icon="bi-cash-coin" title="Nenhum empréstimo no período" message="Ajuste os filtros ou registre um empréstimo." />
                    ) : (
                      <>
                        <div className="table-responsive fp-table-wrap">
                          <table className="table fp-table align-middle report-table">
                            <thead>
                              <tr>
                                <th>Código</th>
                                <th>Data</th>
                                <th>Cliente</th>
                                <th className="text-end">Emprestado</th>
                                <th className="text-end">Recebido</th>
                                <th className="text-end">Lucro</th>
                                <th className="text-center">Parcelas</th>
                                <th>Situação</th>
                                <th aria-label="Abrir" />
                              </tr>
                            </thead>
                            <tbody>
                              {loansPage.slice.map((row) => (
                                <tr key={row.id}>
                                  <td>
                                    <span className="doc-code">
                                      <i className="bi bi-cash-coin" /> {row.code}
                                    </span>
                                  </td>
                                  <td className="nowrap">{formatDate(row.loan_date)}</td>
                                  <td>{row.client?.name || '—'}</td>
                                  <td className="text-end money-cell">{formatBRL(row.loan_amount)}</td>
                                  <td className="text-end money-cell">{formatBRL(row.received_amount)}</td>
                                  <td className="text-end money-cell">{formatBRL(row.profit_amount)}</td>
                                  <td className="text-center">{formatNumber(row.totals?.installments || 0)}</td>
                                  <td>
                                    <StatusBadge status={row.status} size="sm" />
                                    {row.has_divergence && (
                                      <span className="cell-sub text-warning">divergência informada</span>
                                    )}
                                  </td>
                                  <td className="text-end">
                                    <i className="bi bi-chevron-right row-chevron" />
                                    <button
                                      type="button"
                                      className="btn btn-link btn-sm p-0 ms-1"
                                      onClick={() => navigate(`/emprestimos/${row.id}`)}
                                      aria-label={`Abrir empréstimo ${row.code}`}
                                    >
                                      Abrir
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <Pagination meta={loansPage.meta} onChange={loansPage.setPage} />
                      </>
                    )}
                  </Panel>
                )}

                {tab === 'parcelas' && (
                  <Panel title="Parcelas" subtitle="Vencimentos e saldos em aberto, sem qualquer recálculo." icon="bi-calendar2-range" padded={false}>
                    {installments.length === 0 ? (
                      <EmptyState icon="bi-calendar2-range" title="Nenhuma parcela no período" message="Ajuste os filtros para ver parcelas." />
                    ) : (
                      <>
                        <div className="table-responsive fp-table-wrap">
                          <table className="table fp-table align-middle report-table">
                            <thead>
                              <tr>
                                <th>Empréstimo</th>
                                <th>Cliente</th>
                                <th className="text-center">Parcela</th>
                                <th>Vencimento</th>
                                <th className="text-end">Valor</th>
                                <th>Situação</th>
                              </tr>
                            </thead>
                            <tbody>
                              {installmentsPage.slice.map((row) => (
                                <tr key={`${row.loan_id}-${row.id}`}>
                                  <td>{row.loan_code || `#${row.loan_id}`}</td>
                                  <td>{row.client_name || '—'}</td>
                                  <td className="text-center">{String(row.number).padStart(2, '0')}</td>
                                  <td className="nowrap">{formatDate(row.due_date)}</td>
                                  <td className="text-end money-cell">{formatBRL(row.amount)}</td>
                                  <td>
                                    <StatusBadge status={row.status} overdue={row.is_overdue} size="sm" />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <Pagination meta={installmentsPage.meta} onChange={installmentsPage.setPage} />
                      </>
                    )}
                  </Panel>
                )}
              </div>
            </div>

            <div className="report-share-bar">
              <div>
                <i className="bi bi-share" />
                <span>Compartilhar este resumo</span>
              </div>
              <div className="report-share-actions">
                <button type="button" className="btn btn-outline-success" onClick={() => {
                  const first = clients.find((row) => row.whatsapp)
                  if (first) openWhatsApp(first)
                  else toast.warning('Sem WhatsApp', 'Cadastre um telefone de WhatsApp no cliente para gerar a mensagem.')
                }}>
                  <i className="bi bi-whatsapp" /> WhatsApp
                </button>
                {canWrite && (
                  <button type="button" className="btn btn-outline-primary" onClick={openEmail}>
                    <i className="bi bi-envelope-paper" /> Enviar por e-mail
                  </button>
                )}
                <Link to="/emprestimos" className="btn btn-light">
                  <i className="bi bi-arrow-left" /> Voltar aos empréstimos
                </Link>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Visão de impressão: folhas limpas, com quebras controladas por CSS. */}
      <div className="report-print-only">
        <article className="print-sheet">
          <section className="print-page">
            <header className="loan-print-company print-section">
              <div>
                <strong>FACTOR PRO</strong>
                <span>Relatório de Empréstimos</span>
              </div>
            </header>
            <div className="loan-print-title print-section">
              <div>
                <span>Resumo gerado em {formatDateTime(report.generated_at)}</span>
                <h1>Relatório de Empréstimos</h1>
              </div>
              <div className="loan-print-number">
                <span>Período</span>
                <strong>{report.period_label || periodLabel}</strong>
              </div>
            </div>
            <div className="print-metrics print-section">
              <div className="print-metric">
                <span>Empréstimos</span>
                <strong>{formatNumber(cards.loans_count || 0)}</strong>
              </div>
              <div className="print-metric">
                <span>Valor emprestado</span>
                <strong>{formatBRL(cards.loan_amount_total || 0)}</strong>
              </div>
              <div className="print-metric">
                <span>Recebido</span>
                <strong>{formatBRL(cards.received_amount_total || 0)}</strong>
              </div>
              <div className="print-metric">
                <span>Lucro informado</span>
                <strong>{formatBRL(cards.profit_total || 0)}</strong>
              </div>
              <div className="print-metric">
                <span>Saldo em parcelas</span>
                <strong>{formatBRL(cards.open_amount_total || 0)}</strong>
              </div>
              <div className="print-metric">
                <span>Parcelas vencidas</span>
                <strong>{formatNumber(cards.overdue_installments || 0)}</strong>
              </div>
              <div className="print-metric">
                <span>Divergências</span>
                <strong>{formatNumber(cards.divergences_count || 0)}</strong>
              </div>
              <div className="print-metric">
                <span>Clientes</span>
                <strong>{formatNumber(cards.clients_count || 0)}</strong>
              </div>
            </div>
            <div className="print-section">
              <h2>Movimento mensal</h2>
              <table className="print-table">
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th className="text-end">Empréstimos</th>
                    <th className="text-end">Emprestado</th>
                    <th className="text-end">Recebido</th>
                    <th className="text-end">Lucro</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.by_month || []).map((row) => (
                    <tr key={row.month}>
                      <td>{row.label}</td>
                      <td className="text-end">{formatNumber(row.count)}</td>
                      <td className="text-end">{formatBRL(row.loan_amount)}</td>
                      <td className="text-end">{formatBRL(row.received_amount)}</td>
                      <td className="text-end">{formatBRL(row.profit_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="print-page">
            <div className="print-section">
              <h2>Clientes e limites</h2>
              <table className="print-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th className="text-end">Empréstimos</th>
                    <th className="text-end">Emprestado</th>
                    <th className="text-end">Lucro</th>
                    <th className="text-end">Em aberto</th>
                    <th className="text-end">Limite</th>
                    <th className="text-end">Disponível</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((row) => (
                    <tr key={row.client_id}>
                      <td>{row.name} <small>({row.code})</small></td>
                      <td className="text-end">{formatNumber(row.loans)}</td>
                      <td className="text-end">{formatBRL(row.loan_amount)}</td>
                      <td className="text-end">{formatBRL(row.profit_amount)}</td>
                      <td className="text-end">{formatBRL(row.open_amount)}</td>
                      <td className="text-end">{formatBRL(row.operational_limit)}</td>
                      <td className="text-end">{formatBRL(row.available_limit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="print-page">
            <div className="print-section">
              <h2>Empréstimos</h2>
              <table className="print-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Data</th>
                    <th>Cliente</th>
                    <th className="text-end">Emprestado</th>
                    <th className="text-end">Recebido</th>
                    <th className="text-end">Lucro</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map((row) => (
                    <tr key={row.id}>
                      <td>{row.code}</td>
                      <td>{formatDate(row.loan_date)}</td>
                      <td>{row.client?.name || '—'}</td>
                      <td className="text-end">{formatBRL(row.loan_amount)}</td>
                      <td className="text-end">{formatBRL(row.received_amount)}</td>
                      <td className="text-end">{formatBRL(row.profit_amount)}</td>
                      <td>{row.status_label || row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="print-page">
            <div className="print-section">
              <h2>Parcelas</h2>
              <table className="print-table">
                <thead>
                  <tr>
                    <th>Empréstimo</th>
                    <th>Cliente</th>
                    <th className="text-center">Parcela</th>
                    <th>Vencimento</th>
                    <th className="text-end">Valor</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {installments.map((row) => (
                    <tr key={`${row.loan_id}-${row.id}`}>
                      <td>{row.loan_code}</td>
                      <td>{row.client_name || '—'}</td>
                      <td className="text-center">{String(row.number).padStart(2, '0')}</td>
                      <td>{formatDate(row.due_date)}</td>
                      <td className="text-end">{formatBRL(row.amount)}</td>
                      <td>{row.status_label || row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="loan-print-foot">
              <span>Documento gerado pelo FACTOR PRO a partir de valores informados — sem cálculo automático.</span>
            </footer>
          </section>
        </article>
      </div>

      <Modal
        open={waOpen}
        onClose={closeWhatsApp}
        title="Mensagem de WhatsApp"
        subtitle={waData?.client ? `${waData.client.code} · ${waData.client.name}` : 'Resumo de empréstimos'}
        icon="bi-whatsapp"
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={closeWhatsApp}>
              Fechar
            </button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => copyMessage(waMessage)} disabled={!waMessage}>
              <i className="bi bi-clipboard" /> Copiar texto
            </button>
            {whatsappUrl && (
              <a className="btn btn-success" href={whatsappUrl} target="_blank" rel="noreferrer">
                <i className="bi bi-whatsapp" /> Abrir WhatsApp
              </a>
            )}
          </>
        }
      >
        {waLoading ? (
          <LoadingBlock label="Montando a mensagem…" />
        ) : waError ? (
          <ErrorBlock message={waError} />
        ) : (
          <>
            <div className="wa-summary">
              <span>
                Empréstimos <strong>{formatNumber(waData?.loans_count || 0)}</strong>
              </span>
              <span>
                Total <strong>{formatBRL(waData?.total)}</strong>
              </span>
              <span>
                Lucro <strong>{formatBRL(waData?.profit)}</strong>
              </span>
            </div>
            <label className="fp-field" htmlFor="loan-wa-message">
              <span className="fp-label">Texto editável</span>
              <textarea
                id="loan-wa-message"
                className="form-control fp-input"
                rows={12}
                value={waMessage}
                onChange={(event) => setWaMessage(event.target.value)}
              />
            </label>
            <p className="panel-hint">
              Nada é enviado automaticamente: revise o texto e confirme no WhatsApp.
            </p>
          </>
        )}
      </Modal>

      <Modal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        title="Enviar relatório por e-mail"
        subtitle="O texto é gerado com os filtros aplicados e pode ser revisado antes do envio."
        icon="bi-envelope-paper"
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={() => setEmailOpen(false)} disabled={emailSending}>
              Fechar
            </button>
            {emailResult && (
              <button type="button" className="btn btn-outline-secondary" onClick={() => copyMessage(emailMessage)}>
                <i className="bi bi-clipboard" /> Copiar texto
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={sendEmail} disabled={emailSending}>
              {emailSending ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Enviando…
                </>
              ) : (
                <>
                  <i className="bi bi-send" /> Enviar
                </>
              )}
            </button>
          </>
        }
      >
        <label className="fp-field" htmlFor="loan-email-to">
          <span className="fp-label">Destinatário</span>
          <input
            id="loan-email-to"
            type="email"
            className="form-control fp-input"
            placeholder="nome@empresa.com.br"
            value={emailTo}
            onChange={(event) => setEmailTo(event.target.value)}
          />
        </label>
        <label className="fp-field" htmlFor="loan-email-message">
          <span className="fp-label">Mensagem (opcional — deixe vazio para usar o resumo gerado)</span>
          <textarea
            id="loan-email-message"
            className="form-control fp-input"
            rows={10}
            value={emailMessage}
            onChange={(event) => setEmailMessage(event.target.value)}
          />
        </label>
        {emailError && (
          <div className="inline-alert danger">
            <i className="bi bi-exclamation-octagon-fill" /> {emailError}
          </div>
        )}
        {emailResult && (
          <div className={`inline-alert ${emailResult.email_sent ? 'success' : 'warning'}`}>
            <i className={`bi ${emailResult.email_sent ? 'bi-check-circle-fill' : 'bi-info-circle-fill'}`} />
            <span>
              <strong>{emailResult.subject}</strong>
              <br />
              {emailResult.message}
            </span>
          </div>
        )}
        <p className="panel-hint">
          O envio é registrado na auditoria. Se o SMTP não estiver configurado, o texto permanece disponível
          para conferência e cópia.
        </p>
      </Modal>
    </div>
  )
}
