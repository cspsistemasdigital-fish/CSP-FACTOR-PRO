import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { loansApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import PageHeader from '../../components/ui/PageHeader'
import Panel from '../../components/ui/Panel'
import SummaryTile from '../../components/ui/SummaryTile'
import StatusBadge from '../../components/ui/StatusBadge'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import EmptyState from '../../components/ui/EmptyState'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import {
  formatBRL,
  formatDate,
  formatDateTime,
  formatDocument,
  formatNumber,
} from '../../utils/format'

const LOAN_STATUS_OPTIONS = [
  { value: 'ABERTA', label: 'Aberta' },
  { value: 'QUITADA', label: 'Quitada' },
  { value: 'CANCELADA', label: 'Cancelada' },
]

const INSTALLMENT_STATUS_OPTIONS = [
  { value: 'EM_ABERTO', label: 'Em aberto' },
  { value: 'LIQUIDADO', label: 'Liquidado' },
  { value: 'DEVOLVIDO', label: 'Devolvido' },
  { value: 'CANCELADO', label: 'Cancelado' },
]

function actionMeta(action) {
  switch (action) {
    case 'CREATE':
      return { label: 'Criação', variant: 'success' }
    case 'UPDATE':
      return { label: 'Atualização', variant: 'warning' }
    case 'DELETE':
      return { label: 'Exclusão', variant: 'danger' }
    case 'STATUS_CHANGE':
      return { label: 'Situação', variant: 'petroleum' }
    default:
      return { label: action || 'Evento', variant: 'neutral' }
  }
}

function formatChangeValue(value) {
  if (Array.isArray(value) && value.length === 2) return `${value[0] ?? '—'} → ${value[1] ?? '—'}`
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value ?? '—')
}

export default function EmprestimoDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { canWrite, isAdmin } = useAuth()
  const [item, setItem] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [changingInstallment, setChangingInstallment] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await loansApi.get(id)
      setItem(data.item)
      setHistory(data.history || [])
      setStatus(data.item.status)
    } catch (requestError) {
      setError(apiError(requestError).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const applyStatus = async () => {
    if (!status || status === item.status) return
    setUpdatingStatus(true)
    try {
      const { data } = await loansApi.changeStatus(item.id, status)
      setItem(data.item)
      toast.success('Situação atualizada', data.message)
      load()
    } catch (requestError) {
      const parsed = apiError(requestError)
      toast.error('Não foi possível alterar', parsed.errors?.status || parsed.message)
      setStatus(item.status)
    } finally {
      setUpdatingStatus(false)
    }
  }

  const applyInstallmentStatus = async (installment, nextStatus) => {
    if (nextStatus === installment.status) return
    setChangingInstallment(installment.id)
    try {
      const { data } = await loansApi.changeInstallmentStatus(item.id, installment.id, nextStatus)
      setItem(data.item)
      toast.success('Parcela atualizada', data.message)
      load()
    } catch (requestError) {
      toast.error('Não foi possível alterar a parcela', apiError(requestError).message)
    } finally {
      setChangingInstallment(null)
    }
  }

  const removeLoan = async () => {
    setDeleting(true)
    try {
      await loansApi.remove(item.id)
      toast.success('Empréstimo excluído', 'A exclusão lógica foi registrada na auditoria.')
      navigate('/emprestimos', { replace: true })
    } catch (requestError) {
      toast.error('Não foi possível excluir', apiError(requestError).message)
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Carregando empréstimo…" />
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="page">
        <ErrorBlock message={error || 'Empréstimo não encontrado.'} onRetry={load} />
      </div>
    )
  }

  const totals = item.totals || {}
  const limit = item.limit || {}
  const installments = item.installments || []

  return (
    <div className="page">
      <PageHeader
        title={`Empréstimo ${item.code}`}
        subtitle={`${item.client?.name || 'Cliente não informado'} · ${formatDate(item.loan_date)}`}
        icon="bi-cash-coin"
        badge={<StatusBadge status={item.status} />}
      >
        <Link to="/emprestimos" className="btn btn-light">
          <i className="bi bi-arrow-left" /> Voltar
        </Link>
        <Link to={`/emprestimos/${item.id}/duplicata`} className="btn btn-outline-secondary">
          <i className="bi bi-printer" /> Duplicata
        </Link>
        {canWrite && (
          <Link to={`/emprestimos/${item.id}/editar`} className="btn btn-outline-primary">
            <i className="bi bi-pencil" /> Editar
          </Link>
        )}
        {isAdmin && (
          <button type="button" className="btn btn-outline-danger" onClick={() => setConfirmDelete(true)}>
            <i className="bi bi-trash3" /> Excluir
          </button>
        )}
      </PageHeader>

      <div className="stats-strip">
        <SummaryTile
          label="Valor emprestado"
          value={formatBRL(item.loan_amount)}
          icon="bi-cash-stack"
          tone="petroleum"
          hint="Informado no cadastro"
        />
        <SummaryTile
          label="Recebido pelo cliente"
          value={formatBRL(item.received_amount)}
          icon="bi-wallet2"
          tone="green"
          hint="Informado no cadastro"
        />
        <SummaryTile
          label="Lucro informado"
          value={formatBRL(item.profit_amount)}
          icon="bi-graph-up"
          tone="green"
          hint="Nenhum cálculo automático"
        />
        <SummaryTile
          label="Saldo em parcelas"
          value={formatBRL(totals.open_amount)}
          icon="bi-hourglass-split"
          tone="warning"
          hint={`${formatNumber(totals.overdue_installments || 0)} parcela(s) vencida(s)`}
        />
      </div>

      {item.has_divergence && (
        <div className="inline-alert warning">
          <i className="bi bi-exclamation-triangle-fill" />
          <span>
            Divergência informativa: (valor emprestado − lucro) difere do valor recebido pelo cliente em{' '}
            <strong>{formatBRL(item.divergence)}</strong>. Os valores foram gravados exatamente como digitados.
          </span>
        </div>
      )}

      <div className="detail-layout">
        <div className="detail-main">
          <Panel title="Dados do empréstimo" icon="bi-card-list">
            <dl className="detail-grid">
              <div>
                <dt>Cliente</dt>
                <dd>
                  {item.client ? (
                    <Link to={`/clientes/${item.client.id}`} className="inline-link">
                      {item.client.code} · {item.client.name}
                    </Link>
                  ) : (
                    '—'
                  )}
                  {item.client?.document && (
                    <span className="cell-sub">{formatDocument(item.client.document)}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Data do empréstimo</dt>
                <dd>{formatDate(item.loan_date)}</dd>
              </div>
              <div>
                <dt>Situação</dt>
                <dd>
                  <StatusBadge status={item.status} size="sm" />
                </dd>
              </div>
              <div>
                <dt>Parcelas geradas</dt>
                <dd>
                  {formatNumber(totals.installments || 0)} · programado {formatBRL(totals.scheduled)}
                </dd>
              </div>
              <div className="span-2">
                <dt>Observações</dt>
                <dd>{item.notes || '—'}</dd>
              </div>
              <div>
                <dt>Criado por</dt>
                <dd>
                  {item.created_by || '—'}
                  <span className="cell-sub">{formatDateTime(item.created_at)}</span>
                </dd>
              </div>
              <div>
                <dt>Última atualização</dt>
                <dd>
                  {item.updated_by || '—'}
                  <span className="cell-sub">{formatDateTime(item.updated_at)}</span>
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel
            title="Parcelas"
            subtitle="Vencimentos e valores informados. A situação de cada parcela pode ser alterada manualmente."
            icon="bi-calendar2-range"
            padded={false}
          >
            {installments.length === 0 ? (
              <EmptyState
                icon="bi-calendar2-x"
                title="Nenhuma parcela"
                message="Edite o empréstimo para gerar os vencimentos."
              />
            ) : (
              <div className="table-responsive fp-table-wrap">
                <table className="table fp-table align-middle">
                  <thead>
                    <tr>
                      <th>Nº</th>
                      <th>Vencimento</th>
                      <th className="text-end">Valor</th>
                      <th>Situação</th>
                      <th>Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {installments.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <span className="type-chip">{String(entry.number).padStart(2, '0')}</span>
                        </td>
                        <td className="nowrap">
                          {formatDate(entry.due_date)}
                          {entry.is_overdue && (
                            <span className="cell-sub text-danger">
                              <i className="bi bi-exclamation-triangle-fill" /> vencida
                            </span>
                          )}
                        </td>
                        <td className="text-end money-cell">{formatBRL(entry.amount)}</td>
                        <td>
                          <StatusBadge status={entry.status} overdue={entry.is_overdue} size="sm" />
                          {canWrite && (
                            <select
                              className="form-select fp-input form-select-sm mt-1"
                              value={entry.status}
                              disabled={changingInstallment === entry.id}
                              onChange={(event) => applyInstallmentStatus(entry, event.target.value)}
                              aria-label={`Situação da parcela ${entry.number}`}
                            >
                              {INSTALLMENT_STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td>{entry.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={2} className="text-end">Total programado</th>
                      <th className="money-cell">{formatBRL(totals.scheduled)}</th>
                      <th colSpan={2}>Em aberto: {formatBRL(totals.open_amount)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Histórico e auditoria" subtitle="Registro imutável das alterações deste empréstimo." icon="bi-clock-history">
            {history.length ? (
              <ol className="timeline compact">
                {history.map((entry) => {
                  const meta = actionMeta(entry.action)
                  return (
                    <li className="timeline-item" key={entry.id}>
                      <span className="timeline-dot">
                        <i className="bi bi-shield-check" />
                      </span>
                      <div className="timeline-content">
                        <div className="timeline-head">
                          <strong>{entry.description || entry.action}</strong>
                          <span className={`fp-badge fp-badge-${meta.variant} fp-badge-sm`}>{meta.label}</span>
                          <span className="timeline-date">{formatDateTime(entry.created_at)}</span>
                        </div>
                        <p>
                          por {entry.user || 'sistema'}
                          {entry.ip_address ? ` · IP ${entry.ip_address}` : ''}
                        </p>
                        {entry.changes && Object.keys(entry.changes).length > 0 && (
                          <ul className="audit-changes">
                            {Object.entries(entry.changes).slice(0, 8).map(([key, value]) => (
                              <li key={key}>
                                <span>{key}</span>
                                <strong>{formatChangeValue(value)}</strong>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <EmptyState icon="bi-clock-history" title="Sem eventos registrados" message="As alterações aparecerão aqui." />
            )}
          </Panel>
        </div>

        <aside className="detail-side">
          {canWrite && (
            <Panel title="Alterar situação" icon="bi-arrow-repeat">
              <p className="panel-hint">
                Ao alterar a situação, todas as parcelas acompanham a mudança. O sistema não altera valores nem
                calcula encargos.
              </p>
              <select
                className="form-select fp-input"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-label="Nova situação"
              >
                {LOAN_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary w-100 mt-2"
                disabled={updatingStatus || status === item.status}
                onClick={applyStatus}
              >
                {updatingStatus ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Atualizando…
                  </>
                ) : (
                  <>
                    <i className="bi bi-check2" /> Aplicar situação
                  </>
                )}
              </button>
            </Panel>
          )}

          <Panel title="Limite do cliente" icon="bi-sliders">
            <dl className="side-summary">
              <div>
                <dt>Limite operacional</dt>
                <dd>{formatBRL(limit.operational_limit)}</dd>
              </div>
              <div>
                <dt>Exposição em aberto</dt>
                <dd>{formatBRL(limit.open_amount)}</dd>
              </div>
              <div>
                <dt>Disponível</dt>
                <dd className={limit.limit_exceeded ? 'text-danger' : ''}>{formatBRL(limit.available_limit)}</dd>
              </div>
            </dl>
            {limit.limit_exceeded && (
              <div className="inline-alert warning">
                <i className="bi bi-exclamation-triangle-fill" /> Limite operacional ultrapassado. O sistema
                apenas avisa.
              </div>
            )}
            <p className="panel-hint">
              As parcelas em aberto deste empréstimo somam-se a cheques e boletos na exposição do cliente.
            </p>
          </Panel>

          <div className="info-note">
            <i className="bi bi-info-circle" />
            <div>
              <strong>Duplicata para impressão</strong>
              <p>
                O botão “Duplicata” abre um documento pronto para imprimir ou salvar em PDF, com os dados do
                cadastro do cliente e da empresa. Nenhum registro novo é criado.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Excluir empréstimo"
        message={`A exclusão lógica de ${item.code} será registrada na auditoria e as parcelas deixarão de influenciar o limite do cliente. Deseja continuar?`}
        confirmLabel="Excluir"
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={removeLoan}
      />
    </div>
  )
}
