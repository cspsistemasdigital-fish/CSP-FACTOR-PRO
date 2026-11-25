import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { operationsApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import PageHeader from '../../components/ui/PageHeader'
import Panel from '../../components/ui/Panel'
import SummaryTile from '../../components/ui/SummaryTile'
import StatusBadge from '../../components/ui/StatusBadge'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import DocumentsTable from '../../components/documents/DocumentsTable'
import EmptyState from '../../components/ui/EmptyState'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import { formatBRL, formatDate, formatDateTime, formatNumber } from '../../utils/format'

const STATUS_OPTIONS = [
  { value: 'ABERTA', label: 'Aberta' },
  { value: 'FECHADA', label: 'Fechada' },
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
  if (Array.isArray(value) && value.length === 2) {
    return `${value[0] ?? '—'} → ${value[1] ?? '—'}`
  }
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value ?? '—')
}

export default function OperacaoDetail() {
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

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await operationsApi.get(id)
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
      const { data } = await operationsApi.changeStatus(item.id, status)
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

  const removeOperation = async () => {
    setDeleting(true)
    try {
      await operationsApi.remove(item.id)
      toast.success('Operação excluída', 'A exclusão lógica foi registrada na auditoria. Os documentos foram liberados.')
      navigate('/operacoes', { replace: true })
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
        <LoadingBlock label="Carregando operação…" />
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="page">
        <ErrorBlock message={error || 'Operação não encontrada.'} onRetry={load} />
      </div>
    )
  }

  const totals = item.totals || {}
  const documents = item.items || []

  return (
    <div className="page">
      <PageHeader
        title={`Operação ${item.code}`}
        subtitle={`${item.client?.name || 'Cliente não informado'} · ${formatDate(item.operation_date)}`}
        icon="bi-arrow-left-right"
        badge={<StatusBadge status={item.status} />}
      >
        <Link to="/operacoes" className="btn btn-light">
          <i className="bi bi-arrow-left" /> Voltar
        </Link>
        {canWrite && (
          <Link to={`/operacoes/${item.id}/editar`} className="btn btn-outline-primary">
            <i className="bi bi-pencil" /> Editar
          </Link>
        )}
        {isAdmin && (
          <button type="button" className="btn btn-outline-danger" onClick={() => setConfirmDelete(true)}>
            <i className="bi bi-trash3" /> Excluir
          </button>
        )}
      </PageHeader>

      <div className="stat-grid stat-grid-4">
        <SummaryTile
          label="Documentos"
          value={formatNumber(totals.documents || 0)}
          icon="bi-collection"
          tone="light"
          hint="Cheques e boletos vinculados"
        />
        <SummaryTile
          label="Valor nominal"
          value={formatBRL(totals.nominal || 0)}
          icon="bi-cash-stack"
          tone="petroleum"
          hint="Soma dos valores informados"
        />
        <SummaryTile
          label="Custos informados"
          value={formatBRL(totals.costs || 0)}
          icon="bi-receipt-cutoff"
          tone="warning"
          hint="Descontos, juros e despesas informados"
        />
        <SummaryTile
          label="Valor líquido"
          value={formatBRL(totals.net || 0)}
          icon="bi-wallet2"
          tone="green"
          hint="Soma dos líquidos informados"
        />
      </div>
      <div className="stat-grid stat-grid-4 mt-3">
        <SummaryTile
          label="Empréstimos"
          value={formatNumber(totals.loans || 0)}
          icon="bi-cash-coin"
          tone="light"
          hint="Vinculados a esta operação"
        />
        <SummaryTile
          label="Valor emprestado"
          value={formatBRL(totals.loan_amount || 0)}
          icon="bi-cash-stack"
          tone="petroleum"
          hint="Valores informados"
        />
        <SummaryTile
          label="Recebido pelo cliente"
          value={formatBRL(totals.loan_received_amount || 0)}
          icon="bi-wallet2"
          tone="green"
          hint="Valores informados"
        />
        <SummaryTile
          label="Lucro informado"
          value={formatBRL(totals.loan_profit_amount || 0)}
          icon="bi-graph-up"
          tone="warning"
          hint="Sem cálculo automático"
        />
      </div>

      <div className="detail-layout">
        <div className="detail-main">
          <Panel title="Dados da operação" icon="bi-card-list">
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
                </dd>
              </div>
              <div>
                <dt>Data da operação</dt>
                <dd>{formatDate(item.operation_date)}</dd>
              </div>
              <div>
                <dt>Situação</dt>
                <dd><StatusBadge status={item.status} size="sm" /></dd>
              </div>
              <div>
                <dt>Limite aplicado</dt>
                <dd>{formatBRL(totals.applied_limit || 0)}</dd>
              </div>
              <div className="span-2">
                <dt>Descrição</dt>
                <dd>{item.description || '—'}</dd>
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
            {item.notes && (
              <div className="notes-box">
                <span><i className="bi bi-journal-text" /> Observações internas</span>
                <p>{item.notes}</p>
              </div>
            )}
          </Panel>

          <Panel
            title="Documentos vinculados"
            subtitle="Cheques e boletos que compõem esta operação."
            icon="bi-collection"
            padded={false}
          >
            <DocumentsTable
              items={documents}
              mixed
              emptyTitle="Nenhum documento vinculado"
              emptyMessage="Edite a operação para incluir cheques e boletos deste cliente."
            />
          </Panel>

          <Panel
            title="Empréstimos vinculados"
            subtitle="Empréstimos do mesmo cliente, apresentados separadamente dos documentos."
            icon="bi-cash-coin"
          >
            {item.loans?.length ? (
              <div className="table-responsive fp-table-wrap">
                <table className="table fp-table align-middle">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Data</th>
                      <th>Situação</th>
                      <th className="text-end">Emprestado</th>
                      <th className="text-end">Recebido</th>
                      <th className="text-end">Lucro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.loans.map((loan) => (
                      <tr key={loan.id}>
                        <td><Link to={`/emprestimos/${loan.id}`} className="inline-link">{loan.code}</Link></td>
                        <td>{formatDate(loan.loan_date)}</td>
                        <td><StatusBadge status={loan.status} size="sm" /></td>
                        <td className="text-end money-cell">{formatBRL(loan.loan_amount)}</td>
                        <td className="text-end money-cell">{formatBRL(loan.received_amount)}</td>
                        <td className="text-end money-cell">{formatBRL(loan.profit_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon="bi-cash-coin"
                title="Nenhum empréstimo vinculado"
                message="Edite a operação para incluir empréstimos deste cliente."
              />
            )}
          </Panel>

          <Panel title="Histórico e auditoria" subtitle="Registro imutável das alterações desta operação." icon="bi-clock-history">
            {history.length ? (
              <ol className="timeline compact">
                {history.map((entry) => {
                  const meta = actionMeta(entry.action)
                  return (
                    <li className="timeline-item" key={entry.id}>
                      <span className="timeline-dot"><i className="bi bi-shield-check" /></span>
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
              <EmptyState
                icon="bi-clock-history"
                title="Sem eventos registrados"
                message="As alterações desta operação aparecerão aqui."
              />
            )}
          </Panel>
        </div>

        <aside className="detail-side">
          {canWrite && (
            <Panel title="Alterar situação" icon="bi-arrow-repeat">
              <p className="panel-hint">
                A mudança de situação é registrada na auditoria. O sistema não altera valores nem calcula
                encargos.
              </p>
              <select
                className="form-select fp-input"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-label="Nova situação"
              >
                {STATUS_OPTIONS.map((option) => (
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

          <Panel title="Limite aplicado" icon="bi-sliders">
            <dl className="side-summary">
              <div>
                <dt>Limite aplicado</dt>
                <dd>{formatBRL(totals.applied_limit || 0)}</dd>
              </div>
              <div>
                <dt>Valor líquido</dt>
                <dd>{formatBRL(totals.net || 0)}</dd>
              </div>
            </dl>
            <p className="panel-hint">
              O limite aplicado é a soma dos limites informados em cada documento desta operação.
            </p>
          </Panel>

          <div className="info-note">
            <i className="bi bi-info-circle" />
            <div>
              <strong>Como a operação é calculada</strong>
              <p>
                Os totais da operação são a soma exata dos valores informados nos documentos vinculados. Nada é
                recalculado e a exclusão é lógica, restrita a administradores.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Excluir operação?"
        message={`A operação ${item.code} será excluída logicamente e os documentos voltam a ficar disponíveis. O histórico e a auditoria são preservados.`}
        confirmLabel="Excluir operação"
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={removeOperation}
      />
    </div>
  )
}
