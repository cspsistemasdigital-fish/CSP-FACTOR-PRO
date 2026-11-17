import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { alertsApi, clientsApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import ClientBlockButton from '../../components/clients/ClientBlockButton'
import PageHeader from '../../components/ui/PageHeader'
import Panel from '../../components/ui/Panel'
import Field from '../../components/form/Field'
import DocumentField from '../../components/form/DocumentField'
import PhoneField from '../../components/form/PhoneField'
import ZipField from '../../components/form/ZipField'
import CurrencyField from '../../components/form/CurrencyField'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import { currencyToInput, formatBRL, todayISO } from '../../utils/format'

const EMPTY_FORM = {
  name: '',
  document: '',
  phone: '',
  whatsapp: '',
  email: '',
  zip_code: '',
  address: '',
  city: '',
  state: '',
  operational_limit: '',
  registered_at: todayISO(),
  status: 'ATIVO',
  notes: '',
}

const STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

function toForm(client) {
  return {
    name: client.name || '',
    document: client.document || '',
    phone: client.phone || '',
    whatsapp: client.whatsapp || '',
    email: client.email || '',
    zip_code: client.zip_code || '',
    address: client.address || '',
    city: client.city || '',
    state: client.state || '',
    operational_limit: currencyToInput(client.operational_limit),
    registered_at: client.registered_at || todayISO(),
    status: client.status || 'ATIVO',
    notes: client.notes || '',
  }
}

function validate(form) {
  const errors = {}
  if (!form.name.trim() || form.name.trim().length < 3) {
    errors.name = 'Informe o nome completo ou a razão social (mínimo 3 caracteres).'
  }
  const document = form.document.replace(/[^0-9A-Za-z]/g, '')
  if (!document) errors.document = 'Informe o CPF ou CNPJ.'
  else if (![11, 14].includes(document.length)) {
    errors.document = 'CPF deve ter 11 dígitos ou CNPJ deve ter 14 caracteres.'
  }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = 'E-mail inválido.'
  }
  if (form.phone && ![10, 11].includes(form.phone.length)) {
    errors.phone = 'Telefone deve ter DDD + número (10 ou 11 dígitos).'
  }
  if (form.whatsapp && ![10, 11].includes(form.whatsapp.length)) {
    errors.whatsapp = 'WhatsApp deve ter DDD + número (10 ou 11 dígitos).'
  }
  if (form.zip_code && form.zip_code.length !== 8) {
    errors.zip_code = 'CEP deve ter 8 dígitos.'
  }
  return errors
}

export default function ClientForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()
  const { canWrite } = useAuth()
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [overdue, setOverdue] = useState(null)
  const [clientBlocked, setClientBlocked] = useState(false)
  const [clientBlockReason, setClientBlockReason] = useState('')

  useEffect(() => {
    if (!editing) return
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const [clientResponse, alertsResponse] = await Promise.all([
          clientsApi.get(id),
          alertsApi.list().catch(() => null),
        ])
        const { data } = clientResponse
        if (!active) return
        setForm(toForm(data.item))
        setClientBlocked(Boolean(data.item.is_blocked))
        setClientBlockReason(data.item.blocked_reason || '')
        setOverdue(
          alertsResponse?.data?.items?.find((item) => item.client_id === Number(id)) || null,
        )
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

  const setField = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setMessage('')
  }

  const handleChange = (field) => (event) => setField(field)(event.target.value)

  const submit = async (event) => {
    event.preventDefault()
    const nextErrors = validate(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      toast.warning('Revise os campos', 'Alguns dados obrigatórios precisam de atenção.')
      return
    }

    setSaving(true)
    setMessage('')
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        state: form.state.toUpperCase(),
      }
      const response = editing
        ? await clientsApi.update(id, payload)
        : await clientsApi.create(payload)
      toast.success(
        editing ? 'Cliente atualizado' : 'Cliente cadastrado',
        response.data.message,
      )
      navigate(`/clientes/${response.data.item.id}`, { replace: true })
    } catch (requestError) {
      const parsed = apiError(requestError)
      setErrors(parsed.errors || {})
      setMessage(parsed.message)
      toast.error('Não foi possível salvar', parsed.message)
    } finally {
      setSaving(false)
    }
  }

  const documentLength = form.document.replace(/[^0-9A-Za-z]/g, '').length
  const personType = documentLength === 14 ? 'CNPJ · Pessoa jurídica' : documentLength === 11 ? 'CPF · Pessoa física' : null

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Carregando cliente…" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page">
        <ErrorBlock message={loadError} onRetry={() => navigate('/clientes')} />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title={editing ? 'Editar cliente' : 'Novo cliente'}
        subtitle={
          editing
            ? 'Altere os dados cadastrais. Cada mudança é registrada na auditoria.'
            : 'Cadastre um sacado ou emitente. O código é gerado automaticamente pelo sistema.'
        }
        icon="bi-person-plus"
      >
        <Link to={editing ? `/clientes/${id}` : '/clientes'} className="btn btn-light">
          <i className="bi bi-arrow-left" /> Cancelar
        </Link>
        {editing && canWrite && (
          <ClientBlockButton
            clientId={Number(id)}
            blocked={clientBlocked}
            reason={clientBlockReason}
            overdue={overdue}
            onChanged={(item) => {
              setClientBlocked(Boolean(item.is_blocked))
              setClientBlockReason(item.blocked_reason || '')
            }}
          />
        )}
        <button type="submit" form="client-form" className="btn btn-primary" disabled={saving}>
          {saving ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Salvando…
            </>
          ) : (
            <>
              <i className="bi bi-check2" /> {editing ? 'Salvar alterações' : 'Cadastrar cliente'}
            </>
          )}
        </button>
      </PageHeader>

      {message && (
        <div className="alert alert-danger fp-alert" role="alert">
          <i className="bi bi-exclamation-octagon-fill" /> {message}
        </div>
      )}

      {editing && overdue?.overdue_documents > 0 && (
        <div className={`alert ${clientBlocked ? 'alert-danger' : 'alert-warning'} fp-alert`} role="status">
          <i className="bi bi-exclamation-triangle-fill" />
          <div>
            <strong>Cliente com pendências em atraso.</strong>{' '}
            {overdue.overdue_documents} título(s) vencido(s), totalizando{' '}
            {formatBRL(overdue.overdue_amount)}.{' '}
            {clientBlocked
              ? `Bloqueio ativo — ${clientBlockReason || 'motivo não informado'}. Novos lançamentos são recusados.`
              : 'Você pode bloquear novos lançamentos usando o botão “Bloquear por inadimplência”.'}
          </div>
        </div>
      )}

      <form id="client-form" onSubmit={submit} className="form-layout" noValidate>
        <div className="form-main">
          <Panel title="Dados principais" subtitle="Identificação e situação do cliente." icon="bi-person-vcard">
            <div className="form-grid">
              <Field
                label="Nome completo / Razão social"
                name="name"
                icon="bi-person"
                className="span-2"
                value={form.name}
                onChange={handleChange('name')}
                error={errors.name}
                maxLength={180}
                required
              />
              <DocumentField
                value={form.document}
                onChange={setField('document')}
                error={errors.document}
                hint={personType ? `${personType}. O número é salvo sem pontuação.` : undefined}
                required
              />
              <Field
                label="Status"
                name="status"
                value={form.status}
                onChange={handleChange('status')}
                error={errors.status}
                required
              >
                <select className="form-select fp-input" value={form.status} onChange={handleChange('status')}>
                  <option value="ATIVO">Ativo — pode receber documentos</option>
                  <option value="INATIVO">Inativo — bloqueado para novos documentos</option>
                </select>
              </Field>
              <Field
                label="Data de cadastro"
                name="registered_at"
                type="date"
                icon="bi-calendar3"
                value={form.registered_at}
                onChange={handleChange('registered_at')}
                error={errors.registered_at}
              />
              <CurrencyField
                label="Limite operacional"
                value={form.operational_limit}
                onChange={setField('operational_limit')}
                error={errors.operational_limit}
                hint="Valor informado por você. Não é calculado nem alterado pelo sistema."
              />
            </div>
          </Panel>

          <Panel title="Contato" subtitle="Canais de comunicação usados em cobranças e avisos." icon="bi-telephone">
            <div className="form-grid">
              <PhoneField
                label="Telefone"
                value={form.phone}
                onChange={setField('phone')}
                error={errors.phone}
              />
              <PhoneField
                label="WhatsApp"
                value={form.whatsapp}
                onChange={setField('whatsapp')}
                error={errors.whatsapp}
                hint="Se vazio, o sistema usa o telefone informado."
              />
              <Field
                label="E-mail"
                name="email"
                type="email"
                icon="bi-envelope"
                className="span-2"
                value={form.email}
                onChange={handleChange('email')}
                error={errors.email}
                autoComplete="email"
              />
            </div>
          </Panel>

          <Panel title="Endereço" subtitle="Localização do cliente para relatórios e contato." icon="bi-geo-alt">
            <div className="form-grid">
              <ZipField
                value={form.zip_code}
                onChange={setField('zip_code')}
                error={errors.zip_code}
              />
              <Field
                label="Endereço"
                name="address"
                icon="bi-signpost"
                className="span-2"
                value={form.address}
                onChange={handleChange('address')}
                error={errors.address}
                maxLength={220}
                placeholder="Rua, número, complemento, bairro"
              />
              <Field
                label="Cidade"
                name="city"
                icon="bi-building"
                value={form.city}
                onChange={handleChange('city')}
                error={errors.city}
                maxLength={120}
              />
              <Field
                label="UF"
                name="state"
                value={form.state}
                onChange={(event) => setField('state')(event.target.value.toUpperCase())}
                error={errors.state}
                maxLength={2}
                placeholder="SP"
              >
                <select className="form-select fp-input" value={form.state} onChange={handleChange('state')}>
                  <option value="">—</option>
                  {STATES.map((uf) => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Panel>

          <Panel title="Observações" subtitle="Informações internas sobre o cliente." icon="bi-journal-text">
            <Field
              label="Anotações internas"
              name="notes"
              as="textarea"
              rows={4}
              value={form.notes}
              onChange={handleChange('notes')}
              error={errors.notes}
              maxLength={2000}
              placeholder="Condições negociadas, referências, histórico de conversas…"
            />
          </Panel>
        </div>

        <aside className="form-side">
          <Panel title="Resumo do cadastro" icon="bi-info-circle">
            <dl className="side-summary">
              <div>
                <dt>Tipo de documento</dt>
                <dd>{personType || 'Aguardando CPF/CNPJ'}</dd>
              </div>
              <div>
                <dt>Situação</dt>
                <dd>{form.status === 'ATIVO' ? 'Ativo' : 'Inativo'}</dd>
              </div>
              <div>
                <dt>Limite informado</dt>
                <dd>{formatBRL(form.operational_limit || 0)}</dd>
              </div>
              <div>
                <dt>Documentos em aberto</dt>
                <dd>{editing ? 'Calculado a partir dos lançamentos' : 'Nenhum até o momento'}</dd>
              </div>
            </dl>
          </Panel>
          <div className="info-note">
            <i className="bi bi-shield-lock" />
            <div>
              <strong>Privacidade e integridade</strong>
              <p>
                Dados pessoais são tratados conforme a LGPD. O CPF/CNPJ é único entre clientes ativos e não
                pode ser duplicado. Exclusões são lógicas e preservam o histórico.
              </p>
            </div>
          </div>
        </aside>
      </form>
    </div>
  )
}
