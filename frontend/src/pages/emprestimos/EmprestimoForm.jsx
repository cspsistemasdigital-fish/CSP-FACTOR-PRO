import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { clientsApi, loansApi } from '../../api'
import { apiError } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import PageHeader from '../../components/ui/PageHeader'
import Panel from '../../components/ui/Panel'
import Field from '../../components/form/Field'
import CurrencyField from '../../components/form/CurrencyField'
import ClientSelect from '../../components/form/ClientSelect'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import {
  addDaysISO,
  currencyToInput,
  displayCurrencyInput,
  formatBRL,
  onlyDigits,
  todayISO,
} from '../../utils/format'

const PERIODICITIES = [
  { value: 'SEMANAL', label: 'Semanal (7 dias)' },
  { value: 'QUINZENAL', label: 'Quinzenal (15 dias)' },
  { value: 'MENSAL', label: 'Mensal' },
  { value: 'BIMESTRAL', label: 'Bimestral' },
  { value: 'TRIMESTRAL', label: 'Trimestral' },
  { value: 'SEMESTRAL', label: 'Semestral' },
  { value: 'ANUAL', label: 'Anual' },
]

const STATUS_OPTIONS = [
  { value: 'ABERTA', label: 'Aberta' },
  { value: 'QUITADA', label: 'Quitada' },
  { value: 'CANCELADA', label: 'Cancelada' },
]

const EMPTY_FORM = {
  client_id: null,
  loan_date: todayISO(),
  loan_amount: '',
  received_amount: '',
  profit_amount: '0.00',
  status: 'ABERTA',
  notes: '',
}

const EMPTY_CONFIG = {
  quantity: 1,
  first_due_date: todayISO(),
  periodicity: 'MENSAL',
}

function isoFromParts(year, month, day) {
  const date = new Date(year, month - 1, day)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 10)
}

function nextDueDate(current, periodicity) {
  if (!current) return current
  const [year, month, day] = current.split('-').map(Number)
  if (periodicity === 'SEMANAL') return addDaysISO(7, new Date(year, month - 1, day))
  if (periodicity === 'QUINZENAL') return addDaysISO(15, new Date(year, month - 1, day))
  const months = {
    MENSAL: 1,
    BIMESTRAL: 2,
    TRIMESTRAL: 3,
    SEMESTRAL: 6,
    ANUAL: 12,
  }[periodicity] || 1
  const index = month - 1 + months
  const targetYear = year + Math.floor(index / 12)
  const targetMonth = (index % 12) + 1
  const lastDay = new Date(targetYear, targetMonth, 0).getDate()
  return isoFromParts(targetYear, targetMonth, Math.min(day, lastDay))
}

/** Sugestão de divisão igual do valor informado — sem juros, taxas ou encargos. */
function buildSchedule(amount, config) {
  const cents = Math.round((Number(amount) || 0) * 100)
  const quantity = Math.max(1, Math.min(360, Number(config.quantity) || 1))
  const base = Math.round(cents / quantity)
  const items = []
  let due = config.first_due_date || config.first_due_date || todayISO()
  for (let index = 0; index < quantity; index += 1) {
    const value = index === quantity - 1 ? cents - base * (quantity - 1) : base
    items.push({
      number: index + 1,
      due_date: due,
      amount: (value / 100).toFixed(2),
      notes: '',
    })
    due = nextDueDate(due, config.periodicity)
  }
  return items
}

function toForm(item) {
  return {
    client_id: item.client_id,
    loan_date: item.loan_date || todayISO(),
    loan_amount: currencyToInput(item.loan_amount),
    received_amount: currencyToInput(item.received_amount),
    profit_amount: currencyToInput(item.profit_amount),
    status: item.status || 'ABERTA',
    notes: item.notes || '',
  }
}

export default function EmprestimoForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const preClient = searchParams.get('cliente')

  const [form, setForm] = useState(EMPTY_FORM)
  const [config, setConfig] = useState(EMPTY_CONFIG)
  const [installments, setInstallments] = useState(() => buildSchedule('', EMPTY_CONFIG))
  const [scheduleTouched, setScheduleTouched] = useState(false)
  const [clientInfo, setClientInfo] = useState(null)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(editing)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!editing) {
        if (preClient) {
          try {
            const { data } = await clientsApi.get(preClient)
            if (active) setClientInfo({ ...data.item, available_limit: data.item.summary?.available_limit })
          } catch {
            /* o usuário pode selecionar outro cliente */
          }
        }
        return
      }
      setLoading(true)
      try {
        const { data } = await loansApi.get(id)
        if (!active) return
        const item = data.item
        setForm(toForm(item))
        setInstallments(
          (item.installments || []).map((entry) => ({
            number: entry.number,
            due_date: entry.due_date,
            amount: currencyToInput(entry.amount),
            notes: entry.notes || '',
          })),
        )
        setScheduleTouched(true)
        setConfig({
          quantity: item.installments?.length || 1,
          first_due_date: item.installments?.[0]?.due_date || item.loan_date || todayISO(),
          periodicity: 'MENSAL',
        })
        if (item.client) {
          setClientInfo({
            ...item.client,
            operational_limit: item.limit?.operational_limit ?? item.client.operational_limit,
            available_limit: item.limit?.available_limit ?? item.client.available_limit,
          })
        }
      } catch (requestError) {
        if (active) setLoadError(apiError(requestError).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [editing, id, preClient])

  useEffect(() => {
    if (editing || scheduleTouched) return
    setInstallments(buildSchedule(form.loan_amount, config))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, scheduleTouched, form.loan_amount, config.quantity, config.first_due_date, config.periodicity])

  const setField = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setMessage('')
  }

  const handleChange = (field) => (event) => setField(field)(event.target.value)

  const handleLoanDate = (value) => {
    if (!scheduleTouched && config.first_due_date === form.loan_date) {
      setConfig((current) => ({ ...current, first_due_date: value }))
    }
    setField('loan_date')(value)
  }

  const setConfigField = (field) => (value) => {
    setConfig((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const regenerate = () => {
    setInstallments(buildSchedule(form.loan_amount, config))
    setScheduleTouched(false)
  }

  const updateInstallment = (index, field, value) => {
    setScheduleTouched(true)
    setInstallments((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    )
  }

  const addInstallment = () => {
    setScheduleTouched(true)
    const last = installments[installments.length - 1]
    setInstallments((current) => [
      ...current,
      {
        number: current.length + 1,
        due_date: nextDueDate(last?.due_date || config.first_due_date, config.periodicity),
        amount: '0.00',
        notes: '',
      },
    ])
  }

  const removeInstallment = (index) => {
    if (installments.length <= 1) return
    setScheduleTouched(true)
    setInstallments((current) =>
      current.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({
        ...item,
        number: itemIndex + 1,
      })),
    )
  }

  const totals = useMemo(() => {
    const cents = installments.reduce((sum, item) => sum + Math.round((Number(item.amount) || 0) * 100), 0)
    return { cents, value: (cents / 100).toFixed(2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installments])

  const divergence = useMemo(() => {
    const value =
      (Number(form.loan_amount) || 0) - (Number(form.profit_amount) || 0) - (Number(form.received_amount) || 0)
    return value.toFixed(2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.loan_amount, form.profit_amount, form.received_amount])

  const availableLimit = clientInfo ? Number(clientInfo.available_limit ?? 0) : null
  const projectedAvailable =
    availableLimit === null ? null : availableLimit - (editing ? 0 : Number(totals.value))
  const limitExceeded = Boolean(
    clientInfo && Number(clientInfo.operational_limit) > 0 && projectedAvailable < 0,
  )
  const installmentsDiffer = Math.abs(totals.cents - Math.round((Number(form.loan_amount) || 0) * 100)) > 1

  const validate = () => {
    const nextErrors = {}
    if (!form.client_id) nextErrors.client_id = 'Selecione o cliente do empréstimo.'
    if (!form.loan_date) nextErrors.loan_date = 'Informe a data do empréstimo.'
    if (!form.loan_amount || Number(form.loan_amount) <= 0) {
      nextErrors.loan_amount = 'Informe o valor emprestado maior que zero.'
    }
    if (form.received_amount === '' || Number(form.received_amount) < 0) {
      nextErrors.received_amount = 'Informe o valor que o cliente receberá.'
    }
    if (form.profit_amount !== '' && Number(form.profit_amount) < 0) {
      nextErrors.profit_amount = 'O lucro informado não pode ser negativo.'
    }
    if (!installments.length) {
      nextErrors.installments = 'Gere ao menos uma parcela.'
    } else {
      installments.forEach((item, index) => {
        if (!item.due_date) nextErrors[`parcel-${index}-date`] = 'Informe o vencimento.'
        if (!item.amount || Number(item.amount) < 0) {
          nextErrors[`parcel-${index}-amount`] = 'Informe o valor da parcela.'
        }
      })
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
        profit_amount: form.profit_amount || '0.00',
        notes: form.notes || '',
        installments: installments.map((item) => ({
          due_date: item.due_date,
          amount: item.amount,
          notes: item.notes || '',
        })),
      }
      const response = editing
        ? await loansApi.update(id, payload)
        : await loansApi.create(payload)
      toast.success(editing ? 'Empréstimo atualizado' : 'Empréstimo registrado', response.data.message)
      ;(response.data.warnings || []).forEach((warning) => {
        toast.warning('Confira os valores informados', warning)
      })
      navigate(`/emprestimos/${response.data.item.id}`, { replace: true })
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
        <LoadingBlock label="Carregando empréstimo…" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page">
        <ErrorBlock message={loadError} onRetry={() => navigate('/emprestimos')} />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title={editing ? 'Editar empréstimo' : 'Novo empréstimo'}
        subtitle="Informe os valores exatamente como acordados. As parcelas são uma sugestão de vencimentos — você pode alterar cada uma antes de salvar."
        icon="bi-cash-coin"
      >
        <Link to={editing ? `/emprestimos/${id}` : '/emprestimos'} className="btn btn-light">
          <i className="bi bi-arrow-left" /> Cancelar
        </Link>
        <button type="submit" form="loan-form" className="btn btn-primary" disabled={saving}>
          {saving ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Salvando…
            </>
          ) : (
            <>
              <i className="bi bi-check2" /> {editing ? 'Salvar alterações' : 'Cadastrar empréstimo'}
            </>
          )}
        </button>
      </PageHeader>

      {message && (
        <div className="alert alert-danger fp-alert" role="alert">
          <i className="bi bi-exclamation-octagon-fill" /> {message}
        </div>
      )}

      <form id="loan-form" onSubmit={submit} className="form-layout" noValidate>
        <div className="form-main">
          <Panel title="Dados do empréstimo" subtitle="Cliente, data e valores informados manualmente." icon="bi-person-lines-fill">
            <div className="form-grid">
              <ClientSelect
                value={form.client_id}
                initialClient={clientInfo}
                onChange={(client) => {
                  setField('client_id')(client?.id || null)
                  setClientInfo(client)
                }}
                error={errors.client_id}
                required
                className="span-2"
              />
              {clientInfo && (
                <div className="loan-limit-box span-2">
                  <div>
                    <span>Limite operacional</span>
                    <strong>{formatBRL(clientInfo.operational_limit)}</strong>
                  </div>
                  <div>
                    <span>Exposição atual</span>
                    <strong>{formatBRL(Number(clientInfo.operational_limit) - availableLimit)}</strong>
                  </div>
                  <div>
                    <span>Disponível</span>
                    <strong className={projectedAvailable < 0 ? 'text-danger' : ''}>
                      {formatBRL(projectedAvailable)}
                    </strong>
                  </div>
                  {limitExceeded && (
                    <div className="inline-alert warning span-2">
                      <i className="bi bi-exclamation-triangle-fill" />
                      <span>
                        A exposição projetada ({formatBRL(Number(clientInfo.operational_limit) - projectedAvailable)})
                        ultrapassa o limite informado ({formatBRL(clientInfo.operational_limit)}). O sistema apenas
                        avisa — a decisão operacional é sua.
                      </span>
                    </div>
                  )}
                </div>
              )}
              <Field
                label="Data do empréstimo"
                name="loan_date"
                type="date"
                icon="bi-calendar3"
                value={form.loan_date}
                onChange={(event) => handleLoanDate(event.target.value)}
                error={errors.loan_date}
                required
              />
              <Field label="Situação" error={errors.status}>
                <select
                  id="field-status"
                  className="form-select fp-input"
                  value={form.status}
                  onChange={handleChange('status')}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <CurrencyField
                label="Valor do empréstimo"
                value={form.loan_amount}
                onChange={setField('loan_amount')}
                error={errors.loan_amount}
                hint="Valor total informado, usado como base para a sugestão das parcelas."
                required
              />
              <CurrencyField
                label="Valor recebido pelo cliente"
                value={form.received_amount}
                onChange={setField('received_amount')}
                error={errors.received_amount}
                hint="Quanto o cliente efetivamente recebe — informado por você."
                required
              />
              <CurrencyField
                label="Lucro de quem empresta"
                value={form.profit_amount}
                onChange={setField('profit_amount')}
                error={errors.profit_amount}
                hint="Informado manualmente. O sistema nunca calcula juros ou encargos."
              />
              <Field
                label="Observações"
                name="notes"
                as="textarea"
                icon="bi-chat-left-text"
                className="span-2"
                value={form.notes}
                onChange={handleChange('notes')}
                error={errors.notes}
                maxLength={2000}
                placeholder="Detalhes da operação, referências internas etc. (opcional)"
              />
            </div>
          </Panel>

          <Panel
            title="Parcelas e vencimentos"
            subtitle="A divisão abaixo é apenas uma sugestão editável do valor informado — sem juros ou taxas."
            icon="bi-calendar2-range"
            actions={
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={regenerate}>
                <i className="bi bi-arrow-clockwise" /> Regenerar parcelas
              </button>
            }
          >
            <div className="loan-installment-config">
              <label className="filter-field">
                <span>Quantidade de parcelas</span>
                <input
                  type="number"
                  min={1}
                  max={360}
                  className="form-control fp-input"
                  value={config.quantity}
                  onChange={(event) => setConfigField('quantity')(event.target.value)}
                />
              </label>
              <label className="filter-field">
                <span>Primeiro vencimento</span>
                <input
                  type="date"
                  className="form-control fp-input"
                  value={config.first_due_date}
                  onChange={(event) => setConfigField('first_due_date')(event.target.value)}
                />
              </label>
              <label className="filter-field">
                <span>Periodicidade</span>
                <select
                  className="form-select fp-input"
                  value={config.periodicity}
                  onChange={(event) => setConfigField('periodicity')(event.target.value)}
                >
                  {PERIODICITIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {errors.installments && (
              <div className="inline-alert danger">
                <i className="bi bi-exclamation-octagon-fill" /> {errors.installments}
              </div>
            )}

            <div className="table-responsive fp-table-wrap loan-installments-table">
              <table className="table fp-table align-middle">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Nº</th>
                    <th style={{ width: 180 }}>Vencimento</th>
                    <th style={{ width: 190 }}>Valor</th>
                    <th>Observação da parcela</th>
                    <th style={{ width: 48 }} aria-label="Remover" />
                  </tr>
                </thead>
                <tbody>
                  {installments.map((item, index) => (
                    <tr key={index}>
                      <td>
                        <span className="type-chip">{String(index + 1).padStart(2, '0')}</span>
                      </td>
                      <td>
                        <input
                          type="date"
                          className={`form-control fp-input form-control-sm ${errors[`parcel-${index}-date`] ? 'is-invalid' : ''}`}
                          value={item.due_date}
                          onChange={(event) => updateInstallment(index, 'due_date', event.target.value)}
                          aria-label={`Vencimento da parcela ${index + 1}`}
                        />
                        {errors[`parcel-${index}-date`] && (
                          <span className="fp-field-error">{errors[`parcel-${index}-date`]}</span>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          className={`form-control fp-input form-control-sm ${errors[`parcel-${index}-amount`] ? 'is-invalid' : ''}`}
                          value={displayCurrencyInput(item.amount)}
                          onChange={(event) =>
                            updateInstallment(
                              index,
                              'amount',
                              onlyDigits(event.target.value)
                                ? (Number(onlyDigits(event.target.value)) / 100).toFixed(2)
                                : '',
                            )
                          }
                          aria-label={`Valor da parcela ${index + 1}`}
                        />
                        {errors[`parcel-${index}-amount`] && (
                          <span className="fp-field-error">{errors[`parcel-${index}-amount`]}</span>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          className="form-control fp-input form-control-sm"
                          value={item.notes || ''}
                          maxLength={180}
                          onChange={(event) => updateInstallment(index, 'notes', event.target.value)}
                          placeholder="Opcional"
                          aria-label={`Observação da parcela ${index + 1}`}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-btn sm"
                          title="Remover parcela"
                          onClick={() => removeInstallment(index)}
                          disabled={installments.length <= 1}
                        >
                          <i className="bi bi-trash3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2} className="text-end">Total das parcelas</th>
                    <th className="money-cell">{formatBRL(totals.value)}</th>
                    <th colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            <button type="button" className="btn btn-outline-primary btn-sm" onClick={addInstallment}>
              <i className="bi bi-plus-lg" /> Adicionar parcela
            </button>

            <div className="loan-conference">
              <span>
                <i className="bi bi-info-circle" /> Conferência informativa (não recalcula valores):
              </span>
              <span>
                Emprestado {formatBRL(form.loan_amount)} · Recebido {formatBRL(form.received_amount)} ·
                Lucro {formatBRL(form.profit_amount)}
              </span>
              <span className={Math.abs(Number(divergence)) > 0.01 ? 'text-warning' : ''}>
                Divergência informada: {formatBRL(divergence)}
              </span>
              {installmentsDiffer && (
                <span className="text-warning">
                  <i className="bi bi-exclamation-triangle-fill" /> A soma das parcelas difere do valor
                  emprestado informado. Os valores gravados serão exatamente os digitados.
                </span>
              )}
            </div>
          </Panel>
        </div>
      </form>
    </div>
  )
}
