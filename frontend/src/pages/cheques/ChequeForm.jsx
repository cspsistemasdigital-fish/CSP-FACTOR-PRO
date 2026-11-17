import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { chequesApi, clientsApi } from '../../api'
import { apiError } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import PageHeader from '../../components/ui/PageHeader'
import Panel from '../../components/ui/Panel'
import Field from '../../components/form/Field'
import CurrencyField from '../../components/form/CurrencyField'
import DocumentField from '../../components/form/DocumentField'
import ClientSelect from '../../components/form/ClientSelect'
import ValueConference from '../../components/documents/ValueConference'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import { currencyToInput, formatBRL, todayISO } from '../../utils/format'

const EMPTY_FORM = {
  client_id: null,
  number: '',
  bank: '',
  agency: '',
  account: '',
  identifier: '',
  issuer_document: '',
  issuer_name: '',
  nominal_amount: '',
  discount_amount: '0.00',
  interest_amount: '0.00',
  other_expenses: '0.00',
  net_amount: '',
  applied_limit: '',
  issue_date: '',
  due_date: '',
  operation_date: todayISO(),
  status: 'EM_ABERTO',
  notes: '',
}

function toForm(item) {
  return {
    client_id: item.client_id,
    number: item.number || '',
    bank: item.bank || '',
    agency: item.agency || '',
    account: item.account || '',
    identifier: item.identifier || '',
    issuer_document: item.issuer_document || '',
    issuer_name: item.issuer_name || '',
    nominal_amount: currencyToInput(item.nominal_amount),
    discount_amount: currencyToInput(item.discount_amount),
    interest_amount: currencyToInput(item.interest_amount),
    other_expenses: currencyToInput(item.other_expenses),
    net_amount: currencyToInput(item.net_amount),
    applied_limit: currencyToInput(item.applied_limit),
    issue_date: item.issue_date || '',
    due_date: item.due_date || '',
    operation_date: item.operation_date || todayISO(),
    status: item.status || 'EM_ABERTO',
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
    whatsapp: client.whatsapp,
    operational_limit: client.operational_limit,
    available_limit: client.summary?.available_limit ?? client.available_limit,
    open_amount: client.summary?.open_amount ?? client.open_amount,
  }
}

export default function ChequeForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const preClient = searchParams.get('cliente')
  const [form, setForm] = useState(EMPTY_FORM)
  const [clientInfo, setClientInfo] = useState(null)
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

  useEffect(() => {
    let active = true
    ;(async () => {
      if (editing) {
        setLoading(true)
        try {
          const { data } = await chequesApi.get(id)
          if (!active) return
          setForm(toForm(data.item))
          if (data.item.client_id) loadClient(data.item.client_id)
        } catch (requestError) {
          if (active) setLoadError(apiError(requestError).message)
        } finally {
          if (active) setLoading(false)
        }
      } else {
        if (preClient) loadClient(preClient)
      }
    })()
    return () => {
      active = false
    }
  }, [id, editing, loadClient, preClient])

  const setField = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setMessage('')
  }

  const handleChange = (field) => (event) => setField(field)(event.target.value)

  const chooseClient = (client) => {
    setForm((current) => ({ ...current, client_id: client?.id || null }))
    setClientInfo(client)
    setErrors((current) => ({ ...current, client_id: undefined }))
  }

  const useClientAsIssuer = () => {
    if (!clientInfo) return
    setForm((current) => ({
      ...current,
      issuer_document: clientInfo.document || current.issuer_document,
      issuer_name: clientInfo.name || current.issuer_name,
    }))
    setErrors((current) => ({ ...current, issuer_document: undefined, issuer_name: undefined }))
  }

  const validate = () => {
    const nextErrors = {}
    if (!form.client_id) nextErrors.client_id = 'Selecione o cliente da operação.'
    if (!form.number.trim()) nextErrors.number = 'Informe o número do cheque.'
    if (!form.bank.trim()) nextErrors.bank = 'Informe o banco.'
    if (!form.issuer_name.trim()) nextErrors.issuer_name = 'Informe o nome do emitente.'
    if (form.issuer_document.replace(/[^0-9A-Za-z]/g, '').length !== 11 && form.issuer_document.replace(/[^0-9A-Za-z]/g, '').length !== 14) {
      nextErrors.issuer_document = 'Informe um CPF (11 dígitos) ou CNPJ (14 caracteres) válido.'
    }
    if (!form.nominal_amount || Number(form.nominal_amount) <= 0) {
      nextErrors.nominal_amount = 'Informe o valor nominal maior que zero.'
    }
    if (form.net_amount === '' || form.net_amount === null) {
      nextErrors.net_amount = 'Informe o valor líquido pago ao cliente.'
    }
    if (!form.due_date) nextErrors.due_date = 'Informe a data de vencimento.'
    if (!form.operation_date) nextErrors.operation_date = 'Informe a data da operação.'
    if (form.issue_date && form.due_date && form.due_date < form.issue_date) {
      nextErrors.due_date = 'O vencimento não pode ser anterior à emissão.'
    }
    const nominal = Number(form.nominal_amount) || 0
    const costs = (Number(form.discount_amount) || 0) + (Number(form.interest_amount) || 0) + (Number(form.other_expenses) || 0)
    const net = Number(form.net_amount) || 0
    if (nominal > 0 && costs > nominal) {
      nextErrors.discount_amount = 'A soma de descontos, juros e despesas não pode superar o valor nominal.'
    }
    if (nominal > 0 && net > nominal) {
      nextErrors.net_amount = 'O valor líquido não pode ser maior que o valor nominal.'
    }
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
        ...form,
        discount_amount: form.discount_amount || '0.00',
        interest_amount: form.interest_amount || '0.00',
        other_expenses: form.other_expenses || '0.00',
        applied_limit: form.applied_limit || '',
        issue_date: form.issue_date || '',
        notes: form.notes || '',
      }
      const response = editing ? await chequesApi.update(id, payload) : await chequesApi.create(payload)
      toast.success(editing ? 'Cheque atualizado' : 'Cheque cadastrado', response.data.message)
      const warnings = response.data.warnings || []
      if (warnings.length) {
        toast.warning('Divergência registrada', warnings[0].message)
      }
      navigate(`/cheques/${response.data.item.id}`, { replace: true })
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
        <LoadingBlock label="Carregando cheque…" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page">
        <ErrorBlock message={loadError} onRetry={() => navigate('/cheques')} />
      </div>
    )
  }

  const availableExceeded =
    clientInfo &&
    Number(clientInfo.operational_limit) > 0 &&
    form.net_amount !== '' &&
    Number(form.net_amount) > Number(clientInfo.available_limit)

  return (
    <div className="page">
      <PageHeader
        title={editing ? 'Editar cheque' : 'Novo cheque'}
        subtitle="Todos os valores são informados por você e gravados exatamente como digitados."
        icon="bi-journal-plus"
      >
        <Link to={editing ? `/cheques/${id}` : '/cheques'} className="btn btn-light">
          <i className="bi bi-arrow-left" /> Cancelar
        </Link>
        <button type="submit" form="cheque-form" className="btn btn-primary" disabled={saving}>
          {saving ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Salvando…
            </>
          ) : (
            <>
              <i className="bi bi-check2" /> {editing ? 'Salvar alterações' : 'Cadastrar cheque'}
            </>
          )}
        </button>
      </PageHeader>

      {message && (
        <div className="alert alert-danger fp-alert" role="alert">
          <i className="bi bi-exclamation-octagon-fill" /> {message}
        </div>
      )}

      <form id="cheque-form" onSubmit={submit} className="form-layout" noValidate>
        <div className="form-main">
          <Panel title="Vínculo e identificação" subtitle="Cliente da operação e dados bancários do cheque." icon="bi-journal-check">
            <div className="form-grid">
              <ClientSelect
                value={form.client_id}
                initialClient={clientInfo}
                onChange={chooseClient}
                error={errors.client_id}
                required
                className="span-2"
              />
              {availableExceeded && (
                <div className="inline-alert warning span-2">
                  <i className="bi bi-exclamation-triangle-fill" />
                  <span>
                    O valor líquido informado ({formatBRL(form.net_amount)}) excede o limite disponível do
                    cliente ({formatBRL(clientInfo.available_limit)}). O sistema não bloqueia o lançamento;
                    confirme a decisão operacional.
                  </span>
                </div>
              )}
              <Field
                label="Número do cheque"
                name="number"
                icon="bi-hash"
                value={form.number}
                onChange={handleChange('number')}
                error={errors.number}
                maxLength={30}
                required
              />
              <Field
                label="Banco"
                name="bank"
                icon="bi-bank"
                value={form.bank}
                onChange={handleChange('bank')}
                error={errors.bank}
                maxLength={80}
                placeholder="Ex.: Banco do Brasil"
                required
              />
              <Field
                label="Agência"
                name="agency"
                value={form.agency}
                onChange={handleChange('agency')}
                error={errors.agency}
                maxLength={20}
              />
              <Field
                label="Conta"
                name="account"
                value={form.account}
                onChange={handleChange('account')}
                error={errors.account}
                maxLength={30}
              />
              <Field
                label="Identificação interna"
                name="identifier"
                icon="bi-tag"
                className="span-2"
                value={form.identifier}
                onChange={handleChange('identifier')}
                error={errors.identifier}
                maxLength={60}
                placeholder="Referência usada pela sua empresa (opcional)"
              />
            </div>
          </Panel>

          <Panel
            title="Emitente do cheque"
            subtitle="Quem emitiu o cheque. Pode ser diferente do cliente que o apresentou."
            icon="bi-person-vcard"
            actions={
              clientInfo && (
                <button type="button" className="btn btn-sm btn-light" onClick={useClientAsIssuer}>
                  <i className="bi bi-arrow-down-square" /> Usar dados do cliente
                </button>
              )
            }
          >
            <div className="form-grid">
              <DocumentField
                label="CPF / CNPJ do emitente"
                value={form.issuer_document}
                onChange={setField('issuer_document')}
                error={errors.issuer_document}
                required
              />
              <Field
                label="Nome do emitente"
                name="issuer_name"
                icon="bi-person"
                value={form.issuer_name}
                onChange={handleChange('issuer_name')}
                error={errors.issuer_name}
                maxLength={180}
                required
              />
            </div>
          </Panel>

          <Panel title="Valores" subtitle="Informe cada valor. O sistema não calcula juros, descontos ou taxas." icon="bi-cash-coin">
            <div className="form-grid">
              <CurrencyField
                label="Valor nominal"
                value={form.nominal_amount}
                onChange={setField('nominal_amount')}
                error={errors.nominal_amount}
                required
              />
              <CurrencyField
                label="Valor líquido pago ao cliente"
                value={form.net_amount}
                onChange={setField('net_amount')}
                error={errors.net_amount}
                hint="Valor efetivamente entregue ao cliente."
                required
              />
              <CurrencyField
                label="Desconto"
                value={form.discount_amount}
                onChange={setField('discount_amount')}
                error={errors.discount_amount}
              />
              <CurrencyField
                label="Juros"
                value={form.interest_amount}
                onChange={setField('interest_amount')}
                error={errors.interest_amount}
              />
              <CurrencyField
                label="Outras despesas"
                value={form.other_expenses}
                onChange={setField('other_expenses')}
                error={errors.other_expenses}
              />
              <CurrencyField
                label="Limite aplicado"
                value={form.applied_limit}
                onChange={setField('applied_limit')}
                error={errors.applied_limit}
                hint="Limite que você aplicou nesta operação (opcional)."
              />
            </div>
          </Panel>

          <Panel title="Datas, status e observações" icon="bi-calendar-check">
            <div className="form-grid">
              <Field
                label="Data de emissão"
                name="issue_date"
                type="date"
                value={form.issue_date}
                onChange={handleChange('issue_date')}
                error={errors.issue_date}
              />
              <Field
                label="Data de vencimento"
                name="due_date"
                type="date"
                value={form.due_date}
                onChange={handleChange('due_date')}
                error={errors.due_date}
                required
              />
              <Field
                label="Data da operação"
                name="operation_date"
                type="date"
                value={form.operation_date}
                onChange={handleChange('operation_date')}
                error={errors.operation_date}
                hint="Pode ser posterior ao vencimento em lançamentos retroativos."
                required
              />
              <Field label="Status" name="status" value={form.status} onChange={handleChange('status')} error={errors.status}>
                <select className="form-select fp-input" value={form.status} onChange={handleChange('status')}>
                  <option value="EM_ABERTO">Em aberto</option>
                  <option value="LIQUIDADO">Liquidado</option>
                  <option value="DEVOLVIDO">Devolvido</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </Field>
              <Field
                label="Observações"
                name="notes"
                as="textarea"
                rows={3}
                className="span-2"
                value={form.notes}
                onChange={handleChange('notes')}
                error={errors.notes}
                maxLength={2000}
                placeholder="Anotações internas sobre esta operação…"
              />
            </div>
          </Panel>
        </div>

        <aside className="form-side">
          <ValueConference
            nominal={form.nominal_amount}
            net={form.net_amount}
            costs={[
              { label: 'Desconto', value: form.discount_amount },
              { label: 'Juros', value: form.interest_amount },
              { label: 'Outras despesas', value: form.other_expenses },
            ]}
          />

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
                  <dt>Limite operacional</dt>
                  <dd>{formatBRL(clientInfo.operational_limit)}</dd>
                </div>
                <div>
                  <dt>Disponível</dt>
                  <dd>{formatBRL(clientInfo.available_limit)}</dd>
                </div>
              </dl>
            </Panel>
          )}

          <div className="info-note">
            <i className="bi bi-shield-check" />
            <div>
              <strong>Valores nunca são recalculados</strong>
              <p>
                O sistema não aplica taxas, juros ou descontos automaticamente. Divergências geram alerta,
                mas não impedem o salvamento — exceto quando o líquido ou os custos superam o nominal.
              </p>
            </div>
          </div>

          {editing && (
            <div className="info-note">
              <i className="bi bi-paperclip" />
              <div>
                <strong>Anexo do cheque</strong>
                <p>
                  Envie ou substitua o arquivo digitalizado na {' '}
                  <Link to={`/cheques/${id}`}>tela de detalhes do cheque</Link>.
                </p>
              </div>
            </div>
          )}
        </aside>
      </form>
    </div>
  )
}
