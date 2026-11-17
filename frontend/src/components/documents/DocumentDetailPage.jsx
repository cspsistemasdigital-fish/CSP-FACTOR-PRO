import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiError } from '../../api/client'
import { downloadProtectedFile, openProtectedFile } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import PageHeader from '../ui/PageHeader'
import Panel from '../ui/Panel'
import SummaryTile from '../ui/SummaryTile'
import StatusBadge from '../ui/StatusBadge'
import ConfirmDialog from '../ui/ConfirmDialog'
import FileField from '../form/FileField'
import EmptyState from '../ui/EmptyState'
import { ErrorBlock, LoadingBlock } from '../ui/Feedback'
import {
  DOCUMENT_STATUS_OPTIONS,
  formatBRL,
  formatBarcode,
  formatDate,
  formatDateTime,
  formatDocument,
} from '../../utils/format'

function actionMeta(action) {
  switch (action) {
    case 'CREATE':
      return { label: 'Criação', variant: 'success' }
    case 'UPDATE':
      return { label: 'Atualização', variant: 'warning' }
    case 'DELETE':
      return { label: 'Exclusão', variant: 'danger' }
    case 'STATUS_CHANGE':
      return { label: 'Status', variant: 'petroleum' }
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

function overdueDays(dueDate) {
  if (!dueDate) return 0
  const due = new Date(`${dueDate}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(Math.floor((today - due) / 86400000), 0)
}

export default function DocumentDetailPage({ config }) {
  const { api, basePath, title, icon, nominalLabel, party, fields, costs } = config
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
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmAttachment, setConfirmAttachment] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get(id)
      setItem(data.item)
      setHistory(data.history || [])
      setStatus(data.item.status)
    } catch (requestError) {
      setError(apiError(requestError).message)
    } finally {
      setLoading(false)
    }
  }, [api, id])

  useEffect(() => {
    load()
  }, [load])

  const totalCosts = useMemo(
    () => costs.reduce((total, cost) => total + (Number(item?.[cost.key]) || 0), 0),
    [costs, item],
  )

  const openAttachment = async (download = false) => {
    try {
      if (download) {
        await downloadProtectedFile(api.attachmentUrl(item.id), `${item.code}-${item.attachment_name || 'anexo'}`)
      } else {
        await openProtectedFile(api.attachmentUrl(item.id))
      }
    } catch (requestError) {
      toast.error('Não foi possível abrir o anexo', requestError?.message || 'Tente novamente.')
    }
  }

  const upload = async () => {
    if (!file) {
      toast.warning('Selecione um arquivo', 'Escolha o arquivo digitalizado antes de enviar.')
      return
    }
    setUploading(true)
    try {
      const { data } = await api.uploadAttachment(item.id, file)
      setItem(data.item)
      setFile(null)
      setHistory(data.history || history)
      toast.success('Anexo enviado', data.message)
      load()
    } catch (requestError) {
      const parsed = apiError(requestError)
      toast.error('Falha no envio', parsed.errors?.file || parsed.message)
    } finally {
      setUploading(false)
    }
  }

  const removeAttachment = async () => {
    try {
      const { data } = await api.removeAttachment(item.id)
      setItem(data.item)
      setConfirmAttachment(false)
      toast.success('Anexo removido', 'O arquivo foi excluído do documento.')
      load()
    } catch (requestError) {
      toast.error('Falha ao remover', apiError(requestError).message)
      setConfirmAttachment(false)
    }
  }

  const applyStatus = async () => {
    if (!status || status === item.status) return
    setUpdatingStatus(true)
    try {
      const { data } = await api.changeStatus(item.id, status)
      setItem(data.item)
      toast.success('Status atualizado', data.message)
      load()
    } catch (requestError) {
      const parsed = apiError(requestError)
      toast.error('Não foi possível alterar', parsed.errors?.status || parsed.message)
      setStatus(item.status)
    } finally {
      setUpdatingStatus(false)
    }
  }

  const removeDocument = async () => {
    setDeleting(true)
    try {
      await api.remove(item.id)
      toast.success(`${title} excluído`, 'A exclusão lógica foi registrada na auditoria.')
      navigate(basePath, { replace: true })
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
        <LoadingBlock label={`Carregando ${title.toLowerCase()}…`} />
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="page">
        <ErrorBlock message={error || `${title} não encontrado.`} onRetry={load} />
      </div>
    )
  }

  const overdue = item.is_overdue
  const days = overdueDays(item.due_date)

  return (
    <div className="page">
      <PageHeader
        title={`${title} ${item.code}`}
        subtitle={`${item.client?.name || 'Cliente não informado'} · vence em ${formatDate(item.due_date)}`}
        icon={icon}
        badge={<StatusBadge status={item.status} overdue={overdue} />}
      >
        <Link to={basePath} className="btn btn-light">
          <i className="bi bi-arrow-left" /> Voltar
        </Link>
        {canWrite && (
          <Link to={`${basePath}/${item.id}/editar`} className="btn btn-outline-primary">
            <i className="bi bi-pencil" /> Editar
          </Link>
        )}
        {isAdmin && (
          <button type="button" className="btn btn-outline-danger" onClick={() => setConfirmDelete(true)}>
            <i className="bi bi-trash3" /> Excluir
          </button>
        )}
      </PageHeader>

      {overdue && (
        <div className="alert alert-danger fp-alert" role="alert">
          <i className="bi bi-exclamation-octagon-fill" />
          <div>
            <strong>Documento vencido há {days} dia(s).</strong> O vencimento era {formatDate(item.due_date)} e o
            status permanece {item.status_label}. O sistema apenas alerta; a atualização do status é decisão
            sua.
          </div>
        </div>
      )}

      {item.has_divergence && (
        <div className="alert alert-warning fp-alert" role="alert">
          <i className="bi bi-exclamation-diamond-fill" />
          <div>
            <strong>Divergência entre os valores informados.</strong>{' '}
            {nominalLabel} menos os custos informados difere do líquido em{' '}
            {formatBRL(item.divergence_amount)}. Os valores foram gravados exatamente como digitados — o
            sistema não recalcula encargos.
          </div>
        </div>
      )}

      <div className="stat-grid stat-grid-4">
        <SummaryTile label={nominalLabel} value={formatBRL(item.nominal_amount)} icon="bi-cash-stack" tone="petroleum" />
        <SummaryTile
          label="Valor líquido"
          value={formatBRL(item.net_amount)}
          icon="bi-wallet2"
          tone="green"
          hint="Informado na operação"
        />
        <SummaryTile
          label="Custos informados"
          value={formatBRL(totalCosts)}
          icon="bi-receipt-cutoff"
          tone="warning"
          hint={costs.map((cost) => cost.label).join(' · ')}
        />
        <SummaryTile
          label="Divergência"
          value={formatBRL(item.divergence_amount)}
          icon={item.has_divergence ? 'bi-exclamation-diamond' : 'bi-check-circle'}
          tone={item.has_divergence ? 'danger' : 'green'}
          hint={item.has_divergence ? 'Verifique os valores informados' : 'Nominal − custos = líquido'}
        />
      </div>

      <div className="detail-layout">
        <div className="detail-main">
          <Panel title={`Dados do ${title.toLowerCase()}`} icon="bi-card-list">
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
                <dt>{party.label}</dt>
                <dd>
                  {item[party.nameKey] || '—'}
                  <span className="cell-sub">{formatDocument(item[party.documentKey])}</span>
                </dd>
              </div>
              {fields.map((field) => (
                <div key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>
                    {field.key === 'barcode' && item[field.key]
                      ? formatBarcode(item[field.key])
                      : item[field.key] || '—'}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Data de emissão</dt>
                <dd>{formatDate(item.issue_date)}</dd>
              </div>
              <div>
                <dt>Data de vencimento</dt>
                <dd className={overdue ? 'date-overdue' : ''}>{formatDate(item.due_date)}</dd>
              </div>
              <div>
                <dt>Data da operação</dt>
                <dd>{formatDate(item.operation_date)}</dd>
              </div>
              <div>
                <dt>Limite aplicado</dt>
                <dd>{item.applied_limit === null || item.applied_limit === undefined ? '—' : formatBRL(item.applied_limit)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd><StatusBadge status={item.status} overdue={overdue} size="sm" /></dd>
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

          <Panel title="Histórico e auditoria" subtitle="Registro imutável das alterações deste documento." icon="bi-clock-history">
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
                message="As alterações deste documento aparecerão aqui."
              />
            )}
          </Panel>
        </div>

        <aside className="detail-side">
          {canWrite && (
            <Panel title="Alterar situação" icon="bi-arrow-repeat">
              <p className="panel-hint">
                A mudança de status é registrada na auditoria. O sistema não altera valores nem calcula
                encargos.
              </p>
              <select
                className="form-select fp-input"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-label="Novo status"
              >
                {DOCUMENT_STATUS_OPTIONS.map((option) => (
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
                    <i className="bi bi-check2" /> Aplicar status
                  </>
                )}
              </button>
            </Panel>
          )}

          <Panel title="Anexo" icon="bi-paperclip">
            {item.has_attachment ? (
              <div className="attachment-box">
                <div className="attachment-file">
                  <i className="bi bi-file-earmark-check-fill" />
                  <div>
                    <strong>{item.attachment_name || 'Anexo'}</strong>
                    <small>Arquivo vinculado a {item.code}</small>
                  </div>
                </div>
                <div className="attachment-actions">
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => openAttachment(false)}>
                    <i className="bi bi-eye" /> Visualizar
                  </button>
                  <button type="button" className="btn btn-sm btn-light" onClick={() => openAttachment(true)}>
                    <i className="bi bi-download" /> Baixar
                  </button>
                  {canWrite && (
                    <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => setConfirmAttachment(true)}>
                      Remover
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="panel-hint">Nenhum arquivo anexado a este documento.</p>
            )}

            {canWrite && (
              <div className="attachment-upload">
                <FileField value={file} onChange={setFile} label={item.has_attachment ? 'Substituir anexo' : 'Enviar anexo'} />
                <button type="button" className="btn btn-primary w-100" disabled={!file || uploading} onClick={upload}>
                  {uploading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Enviando…
                    </>
                  ) : (
                    <>
                      <i className="bi bi-cloud-arrow-up" /> Enviar arquivo
                    </>
                  )}
                </button>
              </div>
            )}
          </Panel>

          <div className="info-note">
            <i className="bi bi-shield-lock" />
            <div>
              <strong>Integridade dos valores</strong>
              <p>
                O líquido, os descontos e as despesas são copiados dos campos informados, sem arredondamentos
                automáticos de encargos. A exclusão é lógica e restrita a administradores.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Excluir ${title.toLowerCase()}?`}
        message={`O documento ${item.code} será excluído logicamente. O histórico e a auditoria são preservados.`}
        confirmLabel="Excluir documento"
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={removeDocument}
      />

      <ConfirmDialog
        open={confirmAttachment}
        title="Remover anexo?"
        message="O arquivo será apagado definitivamente do armazenamento. Esta ação não pode ser desfeita."
        confirmLabel="Remover anexo"
        onCancel={() => setConfirmAttachment(false)}
        onConfirm={removeAttachment}
      />
    </div>
  )
}
