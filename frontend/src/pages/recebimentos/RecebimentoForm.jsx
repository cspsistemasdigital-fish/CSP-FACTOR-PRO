import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { receiptsApi, chequesApi, boletosApi } from '../../api'
import { apiError } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import PageHeader from '../../components/ui/PageHeader'
import Panel from '../../components/ui/Panel'
import Field from '../../components/form/Field'
import CurrencyField from '../../components/form/CurrencyField'
import ClientSelect from '../../components/form/ClientSelect'
import EmptyState from '../../components/ui/EmptyState'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import { currencyToInput, formatBRL, formatDate, todayISO } from '../../utils/format'

const EMPTY_FORM = {
  document_kind: '',
  document_id: null,
  receipt_date: todayISO(),
  amount: '',
  notes: '',
}

const KIND_OPTIONS = [
  { value: '', label: 'Todos os títulos' },
  { value: 'CHEQUE', label: 'Cheques' },
  { value: 'BOLETO', label: 'Boletos' },
]

function docOption(doc) {
  return {
    kind: doc.kind,
    id: doc.id,
    code: doc.code,
    bank: doc.bank,
    identifier: doc.identifier,
    number: doc.number,
    due_date: doc.due_date,
    status: doc.status,
    status_label: doc.status_label,
    net_amount: doc.net_amount,
    nominal_amount: doc.nominal_amount,
    received_amount: doc.received_amount || 0,
    remaining_amount: doc.remaining_amount,
  }
}

export default function RecebimentoForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()

  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedDoc, setSelectedDoc] = useState(null)
  const [docs, setDocs] = useState([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [clientFilter, setClientFilter] = useState(null)
  const [kindFilter, setKindFilter] = useState('')
  const [docSearch, setDocSearch] = useState('')
  const debouncedSearch = useDebouncedValue(docSearch, 300)
  const [errors, setErrors] = useState({})
  const [warnings, setWarnings] = useState([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(editing)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)

  const loadDocuments = useCallback(async () => {
    setDocsLoading(true)
    try {
      const params = {}
      if (clientFilter?.id) params.client_id = clientFilter.id
      if (kindFilter) params.document_kind = kindFilter
      if (debouncedSearch) params.search = debouncedSearch
      const { data } = await receiptsApi.openDocuments(params)
      setDocs((data.items || []).map(docOption))
    } catch {
      setDocs([])
    } finally {
      setDocsLoading(false)
    }
  }, [clientFilter, kindFilter, debouncedSearch])

  useEffect(() => {
    if (editing) return
    loadDocuments()
  }, [editing, loadDocuments])

  // Edit mode: load the receipt and keep the linked document selectable.
  useEffect(() => {
    let active = true
    ;(async () => {
      if (!editing) return
      setLoading(true)
      try {
        const { data } = await receiptsApi.get(id)
        if (!active) return
        const item = data.item
        setForm({
          document_kind: item.document_kind,
          document_id: item.document_id,
          receipt_date: item.receipt_date || todayISO(),
          amount: currencyToInput(item.amount),
          notes: item.notes || '',
        })
        const current = {
          kind: item.document_kind,
          id: item.document_id,
          code: item.document?.code,
          due_date: item.document?.due_date,
          status: item.document?.status,
          status_label: item.document?.status_label,
          net_amount: item.document_net,
          received_amount: item.received_total,
          remaining_amount: item.remaining_amount,
        }
        setSelectedDoc(current)
        setDocs([current])
      } catch (requestError) {
        if (active) setLoadError(apiError(requestError).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [id, editing])

  // In edit mode, refresh the picker (open documents + the linked one).
  useEffect(() => {
    if (!editing) return
    let active = true
    ;(async () => {
      try {
        const params = {}
        if (kindFilter) params.document_kind = kindFilter
        if (debouncedSearch) params.search = debouncedSearch
        const { data } = await receiptsApi.openDocuments(params)
        if (!active) return
        const options = (data.items || []).map(docOption)
        setDocs((current) => {
          const linked = current.find(
            (doc) => doc.kind === form.document_kind && doc.id === form.document_id,
          )
          if (!linked || options.some((doc) => doc.kind === linked.kind && doc.id === linked.id)) {
            return options
          }
          return [linked, ...options]
        })
      } catch {
        /* keeps the previously loaded list */
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, kindFilter, debouncedSearch])

  const setField = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setMessage('')
  }

  const chooseDoc = (doc) => {
    setSelectedDoc(doc)
    setForm((current) => {
      const next = { ...current, document_kind: doc.kind, document_id: doc.id }
      if (!current.amount && doc.remaining_amount != null) {
        next.amount = currencyToInput(doc.remaining_amount)
      }
      return next
    })
    setErrors((current) => ({ ...current, document_id: undefined }))
    setMessage('')
  }

  const validate = () => {
    const nextErrors = {}
    if (!form.document_kind || !form.document_id) nextErrors.document_id = 'Selecione o cheque ou boleto a receber.'
    if (!form.receipt_date) nextErrors.receipt_date = 'Informe a data do recebimento.'
    if (!form.amount || Number(form.amount) <= 0) nextErrors.amount = 'Informe o valor recebido.'
    return nextErrors
  }

  const submit = async (event) => {
    event.preventDefault()
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      toast.warning('Revise os campos', 'Existem informações obrigatórias ou inconsistentes.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const payload = {
        document_kind: form.document_kind,
        document_id: form.document_id,
        receipt_date: form.receipt_date,
        amount: form.amount,
        notes: form.notes || '',
      }
      const response = editing ? await receiptsApi.update(id, payload) : await receiptsApi.create(payload)
      const resultWarnings = response.data.warnings || []
      if (resultWarnings.length) {
        toast.warning('Recebimento gravado com aviso', resultWarnings[0].message)
      } else {
        toast.success(editing ? 'Recebimento atualizado' : 'Recebimento registrado', response.data.message)
      }
      navigate(`/recebimentos/${response.data.item.id}`, { replace: true })
    } catch (requestError) {
      const parsed = apiError(requestError)
      setErrors(parsed.errors || {})
      setMessage(parsed.message)
      toast.error('Não foi possível salvar', parsed.message)
    } finally {
      setSaving(false)
    }
  }

  const remaining = useMemo(() => {
    if (!selectedDoc) return null
    const net = Number(selectedDoc.net_amount) || 0
    const received = Number(selectedDoc.received_amount) || 0
    return net - received
  }, [selectedDoc])

  const projected = useMemo(() => {
    if (remaining == null) return null
    return remaining - (Number(form.amount) || 0)
  }, [remaining, form.amount])

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Carregando recebimento…" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page">
        <ErrorBlock message={loadError} onRetry={() => navigate('/recebimentos')} />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title={editing ? 'Editar recebimento' : 'Novo recebimento'}
        subtitle="Informe a data e o valor efetivamente recebido. O sistema não calcula encargos: apenas compara com o saldo em aberto."
        icon="bi-cash-coin"
      >
        <Link to={editing ? `/recebimentos/${id}` : '/recebimentos'} className="btn btn-light">
          <i className="bi bi-arrow-left" /> Cancelar
        </Link>
        <button type="submit" form="recebimento-form" className="btn btn-primary" disabled={saving}>
          {saving ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Salvando…
            </>
          ) : (
            <>
              <i className="bi bi-check2" /> {editing ? 'Salvar alterações' : 'Registrar recebimento'}
            </>
          )}
        </button>
      </PageHeader>

      {message && (
        <div className="alert alert-danger fp-alert" role="alert">
          <i className="bi bi-exclamation-octagon-fill" /> {message}
        </div>
      )}

      <form id="recebimento-form" onSubmit={submit} className="form-layout" noValidate>
        <div className="form-main">
          <Panel
            title="Título a receber"
            subtitle="Selecione o cheque ou boleto em aberto que está sendo baixado."
            icon="bi-collection"
            actions={selectedDoc ? <span className="type-chip">{selectedDoc.code}</span> : null}
          >
            {errors.document_id && (
              <div className="alert alert-danger fp-alert" role="alert">
                <i className="bi bi-exclamation-octagon-fill" /> {errors.document_id}
              </div>
            )}

            <div className="filter-bar doc-picker-filters">
              <div className="filter-fields">
                <div className="filter-search">
                  <i className="bi bi-search" />
                  <input
                    type="search"
                    className="form-control fp-input"
                    placeholder="Filtrar por código, banco ou referência…"
                    value={docSearch}
                    onChange={(event) => setDocSearch(event.target.value)}
                    aria-label="Filtrar documentos em aberto"
                  />
                </div>
                <label className="filter-select">
                  <span>Tipo</span>
                  <select
                    className="form-select fp-input"
                    value={kindFilter}
                    onChange={(event) => setKindFilter(event.target.value)}
                  >
                    {KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="filter-client">
                  <ClientSelect
                    label="Cliente"
                    value={clientFilter?.id || null}
                    onChange={setClientFilter}
                    required={false}
                    includeInactive
                    placeholder="Todos os clientes"
                  />
                </div>
              </div>
            </div>

            {docsLoading ? (
              <LoadingBlock label="Carregando documentos em aberto…" />
            ) : docs.length === 0 ? (
              <EmptyState
                icon="bi-inbox"
                title="Nenhum documento em aberto"
                message="Não há cheques ou boletos pendentes com os filtros atuais. Ajuste os filtros ou cadastre novos títulos."
              />
            ) : (
              <ul className="doc-picker">
                {docs.map((doc) => {
                  const checked = selectedDoc && selectedDoc.kind === doc.kind && selectedDoc.id === doc.id
                  return (
                    <li key={`${doc.kind}-${doc.id}`}>
                      <label className={`doc-picker-item ${checked ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          className="form-check-input"
                          name="document"
                          checked={Boolean(checked)}
                          onChange={() => chooseDoc(doc)}
                        />
                        <span className="doc-picker-body">
                          <span className="doc-code">
                            <i className={`bi ${doc.kind === 'BOLETO' ? 'bi-receipt' : 'bi-journal-check'}`} />{' '}
                            {doc.code}
                          </span>
                          <span className="cell-sub">
                            {doc.kind === 'BOLETO' ? 'Boleto' : 'Cheque'} · vence em {formatDate(doc.due_date)}
                            {doc.bank ? ` · ${doc.bank}` : ''}
                          </span>
                        </span>
                        <span className="doc-picker-values">
                          <span>
                            Saldo em aberto
                            <strong>{formatBRL(doc.remaining_amount)}</strong>
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Dados do recebimento" subtitle="Valores sempre informados por você." icon="bi-cash-coin">
            <div className="form-grid">
              <Field
                label="Data do recebimento"
                name="receipt_date"
                type="date"
                value={form.receipt_date}
                onChange={(event) => setField('receipt_date')(event.target.value)}
                error={errors.receipt_date}
                required
              />
              <CurrencyField
                label="Valor recebido"
                value={form.amount}
                onChange={setField('amount')}
                error={errors.amount}
                required
                hint="Digite exatamente o valor recebido do cliente."
              />
            </div>
          </Panel>

          <Panel title="Observações" icon="bi-journal-text">
            <Field
              label="Observações internas"
              name="notes"
              as="textarea"
              rows={3}
              value={form.notes}
              onChange={(event) => setField('notes')(event.target.value)}
              error={errors.notes}
              maxLength={2000}
              placeholder="Anotações internas sobre este recebimento…"
            />
          </Panel>
        </div>

        <aside className="form-side">
          <Panel title="Saldo do título" subtitle="Comparação informativa — o sistema não recalcula." icon="bi-calculator">
            {selectedDoc ? (
              <dl className="side-summary">
                <div>
                  <dt>Título</dt>
                  <dd>{selectedDoc.code}</dd>
                </div>
                <div>
                  <dt>Valor líquido</dt>
                  <dd>{formatBRL(selectedDoc.net_amount)}</dd>
                </div>
                <div>
                  <dt>Já recebido</dt>
                  <dd>{formatBRL(selectedDoc.received_amount)}</dd>
                </div>
                <div className="is-emphasis">
                  <dt>Saldo em aberto</dt>
                  <dd>{formatBRL(remaining)}</dd>
                </div>
                {form.amount !== '' && (
                  <div>
                    <dt>Saldo após este recebimento</dt>
                    <dd className={projected < 0 ? 'text-danger' : ''}>{formatBRL(projected)}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="panel-hint">Selecione um título para ver o saldo em aberto.</p>
            )}
            {projected != null && projected < 0 && (
              <div className="conference-alert warning">
                <i className="bi bi-exclamation-triangle-fill" />
                <span>
                  O valor informado é maior que o saldo em aberto. O recebimento será gravado exatamente como
                  digitado, com aviso.
                </span>
              </div>
            )}
          </Panel>

          <div className="info-note">
            <i className="bi bi-shield-check" />
            <div>
              <strong>Baixa manual e auditada</strong>
              <p>
                Cada recebimento é uma decisão do operador. Quando o total recebido alcança o valor líquido, o
                título é marcado como liquidado — e todo estorno volta a situação para em aberto, sempre com
                registro na auditoria.
              </p>
            </div>
          </div>
        </aside>
      </form>
    </div>
  )
}
