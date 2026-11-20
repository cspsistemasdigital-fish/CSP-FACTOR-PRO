import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { boletosApi, clientsApi } from '../../api'
import { apiError } from '../../api/client'
import { useBrand } from '../../context/BrandContext'
import { useToast } from '../../context/ToastContext'
import PageHeader from '../../components/ui/PageHeader'
import Panel from '../../components/ui/Panel'
import Field from '../../components/form/Field'
import CurrencyField from '../../components/form/CurrencyField'
import DocumentField from '../../components/form/DocumentField'
import ClientSelect from '../../components/form/ClientSelect'
import ValueConference from '../../components/documents/ValueConference'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import { currencyToInput, formatBRL, formatBarcode, todayISO } from '../../utils/format'

const EMPTY_FORM = {
  client_id: null,
  identifier: '',
  barcode: '',
  bank: '',
  beneficiary_document: '',
  beneficiary_name: '',
  original_amount: '',
  discount_amount: '0.00',
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
    identifier: item.identifier || '',
    barcode: item.barcode || '',
    bank: item.bank || '',
    beneficiary_document: item.beneficiary_document || '',
    beneficiary_name: item.beneficiary_name || '',
    original_amount: currencyToInput(item.original_amount),
    discount_amount: currencyToInput(item.discount_amount),
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

export default function BoletoForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()
  const { appName } = useBrand()
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
          const { data } = await boletosApi.get(id)
          if (!active) return
          setForm(toForm(data.item))
          if (data.item.client_id) loadClient(data.item.client_id)
        } catch (requestError) {
          if (active) setLoadError(apiError(requestError).message)
        } finally {
          if (active) setLoading(false)
        }
      } else if (preClient) {
        loadClient(preClient)
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

  const useClientAsBeneficiary = () => {
    if (!clientInfo) return
    setForm((current) => ({
      ...current,
      beneficiary_document: clientInfo.document || current.beneficiary_document,
      beneficiary_name: clientInfo.name || current.beneficiary_name,
    }))
    setErrors((current) => ({ ...current, beneficiary_document: undefined, beneficiary_name: undefined }))
  }

  const validate = () => {
    const nextErrors = {}
    if (!form.client_id) nextErrors.client_id = 'Selecione o cliente da operação.'
    if (!form.identifier.trim()) nextErrors.identifier = 'Informe a identificação do boleto.'
    if (!form.bank.trim()) nextErrors.bank = 'Informe o banco emissor.'
    if (!form.beneficiary_name.trim()) nextErrors.beneficiary_name = 'Informe o nome do beneficiário.'
    const beneficiaryDigits = form.beneficiary_document.replace(/[^0-9A-Za-z]/g, '').length
    if (beneficiaryDigits !== 11 && beneficiaryDigits !== 14) {
      nextErrors.beneficiary_document = 'Informe um CPF (11 dígitos) ou CNPJ (14 caracteres) válido.'
    }
    if (!form.original_amount || Number(form.original_amount) <= 0) {
      nextErrors.original_amount = 'Informe o valor original maior que zero.'
    }
    if (form.net_amount === '' || form.net_amount === null) {
      nextErrors.net_amount = 'Informe o valor líquido pago ao cliente.'
    }
    if (!form.due_date) nextErrors.due_date = 'Informe a data de vencimento.'
    if (!form.operation_date) nextErrors.operation_date = 'Informe a data da operação.'
    if (form.issue_date && form.due_date && form.due_date < form.issue_date) {
      nextErrors.due_date = 'O vencimento não pode ser anterior à emissão.'
    }
    const original = Number(form.original_amount) || 0
    const costs = (Number(form.discount_amount) || 0) + (Number(form.other_expenses) || 0)
    const net = Number(form.net_amount) || 0
    if (original > 0 && costs > original) {
      nextErrors.discount_amount = 'A soma de juros/desconto e despesas não pode superar o valor original.'
    }
    if (original > 0 && net > original) {
      nextErrors.net_amount = 'O valor líquido não pode ser maior que o valor original.'
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
        other_expenses: form.other_expenses || '0.00',
        applied_limit: form.applied_limit || '',
        issue_date: form.issue_date || '',
        notes: form.notes || '',
      }
      const response = editing ? await boletosApi.update(id, payload) : await boletosApi.create(payload)
      toast.success(editing ? 'Boleto atualizado' : 'Boleto cadastrado', response.data.message)
      const warnings = response.data.warnings || []
      if (warnings.length) {
        toast.warning('Divergência registrada', warnings[0].message)
      }
      navigate(`/boletos/${response.data.item.id}`, { replace: true })
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
        <LoadingBlock label="Carregando boleto…" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page">
        <ErrorBlock message={loadError} onRetry={() => navigate('/boletos')} />
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
        title={editing ? 'Editar boleto' : 'Novo boleto'}
        subtitle="Todos os valores são informados por você e gravados exatamente como digitados."
        icon="bi-receipt"
      >
        <Link to={editing ? `/boletos/${id}` : '/boletos'} className="btn btn-light">
          <i className="bi bi-arrow-left" /> Cancelar
        </Link>
        <button type="submit" form="boleto-form" className="btn btn-primary" disabled={saving}>
          {saving ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Salvando…
            </>
          ) : (
            <>
              <i className="bi bi-check2" /> {editing ? 'Salvar alterações' : 'Cadastrar boleto'}
            </>
          )}
        </button>
      </PageHeader>

      {message && (
        <div className="alert alert-danger fp-alert" role="alert">
          <i className="bi bi-exclamation-octagon-fill" /> {message}
        </div>
      )}

      <form id="boleto-form" onSubmit={submit} className="form-layout" noValidate>
        <div className="form-main">
          <Panel title="Vínculo e identificação" subtitle="Cliente da operação e dados do boleto." icon="bi-receipt">
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
                label="Identificação do boleto"
                name="identifier"
                icon="bi-tag"
                value={form.identifier}
                onChange={handleChange('identifier')}
                error={errors.identifier}
                maxLength={60}
                placeholder="Nosso número ou referência"
                required
              />
              <Field
                label="Banco emissor"
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
                label="Linha digitável / código de barras"
                name="barcode"
                icon="bi-upc-scan"
                className="span-2"
                value={formatBarcode(form.barcode)}
                onChange={(event) => setField('barcode')(event.target.value.replace(/\D/g, '').slice(0, 80))}
                error={errors.barcode}
                hint="Somente números. O sistema não valida o dígito verificador do boleto."
                placeholder="00000.00000 00000.000000 00000.000000 0 00000000000000"
              />
            </div>
          </Panel>

          <Panel
            title="Beneficiário"
            subtitle="Quem recebe o boleto. Normalmente é o próprio cliente."
            icon="bi-person-vcard"
            actions={
              clientInfo && (
                <button type="button" className="btn btn-sm btn-light" onClick={useClientAsBeneficiary}>
                  <i className="bi bi-arrow-down-square" /> Usar dados do cliente
                </button>
              )
            }
          >
            <div className="form-grid">
              <DocumentField
                label="CPF / CNPJ do beneficiário"
                value={form.beneficiary_document}
                onChange={setField('beneficiary_document')}
                error={errors.beneficiary_document}
                required
              />
              <Field
                label="Nome do beneficiário"
                name="beneficiary_name"
                icon="bi-person"
                value={form.beneficiary_name}
                onChange={handleChange('beneficiary_name')}
                error={errors.beneficiary_name}
                maxLength={180}
                required
              />
            </div>
          </Panel>

          <Panel title="Valores" subtitle="Informe cada valor. O sistema não calcula juros, descontos ou taxas." icon="bi-cash-coin">
            <div className="form-grid">
              <CurrencyField
                label="Valor original"
                value={form.original_amount}
                onChange={setField('original_amount')}
                error={errors.original_amount}
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
                label="Juros / desconto"
                value={form.discount_amount}
                onChange={setField('discount_amount')}
                error={errors.discount_amount}
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
            nominal={form.original_amount}
            net={form.net_amount}
            nominalLabel="Valor original"
            costsLabel="Juros/desconto e despesas"
            costs={[
              { label: 'Juros / desconto', value: form.discount_amount },
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
                O {appName} não aplica taxas, juros ou descontos automaticamente. Divergências geram alerta,
                mas não impedem o salvamento — exceto quando o líquido ou os custos superam o original.
              </p>
            </div>
          </div>

          {editing && (
            <div className="info-note">
              <i className="bi bi-paperclip" />
              <div>
                <strong>Anexo do boleto</strong>
                <p>
                  Envie ou substitua o arquivo digitalizado na {' '}
                  <Link to={`/boletos/${id}`}>tela de detalhes do boleto</Link>.
                </p>
              </div>
            </div>
          )}
        </aside>
      </form>
    </div>
  )
}
