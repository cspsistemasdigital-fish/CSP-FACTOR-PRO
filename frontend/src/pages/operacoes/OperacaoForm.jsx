import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { operationsApi, clientsApi } from '../../api'
import { apiError } from '../../api/client'
import { useBrand } from '../../context/BrandContext'
import { useToast } from '../../context/ToastContext'
import PageHeader from '../../components/ui/PageHeader'
import Panel from '../../components/ui/Panel'
import Field from '../../components/form/Field'
import ClientSelect from '../../components/form/ClientSelect'
import StatusBadge from '../../components/ui/StatusBadge'
import EmptyState from '../../components/ui/EmptyState'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import { formatBRL, formatDate, formatNumber, todayISO } from '../../utils/format'

const EMPTY_FORM = {
  client_id: null,
  operation_date: todayISO(),
  description: '',
  status: 'ABERTA',
  notes: '',
}

function toForm(item) {
  return {
    client_id: item.client_id,
    operation_date: item.operation_date || todayISO(),
    description: item.description || '',
    status: item.status || 'ABERTA',
    notes: item.notes || '',
  }
}

function clientOption(client) {
  return {
    id: client.id,
    code: client.code,
    name: client.name,
    document: client.document,
    status: client.status,
    operational_limit: client.operational_limit,
    available_limit: client.summary?.available_limit ?? client.available_limit,
    open_amount: client.summary?.open_amount ?? client.open_amount,
  }
}

function docCosts(doc) {
  return (Number(doc.discount_amount) || 0) + (Number(doc.interest_amount) || 0) + (Number(doc.other_expenses) || 0)
}

export default function OperacaoForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()
  const { appName } = useBrand()
  const [form, setForm] = useState(EMPTY_FORM)
  const [clientInfo, setClientInfo] = useState(null)
  const [availableDocs, setAvailableDocs] = useState([])
  const [selected, setSelected] = useState([])
  const [docSearch, setDocSearch] = useState('')
  const [docsLoading, setDocsLoading] = useState(false)
  const [availableLoans, setAvailableLoans] = useState([])
  const [selectedLoanIds, setSelectedLoanIds] = useState([])
  const [loanSearch, setLoanSearch] = useState('')
  const [loansLoading, setLoansLoading] = useState(false)
  const [loansError, setLoansError] = useState('')
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(editing)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)

  const loadClient = useCallback(async (clientId) => {
    try {
      const { data } = await clientsApi.get(clientId)
      setClientInfo(clientOption(data.item))
    } catch {
      setClientInfo(null)
    }
  }, [])

  const loadDocuments = useCallback(async (clientId, operationId) => {
    if (!clientId) {
      setAvailableDocs([])
      return
    }
    setDocsLoading(true)
    try {
      const params = { client_id: clientId }
      if (operationId) params.operation_id = operationId
      const { data } = await operationsApi.availableDocuments(params)
      setAvailableDocs(data.items || [])
    } catch {
      setAvailableDocs([])
    } finally {
      setDocsLoading(false)
    }
  }, [])

  const loadLoans = useCallback(async (clientId, operationId) => {
    if (!clientId) {
      setAvailableLoans([])
      setLoansError('')
      return
    }
    setLoansLoading(true)
    try {
      const params = { client_id: clientId }
      if (operationId) params.operation_id = operationId
      const { data } = await operationsApi.availableLoans(params)
      setAvailableLoans(data.items || [])
    } catch (requestError) {
      setLoansError(apiError(requestError).message)
    } finally {
      setLoansLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!editing) return
      setLoading(true)
      try {
        const { data } = await operationsApi.get(id)
        if (!active) return
        const item = data.item
        setForm(toForm(item))
        setSelected((item.items || []).map((doc) => ({ kind: doc.kind, id: doc.id })))
        setSelectedLoanIds((item.loans || []).map((loan) => loan.id))
        if (item.client_id) loadClient(item.client_id)
        loadDocuments(item.client_id, item.id)
        loadLoans(item.client_id, item.id)
      } catch (requestError) {
        if (active) setLoadError(apiError(requestError).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [id, editing, loadClient, loadDocuments, loadLoans])

  const setField = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setMessage('')
  }

  const handleChange = (field) => (event) => setField(field)(event.target.value)

  const chooseClient = (client) => {
    const nextId = client?.id || null
    setForm((current) => ({ ...current, client_id: nextId }))
    setClientInfo(client)
    setSelected([])
    setSelectedLoanIds([])
    setErrors((current) => ({ ...current, client_id: undefined }))
    loadDocuments(nextId)
    loadLoans(nextId)
  }

  const isSelected = (doc) => selected.some((item) => item.kind === doc.kind && item.id === doc.id)

  const toggleDoc = (doc) => {
    setSelected((current) => {
      const exists = current.some((item) => item.kind === doc.kind && item.id === doc.id)
      if (exists) return current.filter((item) => !(item.kind === doc.kind && item.id === doc.id))
      return [...current, { kind: doc.kind, id: doc.id }]
    })
    setMessage('')
  }

  const toggleLoan = (loanId) => {
    setSelectedLoanIds((current) =>
      current.includes(loanId)
        ? current.filter((id) => id !== loanId)
        : [...current, loanId],
    )
    setMessage('')
  }

  const filteredDocs = useMemo(() => {
    const term = docSearch.trim().toLowerCase()
    if (!term) return availableDocs
    return availableDocs.filter((doc) =>
      [doc.code, doc.bank, doc.identifier, doc.number].filter(Boolean).join(' ').toLowerCase().includes(term),
    )
  }, [availableDocs, docSearch])

  const filteredLoans = useMemo(() => {
    const term = loanSearch.trim().toLowerCase()
    if (!term) return availableLoans
    return availableLoans.filter((loan) =>
      [loan.code, loan.notes, loan.status_label].filter(Boolean).join(' ').toLowerCase().includes(term),
    )
  }, [availableLoans, loanSearch])

  const selectedDocs = useMemo(
    () => availableDocs.filter((doc) => isSelected(doc)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableDocs, selected],
  )

  const derived = useMemo(() => {
    return selectedDocs.reduce(
      (acc, doc) => ({
        documents: acc.documents + 1,
        nominal: acc.nominal + (Number(doc.nominal_amount) || 0),
        costs: acc.costs + docCosts(doc),
        net: acc.net + (Number(doc.net_amount) || 0),
        applied_limit: acc.applied_limit + (Number(doc.applied_limit) || 0),
      }),
      { documents: 0, nominal: 0, costs: 0, net: 0, applied_limit: 0 },
    )
  }, [selectedDocs])

  const selectedLoans = useMemo(
    () => availableLoans.filter((loan) => selectedLoanIds.includes(loan.id)),
    [availableLoans, selectedLoanIds],
  )

  const validate = () => {
    const nextErrors = {}
    if (!form.client_id) nextErrors.client_id = 'Selecione o cliente da operação.'
    if (!form.operation_date) nextErrors.operation_date = 'Informe a data da operação.'
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
        client_id: form.client_id,
        operation_date: form.operation_date,
        description: form.description || '',
        status: form.status,
        notes: form.notes || '',
        documents: selected.map((item) => ({ kind: item.kind, id: item.id })),
        loan_ids: selectedLoanIds,
      }
      const response = editing ? await operationsApi.update(id, payload) : await operationsApi.create(payload)
      toast.success(editing ? 'Operação atualizada' : 'Operação registrada', response.data.message)
      navigate(`/operacoes/${response.data.item.id}`, { replace: true })
    } catch (requestError) {
      const parsed = apiError(requestError)
      setErrors(parsed.errors || {})
      setMessage(parsed.message)
      toast.error('Não foi possível salvar', parsed.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Carregando operação…" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page">
        <ErrorBlock message={loadError} onRetry={() => navigate('/operacoes')} />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title={editing ? 'Editar operação' : 'Nova operação'}
        subtitle="Reúna cheques, boletos e empréstimos do mesmo cliente. Os totais de empréstimos permanecem separados dos títulos."
        icon="bi-arrow-left-right"
      >
        <Link to={editing ? `/operacoes/${id}` : '/operacoes'} className="btn btn-light">
          <i className="bi bi-arrow-left" /> Cancelar
        </Link>
        <button type="submit" form="operacao-form" className="btn btn-primary" disabled={saving}>
          {saving ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Salvando…
            </>
          ) : (
            <>
              <i className="bi bi-check2" /> {editing ? 'Salvar alterações' : 'Registrar operação'}
            </>
          )}
        </button>
      </PageHeader>

      {message && (
        <div className="alert alert-danger fp-alert" role="alert">
          <i className="bi bi-exclamation-octagon-fill" /> {message}
        </div>
      )}

      <form id="operacao-form" onSubmit={submit} className="form-layout" noValidate>
        <div className="form-main">
          <Panel title="Vínculo e identificação" subtitle="Cliente da operação e dados do borderô." icon="bi-arrow-left-right">
            <div className="form-grid">
              <ClientSelect
                value={form.client_id}
                initialClient={clientInfo}
                onChange={chooseClient}
                error={errors.client_id}
                required
                className="span-2"
              />
              <Field
                label="Data da operação"
                name="operation_date"
                type="date"
                value={form.operation_date}
                onChange={handleChange('operation_date')}
                error={errors.operation_date}
                required
              />
              <Field label="Situação" name="status" value={form.status} onChange={handleChange('status')} error={errors.status}>
                <select className="form-select fp-input" value={form.status} onChange={handleChange('status')}>
                  <option value="ABERTA">Aberta</option>
                  <option value="FECHADA">Fechada</option>
                </select>
              </Field>
              <Field
                label="Descrição"
                name="description"
                icon="bi-tag"
                className="span-2"
                value={form.description}
                onChange={handleChange('description')}
                error={errors.description}
                maxLength={180}
                placeholder="Ex.: Borderô de compra de títulos"
              />
            </div>
          </Panel>

          <Panel
            title="Documentos da operação"
            subtitle="Marque os cheques e boletos que fazem parte desta operação."
            icon="bi-collection"
            actions={<span className="type-chip">{selected.length} selecionado(s)</span>}
          >
            {errors.documents && (
              <div className="alert alert-danger fp-alert" role="alert">
                <i className="bi bi-exclamation-octagon-fill" /> {errors.documents}
              </div>
            )}

            {!form.client_id ? (
              <EmptyState
                icon="bi-person-badge"
                title="Selecione um cliente"
                message="Os documentos disponíveis aparecem depois que você escolher o cliente da operação."
              />
            ) : docsLoading ? (
              <LoadingBlock label="Carregando documentos do cliente…" />
            ) : availableDocs.length === 0 ? (
              <EmptyState
                icon="bi-inbox"
                title="Nenhum documento disponível"
                message="Este cliente não possui cheques ou boletos livres para vincular. Cadastre ou libere documentos de outra operação."
              />
            ) : (
              <>
                <div className="filter-search doc-picker-search">
                  <i className="bi bi-search" />
                  <input
                    type="search"
                    className="form-control fp-input"
                    placeholder="Filtrar por código, banco ou referência…"
                    value={docSearch}
                    onChange={(event) => setDocSearch(event.target.value)}
                    aria-label="Filtrar documentos disponíveis"
                  />
                </div>
                <ul className="doc-picker">
                  {filteredDocs.map((doc) => {
                    const checked = isSelected(doc)
                    return (
                      <li key={`${doc.kind}-${doc.id}`}>
                        <label className={`doc-picker-item ${checked ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={checked}
                            onChange={() => toggleDoc(doc)}
                          />
                          <span className="doc-picker-body">
                            <span className="doc-code">
                              <i className={`bi ${doc.kind === 'BOLETO' ? 'bi-receipt' : 'bi-journal-check'}`} />
                              {doc.code}
                            </span>
                            <span className="cell-sub">
                              {doc.kind === 'BOLETO' ? 'Boleto' : 'Cheque'} · vence em {formatDate(doc.due_date)}
                              {doc.bank ? ` · ${doc.bank}` : ''}
                            </span>
                          </span>
                          <span className="doc-picker-values">
                            <span>
                              Nominal
                              <strong>{formatBRL(doc.nominal_amount)}</strong>
                            </span>
                            <span>
                              Líquido
                              <strong>{formatBRL(doc.net_amount)}</strong>
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </Panel>

          <Panel
            title="Empréstimos vinculados"
            subtitle="Os valores dos empréstimos são exibidos separadamente dos totais de cheques e boletos."
            icon="bi-cash-coin"
            actions={<span className="type-chip">{selectedLoanIds.length} selecionado(s)</span>}
          >
            {errors.loan_ids && (
              <div className="alert alert-danger fp-alert" role="alert">
                <i className="bi bi-exclamation-octagon-fill" /> {errors.loan_ids}
              </div>
            )}
            {loansError ? (
              <ErrorBlock message={loansError} onRetry={() => loadLoans(form.client_id, editing ? Number(id) : null)} />
            ) : !form.client_id ? (
              <EmptyState
                icon="bi-person-badge"
                title="Selecione um cliente"
                message="Os empréstimos disponíveis aparecem depois que você escolher o cliente da operação."
              />
            ) : loansLoading ? (
              <LoadingBlock label="Carregando empréstimos do cliente…" />
            ) : availableLoans.length === 0 ? (
              <EmptyState
                icon="bi-cash-coin"
                title="Nenhum empréstimo disponível"
                message="Este cliente não possui empréstimos livres e ativos para vincular."
              />
            ) : (
              <>
                <div className="filter-search doc-picker-search">
                  <i className="bi bi-search" />
                  <input
                    type="search"
                    className="form-control fp-input"
                    placeholder="Filtrar por código ou observação…"
                    value={loanSearch}
                    onChange={(event) => setLoanSearch(event.target.value)}
                    aria-label="Filtrar empréstimos disponíveis"
                  />
                </div>
                <ul className="doc-picker">
                  {filteredLoans.map((loan) => {
                    const checked = selectedLoanIds.includes(loan.id)
                    return (
                      <li key={loan.id}>
                        <label className={`doc-picker-item ${checked ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={checked}
                            onChange={() => toggleLoan(loan.id)}
                          />
                          <span className="doc-picker-body">
                            <span className="doc-code"><i className="bi bi-cash-coin" /> {loan.code}</span>
                            <span className="cell-sub">
                              Empréstimo · {formatDate(loan.loan_date)} · {loan.status_label}
                            </span>
                          </span>
                          <span className="doc-picker-values">
                            <span>Emprestado<strong>{formatBRL(loan.loan_amount)}</strong></span>
                            <span>Recebido pelo cliente<strong>{formatBRL(loan.received_amount)}</strong></span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </Panel>

          <Panel title="Observações" icon="bi-journal-text">
            <Field
              label="Observações internas"
              name="notes"
              as="textarea"
              rows={3}
              value={form.notes}
              onChange={handleChange('notes')}
              error={errors.notes}
              maxLength={2000}
              placeholder="Anotações internas sobre esta operação…"
            />
          </Panel>
        </div>

        <aside className="form-side">
          <Panel title="Resumo da operação" subtitle="Documentos e empréstimos são totalizados separadamente." icon="bi-calculator">
            <dl className="side-summary">
              <div>
                <dt>Documentos</dt>
                <dd>{formatNumber(derived.documents)}</dd>
              </div>
              <div>
                <dt>Valor nominal</dt>
                <dd>{formatBRL(derived.nominal)}</dd>
              </div>
              <div>
                <dt>Custos informados</dt>
                <dd>{formatBRL(derived.costs)}</dd>
              </div>
              <div>
                <dt>Valor líquido</dt>
                <dd>{formatBRL(derived.net)}</dd>
              </div>
              <div>
                <dt>Limite aplicado</dt>
                <dd>{formatBRL(derived.applied_limit)}</dd>
              </div>
              <div>
                <dt>Empréstimos</dt>
                <dd>{formatNumber(selectedLoans.length)}</dd>
              </div>
              <div>
                <dt>Valor emprestado</dt>
                <dd>{formatBRL(selectedLoans.reduce((sum, loan) => sum + Number(loan.loan_amount || 0), 0))}</dd>
              </div>
              <div>
                <dt>Recebido pelo cliente</dt>
                <dd>{formatBRL(selectedLoans.reduce((sum, loan) => sum + Number(loan.received_amount || 0), 0))}</dd>
              </div>
              <div>
                <dt>Lucro informado</dt>
                <dd>{formatBRL(selectedLoans.reduce((sum, loan) => sum + Number(loan.profit_amount || 0), 0))}</dd>
              </div>
            </dl>
          </Panel>

          {clientInfo && (
            <Panel title="Cliente selecionado" icon="bi-person-badge">
              <dl className="side-summary">
                <div>
                  <dt>Cliente</dt>
                  <dd>{clientInfo.name}</dd>
                </div>
                <div>
                  <dt>Código</dt>
                  <dd>{clientInfo.code}</dd>
                </div>
                <div>
                  <dt>Situação</dt>
                  <dd><StatusBadge status={clientInfo.status} size="sm" /></dd>
                </div>
                <div>
                  <dt>Limite disponível</dt>
                  <dd>{formatBRL(clientInfo.available_limit)}</dd>
                </div>
              </dl>
            </Panel>
          )}

          <div className="info-note">
            <i className="bi bi-shield-check" />
            <div>
              <strong>Totais nunca são recalculados</strong>
              <p>
                O {appName} não aplica taxas, juros ou descontos. Os títulos e empréstimos mantêm seus valores
                informados e são totalizados em grupos separados.
              </p>
            </div>
          </div>
        </aside>
      </form>
    </div>
  )
}
