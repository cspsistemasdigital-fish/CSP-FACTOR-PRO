import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Chart from 'react-apexcharts'
import { dashboardApi } from '../api'
import { apiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Panel from '../components/ui/Panel'
import DocumentsTable from '../components/documents/DocumentsTable'
import EmptyState from '../components/ui/EmptyState'
import { ErrorBlock, LoadingBlock } from '../components/ui/Feedback'
import ClientSelect from '../components/form/ClientSelect'
import {
  describePeriod,
  formatBRL,
  formatDate,
  formatNumber,
  presetRange,
  todayISO,
} from '../utils/format'

const PRESETS = [
  { key: 'all', label: 'Tudo' },
  { key: 'hoje', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'mes_atual', label: 'Mês atual' },
  { key: 'mes_anterior', label: 'Mês anterior' },
  { key: 'ano_atual', label: 'Ano atual' },
]

const STATUS_COLORS = {
  EM_ABERTO: '#E0A106',
  LIQUIDADO: '#16845B',
  DEVOLVIDO: '#C9463D',
  CANCELADO: '#7C8C86',
}

function emptySummary() {
  return {
    cards: {},
    by_type: [],
    by_status: [],
    by_month: [],
    top_clients: [],
    recent_receipts: [],
    overdue_documents: [],
    due_soon_documents: [],
    recent_documents: [],
    modules_pending: {},
  }
}

export default function Dashboard() {
  const { user } = useAuth()
  const { isDark } = useTheme()
  const toast = useToast()
  const [preset, setPreset] = useState('all')
  const [draft, setDraft] = useState({ from: '', to: '', client: null })
  const [applied, setApplied] = useState({ from: '', to: '', client: null })
  const [data, setData] = useState(emptySummary)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (applied.from) params.date_from = applied.from
      if (applied.to) params.date_to = applied.to
      if (applied.client?.id) params.client_id = applied.client.id
      const response = await dashboardApi.summary(params)
      setData(response.data)
    } catch (requestError) {
      const parsed = apiError(requestError)
      setError(parsed.message)
      toast.error('Falha ao carregar o dashboard', parsed.message)
    } finally {
      setLoading(false)
    }
  }, [applied, toast])

  useEffect(() => {
    load()
  }, [load])

  const cards = data.cards || {}
  const hasData = Number(cards.operations_total || 0) > 0

  const chartsTheme = isDark ? 'dark' : 'light'
  const textColor = isDark ? '#DCE9E3' : '#3B4F48'
  const mutedLine = isDark ? 'rgba(255,255,255,.10)' : '#E4ECE8'

  const donutOptions = useMemo(
    () => ({
      chart: { type: 'donut', background: 'transparent', fontFamily: 'inherit' },
      theme: { mode: chartsTheme },
      labels: (data.by_status || []).map((item) => item.label),
      colors: (data.by_status || []).map((item) => STATUS_COLORS[item.status] || '#7C8C86'),
      legend: { position: 'bottom', labels: { colors: textColor }, fontSize: '13px', markers: { size: 6 } },
      dataLabels: { enabled: false },
      stroke: { colors: [isDark ? '#16241F' : '#FFFFFF'], width: 3 },
      tooltip: { y: { formatter: (value) => `${formatNumber(value)} documento(s)` } },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: {
              show: true,
              total: {
                show: true,
                label: 'Documentos',
                color: textColor,
                formatter: () => formatNumber(cards.operations_total || 0),
              },
              value: { color: textColor, fontSize: '22px', fontWeight: 700 },
            },
          },
        },
      },
      noData: { text: 'Nenhum documento no período', style: { color: textColor } },
    }),
    [chartsTheme, data.by_status, cards.operations_total, textColor, isDark],
  )

  const barOptions = useMemo(
    () => ({
      chart: {
        type: 'bar',
        background: 'transparent',
        fontFamily: 'inherit',
        toolbar: { show: false },
        stacked: false,
      },
      theme: { mode: chartsTheme },
      colors: ['#16845B', '#173B57'],
      plotOptions: { bar: { columnWidth: '42%', borderRadius: 6, borderRadiusApplication: 'end' } },
      dataLabels: { enabled: false },
      stroke: { show: true, width: 0 },
      grid: { borderColor: mutedLine, strokeDashArray: 4 },
      xaxis: {
        categories: (data.by_type || []).map((item) => item.label),
        labels: { style: { colors: textColor } },
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
      noData: { text: 'Nenhum valor no período', style: { color: textColor } },
    }),
    [chartsTheme, data.by_type, textColor, mutedLine],
  )

  const barSeries = useMemo(
    () => [
      { name: 'Nominal', data: (data.by_type || []).map((item) => Number(item.nominal || 0)) },
      { name: 'Líquido', data: (data.by_type || []).map((item) => Number(item.net || 0)) },
    ],
    [data.by_type],
  )

  const monthlyOptions = useMemo(
    () => ({
      chart: {
        type: 'area',
        background: 'transparent',
        fontFamily: 'inherit',
        toolbar: { show: false },
      },
      theme: { mode: chartsTheme },
      colors: ['#16845B', '#E0A106'],
      stroke: { curve: 'smooth', width: 2 },
      fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
      dataLabels: { enabled: false },
      grid: { borderColor: mutedLine, strokeDashArray: 4 },
      xaxis: {
        categories: (data.by_month || []).map((item) => item.label),
        labels: { style: { colors: textColor } },
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
    [chartsTheme, data.by_month, textColor, mutedLine],
  )

  const monthlySeries = useMemo(
    () => [
      { name: 'Líquido lançado', data: (data.by_month || []).map((item) => Number(item.net || 0)) },
      { name: 'Recebido', data: (data.by_month || []).map((item) => Number(item.received || 0)) },
    ],
    [data.by_month],
  )

  const applyPreset = (key) => {
    setPreset(key)
    if (key === 'all') {
      const next = { from: '', to: '', client: draft.client }
      setDraft(next)
      setApplied({ from: '', to: '', client: next.client || null })
      return
    }
    const range = presetRange(key)
    setDraft({ ...draft, from: range.from, to: range.to })
    setApplied({ from: range.from, to: range.to, client: draft.client || null })
  }

  const applyFilters = (event) => {
    event.preventDefault()
    if (draft.from && draft.to && draft.from > draft.to) {
      toast.warning('Período inválido', 'A data inicial não pode ser maior que a data final.')
      return
    }
    setPreset('custom')
    setApplied({ from: draft.from, to: draft.to, client: draft.client || null })
  }

  const clearFilters = () => {
    setPreset('all')
    setDraft({ from: '', to: '', client: null })
    setApplied({ from: '', to: '', client: null })
  }

  const periodLabel = describePeriod(applied.from, applied.to)
  const selectedClientName = applied.client?.name

  return (
    <div className="page">
      <PageHeader
        title={`Olá, ${user?.name?.split(' ')[0] || 'bem-vindo'}`}
        subtitle="Visão consolidada de cheques, boletos e clientes. Todos os valores vêm dos lançamentos reais."
        icon="bi-grid-1x2-fill"
      >
        <button type="button" className="btn btn-light" onClick={load} disabled={loading}>
          <i className={`bi ${loading ? 'arrow-repeat spin' : 'arrow-clockwise'}`} /> Atualizar
        </button>
        <Link to="/cheques/novo" className="btn btn-primary">
          <i className="bi bi-plus-lg" /> Novo cheque
        </Link>
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
              value={draft.from}
              max={draft.to || todayISO()}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </label>
          <label className="filter-date">
            <span>Até</span>
            <input
              type="date"
              className="form-control fp-input"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </label>
          <div className="filter-client">
            <ClientSelect
              label="Cliente (opcional)"
              value={draft.client?.id || null}
              initialClient={draft.client}
              onChange={(client) => setDraft({ ...draft, client })}
              required={false}
              placeholder="Todos os clientes"
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
          <span>Período: <strong>{periodLabel}</strong></span>
          {selectedClientName && (
            <span className="filter-summary-client">
              <i className="bi bi-person" /> {selectedClientName}
            </span>
          )}
        </div>
      </form>

      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      <div className="stat-grid">
        <StatCard
          label="Ganhos registrados"
          value={formatBRL(cards.gains_registered || 0)}
          hint="Soma de descontos, juros e despesas informados por você."
          icon="bi-piggy-bank"
          tone="green"
          loading={loading}
          footer="Informado"
        />
        <StatCard
          label="Valor nominal total"
          value={formatBRL(cards.nominal_total || 0)}
          hint={`Cheques ${formatBRL(cards.cheques_nominal || 0)} · Boletos ${formatBRL(cards.boletos_nominal || 0)}`}
          icon="bi-cash-stack"
          tone="petroleum"
          loading={loading}
          footer={`${formatNumber(cards.operations_total || 0)} doc.`}
        />
        <StatCard
          label="Valor líquido informado"
          value={formatBRL(cards.paid_total || 0)}
          hint="Soma dos líquidos pagos aos clientes, exatamente como informados."
          icon="bi-wallet2"
          tone="green"
          loading={loading}
        />
        <StatCard
          label="Em aberto"
          value={formatBRL(cards.open_total || 0)}
          hint={`${formatNumber(cards.open_count || 0)} documento(s) com status em aberto ou devolvido.`}
          icon="bi-hourglass-split"
          tone="warning"
          loading={loading}
        />
        <StatCard
          label="Vencidos"
          value={formatBRL(cards.overdue_total || 0)}
          hint={`${formatNumber(cards.overdue_count || 0)} documento(s) pendente(s) com vencimento passado.`}
          icon="bi-exclamation-triangle"
          tone="danger"
          loading={loading}
        />
        <StatCard
          label="Vencendo em 30 dias"
          value={formatBRL(cards.due_soon_total || 0)}
          hint={`${formatNumber(cards.due_soon_count || 0)} documento(s) a vencer.`}
          icon="bi-calendar-event"
          tone="light"
          loading={loading}
        />
      </div>

      <div className="dash-grid-2">
        <Panel
          title="Composição por status"
          subtitle={`${formatNumber(cards.operations_total || 0)} documento(s) no período`}
          icon="bi-pie-chart"
        >
          {loading ? (
            <LoadingBlock label="Carregando gráfico…" />
          ) : (
            <Chart
              key={`donut-${chartsTheme}-${cards.operations_total}`}
              options={donutOptions}
              series={(data.by_status || []).map((item) => item.count)}
              type="donut"
              height={290}
            />
          )}
        </Panel>
        <Panel
          title="Nominal x líquido por tipo"
          subtitle="Comparação dos valores informados nos lançamentos."
          icon="bi-bar-chart"
        >
          {loading ? (
            <LoadingBlock label="Carregando gráfico…" />
          ) : (
            <Chart
              key={`bar-${chartsTheme}-${cards.operations_total}`}
              options={barOptions}
              series={barSeries}
              type="bar"
              height={290}
            />
          )}
        </Panel>
      </div>

      <Panel
        title="Movimento mensal"
        subtitle="Valor líquido lançado e efetivamente recebido em cada mês."
        icon="bi-graph-up"
        actions={
          <Link to="/relatorios" className="btn btn-sm btn-light">
            Relatórios <i className="bi bi-arrow-right" />
          </Link>
        }
      >
        {loading ? (
          <LoadingBlock label="Carregando gráfico…" />
        ) : (
          <Chart
            key={`monthly-${chartsTheme}-${(data.by_month || []).length}`}
            options={monthlyOptions}
            series={monthlySeries}
            type="area"
            height={280}
          />
        )}
      </Panel>

      <div className="dash-grid-2">
        <Panel
          title="Carteira por cliente"
          subtitle="Maiores saldos em aberto, derivados dos títulos pendentes."
          icon="bi-people"
        >
          {(data.top_clients || []).length === 0 ? (
            <EmptyState
              icon="bi-people"
              title="Nenhum saldo em aberto"
              message="Todos os títulos estão liquidados ou ainda não há lançamentos."
            />
          ) : (
            <ul className="dash-list">
              {(data.top_clients || []).map((row) => (
                <li key={row.id}>
                  <Link to={`/clientes/${row.id}`} className="dash-list-item">
                    <span className="dash-list-icon">
                      <i className="bi bi-building" />
                    </span>
                    <span className="dash-list-main">
                      <strong>{row.name}</strong>
                      <small>
                        {row.code} · {formatNumber(row.open_documents)} título(s)
                        {row.limit_exceeded ? ' · acima do limite' : ''}
                      </small>
                    </span>
                    <span className="dash-list-value">
                      <strong>{formatBRL(row.open_amount)}</strong>
                      <small>Disponível {formatBRL(row.available_limit)}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Últimos recebimentos"
          subtitle="Baixas manuais registradas recentemente."
          icon="bi-cash-coin"
          actions={
            <Link to="/recebimentos" className="btn btn-sm btn-light">
              Ver todos <i className="bi bi-arrow-right" />
            </Link>
          }
        >
          {(data.recent_receipts || []).length === 0 ? (
            <EmptyState
              icon="bi-cash-coin"
              title="Nenhum recebimento registrado"
              message="As baixas são lançadas manualmente na tela de recebimentos."
            />
          ) : (
            <ul className="dash-list">
              {(data.recent_receipts || []).map((item) => (
                <li key={item.id}>
                  <Link to={`/recebimentos/${item.id}`} className="dash-list-item">
                    <span className="dash-list-icon">
                      <i className="bi bi-cash-coin" />
                    </span>
                    <span className="dash-list-main">
                      <strong>{item.client?.name || item.code}</strong>
                      <small>
                        {item.document_label}
                        {item.document_code ? ` · ${item.document_code}` : ''} ·{' '}
                        {formatDate(item.receipt_date)}
                      </small>
                    </span>
                    <span className="dash-list-value">
                      <strong>{formatBRL(item.amount)}</strong>
                      <small>{item.code}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="dash-grid-2">
        <Panel
          title="Documentos vencidos"
          subtitle="Pendentes com vencimento anterior a hoje."
          icon="bi-exclamation-triangle"
          actions={
            <Link to="/cheques?status=VENCIDO" className="btn btn-sm btn-light">
              Ver cheques <i className="bi bi-arrow-right" />
            </Link>
          }
          padded={false}
        >
          <DocumentsTable
            items={data.overdue_documents || []}
            mixed
            compact
            emptyTitle="Nenhum documento vencido"
            emptyMessage="Não há pendências vencidas para o período selecionado."
          />
        </Panel>
        <Panel
          title="Vencendo em até 30 dias"
          subtitle="Pendentes com vencimento próximo."
          icon="bi-calendar-event"
          actions={
            <Link to="/boletos" className="btn btn-sm btn-light">
              Ver boletos <i className="bi bi-arrow-right" />
            </Link>
          }
          padded={false}
        >
          <DocumentsTable
            items={data.due_soon_documents || []}
            mixed
            compact
            emptyTitle="Nada a vencer em 30 dias"
            emptyMessage="Nenhum documento pendente vence nos próximos 30 dias."
          />
        </Panel>
      </div>

      <Panel
        title="Últimos lançamentos"
        subtitle="Cheques e boletos mais recentes pela data da operação."
        icon="bi-clock-history"
        padded={false}
      >
        <DocumentsTable
          items={data.recent_documents || []}
          mixed
          compact
          emptyTitle="Nenhum lançamento ainda"
          emptyMessage={
            hasData
              ? 'Nenhum lançamento no período selecionado.'
              : 'Cadastre o primeiro cheque ou boleto para começar a acompanhar sua carteira.'
          }
        />
      </Panel>

      <section className="stage-banner">
        <div className="stage-banner-icon">
          <i className="bi bi-check2-circle" />
        </div>
        <div className="stage-banner-body">
          <strong>Etapa 3 concluída: relatórios, exportações e WhatsApp</strong>
          <p>
            Consolide a carteira por período, cliente, tipo e situação, exporte em PDF ou planilha e prepare
            mensagens revisáveis para o WhatsApp. Nenhum valor é calculado automaticamente e nada é enviado
            sem a sua revisão.
          </p>
          <div className="stage-banner-links">
            <Link to="/relatorios">
              <i className="bi bi-graph-up-arrow" /> Abrir relatórios
            </Link>
            <Link to="/operacoes">
              <i className="bi bi-arrow-left-right" /> Operações
            </Link>
            <Link to="/recebimentos">
              <i className="bi bi-cash-coin" /> Recebimentos
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
