import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { receiptsApi, downloadProtectedFile, openProtectedFile } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import PageHeader from '../../components/ui/PageHeader'
import Panel from '../../components/ui/Panel'
import SummaryTile from '../../components/ui/SummaryTile'
import StatusBadge from '../../components/ui/StatusBadge'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import FileField from '../../components/form/FileField'
import PhotoCapture from '../../components/documents/PhotoCapture'
import EmptyState from '../../components/ui/EmptyState'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import { formatBRL, formatDate, formatDateTime } from '../../utils/format'

function actionMeta(action) {
  switch (action) {
    case 'CREATE':
      return { label: 'Criação', variant: 'success' }
    case 'UPDATE':
      return { label: 'Atualização', variant: 'warning' }
    case 'DELETE':
      return { label: 'Estorno', variant: 'danger' }
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

export default function RecebimentoDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { canWrite, isAdmin } = useAuth()
  const [item, setItem] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [confirmEstorno, setConfirmEstorno] = useState(false)
  const [confirmAttachment, setConfirmAttachment] = useState(false)
  const [estornoLoading, setEstornoLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await receiptsApi.get(id)
      setItem(data.item)
      setHistory(data.history || [])
    } catch (requestError) {
      setError(apiError(requestError).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const documentPath = item
    ? item.document_kind === 'BOLETO'
      ? `/boletos/${item.document_id}`
      : `/cheques/${item.document_id}`
    : '#'

  const openAttachment = async (download = false) => {
    try {
      if (download) {
        await downloadProtectedFile(
          receiptsApi.attachmentUrl(item.id),
          `${item.code}-${item.attachment_name || 'anexo'}`,
        )
      } else {
        await openProtectedFile(receiptsApi.attachmentUrl(item.id))
      }
    } catch (requestError) {
      toast.error('Não foi possível abrir o anexo', requestError?.message || 'Tente novamente.')
    }
  }

  const upload = async () => {
    if (!file) {
      toast.warning('Selecione um arquivo', 'Escolha o comprovante antes de enviar.')
      return
    }
    setUploading(true)
    try {
      const { data } = await receiptsApi.uploadAttachment(item.id, file)
      setItem(data.item)
      setFile(null)
      toast.success('Comprovante enviado', data.message)
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
      const { data } = await receiptsApi.removeAttachment(item.id)
      setItem(data.item)
      setConfirmAttachment(false)
      toast.success('Comprovante removido', data.message)
      load()
    } catch (requestError) {
      toast.error('Falha ao remover', apiError(requestError).message)
      setConfirmAttachment(false)
    }
  }

  const estorno = async () => {
    setEstornoLoading(true)
    try {
      await receiptsApi.remove(item.id)
      toast.success('Recebimento estornado', 'O estorno foi registrado na auditoria e o saldo foi restaurado.')
      navigate('/recebimentos', { replace: true })
    } catch (requestError) {
      toast.error('Não foi possível estornar', apiError(requestError).message)
      setConfirmEstorno(false)
    } finally {
      setEstornoLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Carregando recebimento…" />
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="page">
        <ErrorBlock message={error || 'Recebimento não encontrado.'} onRetry={load} />
      </div>
    )
  }

  const remaining = Number(item.remaining_amount) || 0

  return (
    <div className="page">
      <PageHeader
        title={`Recebimento ${item.code}`}
        subtitle={`${item.client?.name || 'Cliente não informado'} · ${formatDate(item.receipt_date)}`}
        icon="bi-cash-coin"
        badge={<span className="type-chip">{item.document_label}</span>}
      >
        <Link to="/recebimentos" className="btn btn-light">
          <i className="bi bi-arrow-left" /> Voltar
        </Link>
        <Link to={`/recibos/${item.id}/imprimir`} className="btn btn-outline-secondary">
          <i className="bi bi-printer" /> Imprimir recibo
        </Link>
        {canWrite && (
          <Link to={`/recebimentos/${item.id}/editar`} className="btn btn-outline-primary">
            <i className="bi bi-pencil" /> Editar
          </Link>
        )}
        {isAdmin && (
          <button type="button" className="btn btn-outline-danger" onClick={() => setConfirmEstorno(true)}>
            <i className="bi bi-arrow-counterclockwise" /> Estornar
          </button>
        )}
      </PageHeader>

      {item.is_settled ? (
        <div className="alert alert-success fp-alert" role="alert">
          <i className="bi bi-check-circle-fill" />
          <div>
            <strong>Título liquidado.</strong> O total recebido alcançou o valor líquido informado, então o
            documento foi marcado como liquidado. Um estorno volta a situação para em aberto.
          </div>
        </div>
      ) : (
        remaining > 0 && (
          <div className="alert alert-warning fp-alert" role="alert">
            <i className="bi bi-hourglass-split" />
            <div>
              <strong>Saldo em aberto de {formatBRL(remaining)}.</strong> Este é um recebimento parcial: o
              título continua em aberto até que o total recebido alcance o valor líquido.
            </div>
          </div>
        )
      )}

      <div className="stat-grid stat-grid-4">
        <SummaryTile
          label="Valor recebido"
          value={formatBRL(item.amount)}
          icon="bi-cash-stack"
          tone="green"
          hint="Informado neste recebimento"
        />
        <SummaryTile
          label="Valor líquido do título"
          value={formatBRL(item.document_net)}
          icon="bi-wallet2"
          tone="petroleum"
          hint="Valor do documento vinculado"
        />
        <SummaryTile
          label="Total já recebido"
          value={formatBRL(item.received_total)}
          icon="bi-piggy-bank"
          tone="light"
          hint="Soma de todos os recebimentos"
        />
        <SummaryTile
          label="Saldo em aberto"
          value={formatBRL(item.remaining_amount)}
          icon={remaining > 0 ? 'bi-hourglass-split' : 'bi-check-circle'}
          tone={remaining > 0 ? 'warning' : 'green'}
          hint={remaining > 0 ? 'Ainda a receber' : 'Nada a receber'}
        />
      </div>

      <div className="detail-layout">
        <div className="detail-main">
          <Panel title="Dados do recebimento" icon="bi-card-list">
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
                <dt>Título</dt>
                <dd>
                  {item.document ? (
                    <Link to={documentPath} className="inline-link">
                      {item.document_label} {item.document.code}
                    </Link>
                  ) : (
                    `${item.document_label} #${item.document_id}`
                  )}
                  {item.document?.due_date && (
                    <span className="cell-sub">vence em {formatDate(item.document.due_date)}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Data do recebimento</dt>
                <dd>{formatDate(item.receipt_date)}</dd>
              </div>
              <div>
                <dt>Valor recebido</dt>
                <dd className="money-cell">{formatBRL(item.amount)}</dd>
              </div>
              <div>
                <dt>Situação do título</dt>
                <dd>
                  {item.document ? (
                    <StatusBadge status={item.document.status} size="sm" />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </dd>
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

          <Panel title="Histórico e auditoria" subtitle="Registro imutável das alterações deste recebimento." icon="bi-clock-history">
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
                message="As alterações deste recebimento aparecerão aqui."
              />
            )}
          </Panel>
        </div>

        <aside className="detail-side">
          <Panel title="Anexo" icon="bi-paperclip" subtitle="Comprovante do recebimento.">
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
              <p className="panel-hint">Nenhum comprovante anexado a este recebimento.</p>
            )}

            {canWrite && (
              <div className="attachment-upload">
                <FileField value={file} onChange={setFile} label={item.has_attachment ? 'Substituir comprovante' : 'Enviar comprovante'} />
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

          <Panel title="Fotos do comprovante" icon="bi-camera" subtitle="Capture várias fotos pelo celular ou tablet e envie depois.">
            <PhotoCapture
              photosApi={receiptsApi}
              documentId={item.id}
              code={item.code}
              canWrite={canWrite}
            />
          </Panel>

          <Panel title="Resumo do título" icon="bi-calculator">
            <dl className="side-summary">
              <div>
                <dt>Valor líquido</dt>
                <dd>{formatBRL(item.document_net)}</dd>
              </div>
              <div>
                <dt>Total recebido</dt>
                <dd>{formatBRL(item.received_total)}</dd>
              </div>
              <div className="is-emphasis">
                <dt>Saldo em aberto</dt>
                <dd>{formatBRL(item.remaining_amount)}</dd>
              </div>
            </dl>
            <Link to={`/recibos/${item.id}/imprimir`} className="btn btn-light w-100 mt-2">
              <i className="bi bi-printer" /> Imprimir recibo
            </Link>
          </Panel>

          <div className="info-note">
            <i className="bi bi-shield-lock" />
            <div>
              <strong>Baixa manual e auditada</strong>
              <p>
                Este recebimento foi informado manualmente. O sistema não aplica juros, descontos ou taxas. O
                estorno é uma exclusão lógica restrita a administradores e sempre gera registro na auditoria.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmEstorno}
        title="Estornar recebimento?"
        message={`O recebimento ${item.code} será estornado (exclusão lógica). O saldo do título é restaurado e, se necessário, a situação volta para em aberto. O histórico e a auditoria são preservados.`}
        confirmLabel="Estornar recebimento"
        loading={estornoLoading}
        onCancel={() => setConfirmEstorno(false)}
        onConfirm={estorno}
      />

      <ConfirmDialog
        open={confirmAttachment}
        title="Remover comprovante?"
        message="O arquivo será apagado definitivamente do armazenamento. Esta ação não pode ser desfeita."
        confirmLabel="Remover comprovante"
        onCancel={() => setConfirmAttachment(false)}
        onConfirm={removeAttachment}
      />
    </div>
  )
}
