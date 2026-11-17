import { useCallback, useEffect, useMemo, useState } from 'react'
import { usersApi } from '../api'
import { apiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import PageHeader from '../components/ui/PageHeader'
import Panel from '../components/ui/Panel'
import SummaryTile from '../components/ui/SummaryTile'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Pagination from '../components/ui/Pagination'
import EmptyState from '../components/ui/EmptyState'
import Field from '../components/form/Field'
import { ErrorBlock, LoadingBlock } from '../components/ui/Feedback'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { formatDateTime, formatNumber, initials } from '../utils/format'

const TABS = [
  { key: 'usuarios', label: 'Usuários', icon: 'bi-people-fill' },
  { key: 'auditoria', label: 'Auditoria', icon: 'bi-clock-history' },
]

const ROLE_FALLBACK = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'OPERATOR', label: 'Operador' },
  { value: 'VIEWER', label: 'Consultor / Visualizador' },
]

const ACTION_OPTIONS = [
  { value: 'CREATE', label: 'Criação' },
  { value: 'UPDATE', label: 'Atualização' },
  { value: 'DELETE', label: 'Exclusão' },
  { value: 'STATUS_CHANGE', label: 'Mudança de status' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGIN_FAILED', label: 'Falha de login' },
  { value: 'LOGOUT', label: 'Logout' },
  { value: 'PASSWORD_CHANGE', label: 'Troca de senha' },
  { value: 'PASSWORD_RESET', label: 'Redefinição de senha' },
  { value: 'EXPORT', label: 'Exportação' },
]

const ENTITY_OPTIONS = [
  { value: 'auth', label: 'Autenticação' },
  { value: 'client', label: 'Cliente' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'user', label: 'Usuário' },
  { value: 'settings', label: 'Configurações' },
]

const ACTION_META = {
  CREATE: { label: 'Criação', variant: 'success' },
  UPDATE: { label: 'Atualização', variant: 'warning' },
  DELETE: { label: 'Exclusão', variant: 'danger' },
  STATUS_CHANGE: { label: 'Status', variant: 'petroleum' },
  LOGIN: { label: 'Login', variant: 'neutral' },
  LOGIN_FAILED: { label: 'Falha de login', variant: 'danger' },
  LOGOUT: { label: 'Logout', variant: 'neutral' },
  PASSWORD_CHANGE: { label: 'Senha', variant: 'petroleum' },
  PASSWORD_RESET: { label: 'Senha', variant: 'warning' },
  EXPORT: { label: 'Exportação', variant: 'neutral' },
}

const ROLE_TONE = { ADMIN: 'petroleum', OPERATOR: 'success', VIEWER: 'neutral' }

function roleLabel(role) {
  return ROLE_FALLBACK.find((item) => item.value === role)?.label || role
}

function formatChangeValue(value) {
  if (Array.isArray(value) && value.length === 2) {
    return `${value[0] ?? '—'} → ${value[1] ?? '—'}`
  }
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value ?? '—')
}

function validateUser(form, requirePassword) {
  const errors = {}
  if (!form.name.trim() || form.name.trim().length < 3) {
    errors.name = 'Informe o nome (mínimo 3 caracteres).'
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Informe um e-mail válido.'
  }
  if (!form.role) errors.role = 'Selecione o perfil de acesso.'
  if (requirePassword) {
    if (form.password.length < 8) errors.password = 'A senha deve ter no mínimo 8 caracteres.'
    else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
      errors.password = 'A senha deve conter letras e números.'
    }
  }
  return errors
}

function emptyUserForm() {
  return { name: '', email: '', role: 'OPERATOR', password: '', is_active: true }
}

export default function Admin() {
  const { user: currentUser } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState('usuarios')

  // --- Users ------------------------------------------------------------
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState(ROLE_FALLBACK)
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [usersError, setUsersError] = useState('')

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true)
    setUsersError('')
    try {
      const { data } = await usersApi.list()
      setUsers(data.items || [])
      if (data.roles?.length) setRoles(data.roles)
    } catch (error) {
      setUsersError(apiError(error).message)
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const stats = useMemo(() => {
    const total = users.length
    const active = users.filter((item) => item.is_active).length
    const admins = users.filter((item) => item.role === 'ADMIN' && item.is_active).length
    const pending = users.filter((item) => item.must_change_password).length
    return { total, active, admins, pending }
  }, [users])

  // --- User form modal --------------------------------------------------
  const [userModal, setUserModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [userForm, setUserForm] = useState(emptyUserForm)
  const [userErrors, setUserErrors] = useState({})
  const [userMessage, setUserMessage] = useState('')
  const [savingUser, setSavingUser] = useState(false)

  const openCreate = () => {
    setEditingUser(null)
    setUserForm(emptyUserForm())
    setUserErrors({})
    setUserMessage('')
    setUserModal(true)
  }

  const openEdit = (item) => {
    setEditingUser(item)
    setUserForm({
      name: item.name,
      email: item.email,
      role: item.role,
      password: '',
      is_active: item.is_active,
    })
    setUserErrors({})
    setUserMessage('')
    setUserModal(true)
  }

  const updateUserField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setUserForm((current) => ({ ...current, [field]: value }))
    setUserErrors((current) => ({ ...current, [field]: undefined }))
    setUserMessage('')
  }

  const submitUser = async (event) => {
    event.preventDefault()
    const errors = validateUser(userForm, !editingUser)
    setUserErrors(errors)
    if (Object.keys(errors).length) return

    setSavingUser(true)
    setUserMessage('')
    try {
      const payload = {
        name: userForm.name.trim(),
        email: userForm.email.trim().toLowerCase(),
        role: userForm.role,
        is_active: userForm.is_active,
      }
      let response
      if (editingUser) {
        response = await usersApi.update(editingUser.id, payload)
      } else {
        response = await usersApi.create({ ...payload, password: userForm.password })
      }
      toast.success(editingUser ? 'Usuário atualizado' : 'Usuário criado', response.data.message)
      setUserModal(false)
      loadUsers()
    } catch (error) {
      const parsed = apiError(error)
      setUserErrors(parsed.errors || {})
      setUserMessage(parsed.message)
    } finally {
      setSavingUser(false)
    }
  }

  // --- Toggle active ----------------------------------------------------
  const [toggleTarget, setToggleTarget] = useState(null)
  const [toggling, setToggling] = useState(false)

  const confirmToggle = async () => {
    if (!toggleTarget) return
    setToggling(true)
    try {
      const { data } = await usersApi.update(toggleTarget.id, {
        name: toggleTarget.name,
        email: toggleTarget.email,
        role: toggleTarget.role,
        is_active: !toggleTarget.is_active,
      })
      toast.success(toggleTarget.is_active ? 'Usuário desativado' : 'Usuário ativado', data.message)
      setToggleTarget(null)
      loadUsers()
    } catch (error) {
      toast.error('Não foi possível alterar', apiError(error).message)
      setToggleTarget(null)
    } finally {
      setToggling(false)
    }
  }

  // --- Reset password modal --------------------------------------------
  const [resetTarget, setResetTarget] = useState(null)
  const [resetForm, setResetForm] = useState({ password: '', confirm: '' })
  const [resetErrors, setResetErrors] = useState({})
  const [resetMessage, setResetMessage] = useState('')
  const [resetting, setResetting] = useState(false)

  const openReset = (item) => {
    setResetTarget(item)
    setResetForm({ password: '', confirm: '' })
    setResetErrors({})
    setResetMessage('')
  }

  const updateReset = (field) => (event) => {
    setResetForm((current) => ({ ...current, [field]: event.target.value }))
    setResetErrors((current) => ({ ...current, [field]: undefined }))
    setResetMessage('')
  }

  const submitReset = async (event) => {
    event.preventDefault()
    const errors = {}
    if (resetForm.password.length < 8) errors.password = 'A senha deve ter no mínimo 8 caracteres.'
    else if (!/[A-Za-z]/.test(resetForm.password) || !/\d/.test(resetForm.password)) {
      errors.password = 'A senha deve conter letras e números.'
    }
    if (resetForm.password !== resetForm.confirm) errors.confirm = 'As senhas não conferem.'
    setResetErrors(errors)
    if (Object.keys(errors).length) return

    setResetting(true)
    setResetMessage('')
    try {
      const { data } = await usersApi.resetPassword(resetTarget.id, resetForm.password)
      toast.success('Senha redefinida', data.message)
      setResetTarget(null)
      loadUsers()
    } catch (error) {
      const parsed = apiError(error)
      const mapped = { ...parsed.errors }
      if (mapped.password && !mapped.new_password) mapped.password = mapped.password
      setResetErrors(mapped)
      setResetMessage(parsed.message)
    } finally {
      setResetting(false)
    }
  }

  // --- Audit ------------------------------------------------------------
  const [auditSearchInput, setAuditSearchInput] = useState('')
  const auditSearch = useDebouncedValue(auditSearchInput, 350)
  const [auditEntity, setAuditEntity] = useState('')
  const [auditAction, setAuditAction] = useState('')
  const [auditUserId, setAuditUserId] = useState('')
  const [auditFrom, setAuditFrom] = useState('')
  const [auditTo, setAuditTo] = useState('')
  const [auditPage, setAuditPage] = useState(1)
  const [auditItems, setAuditItems] = useState([])
  const [auditMeta, setAuditMeta] = useState(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const [selectedLog, setSelectedLog] = useState(null)

  useEffect(() => {
    setAuditPage(1)
  }, [auditSearch, auditEntity, auditAction, auditUserId, auditFrom, auditTo])

  const loadAudit = useCallback(async () => {
    if (tab !== 'auditoria') return
    setAuditLoading(true)
    setAuditError('')
    try {
      const params = { page: auditPage, per_page: 20 }
      if (auditSearch) params.search = auditSearch
      if (auditEntity) params.entity = auditEntity
      if (auditAction) params.action = auditAction
      if (auditUserId) params.user_id = auditUserId
      if (auditFrom) params.date_from = auditFrom
      if (auditTo) params.date_to = auditTo
      const { data } = await usersApi.auditLogs(params)
      setAuditItems(data.items || [])
      setAuditMeta(data.meta)
    } catch (error) {
      setAuditError(apiError(error).message)
    } finally {
      setAuditLoading(false)
    }
  }, [tab, auditPage, auditSearch, auditEntity, auditAction, auditUserId, auditFrom, auditTo])

  useEffect(() => {
    loadAudit()
  }, [loadAudit])

  const clearAuditFilters = () => {
    setAuditSearchInput('')
    setAuditEntity('')
    setAuditAction('')
    setAuditUserId('')
    setAuditFrom('')
    setAuditTo('')
    setAuditPage(1)
  }

  const hasAuditFilters = Boolean(
    auditSearch || auditEntity || auditAction || auditUserId || auditFrom || auditTo,
  )

  return (
    <div className="page">
      <PageHeader
        title="Administração"
        subtitle="Gestão de usuários, perfis de acesso e trilha de auditoria do sistema."
        icon="bi-shield-lock-fill"
      >
        {tab === 'usuarios' ? (
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <i className="bi bi-person-plus" /> Novo usuário
          </button>
        ) : (
          <button type="button" className="btn btn-light" onClick={loadAudit} disabled={auditLoading}>
            <i className={`bi ${auditLoading ? 'arrow-repeat spin' : 'arrow-clockwise'}`} /> Atualizar
          </button>
        )}
      </PageHeader>

      <div className="stats-strip">
        <SummaryTile
          label="Usuários cadastrados"
          value={formatNumber(stats.total)}
          icon="bi-people"
          hint="Contas ativas e inativas"
        />
        <SummaryTile
          label="Usuários ativos"
          value={formatNumber(stats.active)}
          icon="bi-check-circle"
          tone="green"
          hint="Podem acessar o sistema"
        />
        <SummaryTile
          label="Administradores ativos"
          value={formatNumber(stats.admins)}
          icon="bi-shield-check"
          tone="petroleum"
          hint="O sistema exige pelo menos um"
        />
        <SummaryTile
          label="Troca de senha pendente"
          value={formatNumber(stats.pending)}
          icon="bi-key"
          tone="warning"
          hint="Senha provisória ainda não alterada"
        />
      </div>

      <div className="fp-panel settings-shell">
        <div className="fp-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              type="button"
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              className={`fp-tab ${tab === item.key ? 'active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              <i className={`bi ${item.icon}`} />
              {item.label}
            </button>
          ))}
        </div>

        <div className="tab-body">
          {tab === 'usuarios' && (
            <>
              {loadingUsers && !users.length ? (
                <LoadingBlock label="Carregando usuários…" />
              ) : usersError ? (
                <ErrorBlock message={usersError} onRetry={loadUsers} />
              ) : users.length === 0 ? (
                <EmptyState
                  icon="bi-people"
                  title="Nenhum usuário cadastrado"
                  message="Crie o primeiro usuário para conceder acesso ao sistema."
                >
                  <button type="button" className="btn btn-primary" onClick={openCreate}>
                    <i className="bi bi-person-plus" /> Novo usuário
                  </button>
                </EmptyState>
              ) : (
                <div className="user-card-grid">
                  {users.map((item) => {
                    const isSelf = item.id === currentUser?.id
                    return (
                      <article className={`user-card ${item.is_active ? '' : 'inactive'}`} key={item.id}>
                        <div className="user-card-head">
                          <span className="user-card-avatar">{initials(item.name)}</span>
                          <div className="user-card-title">
                            <strong>
                              {item.name}
                              {isSelf && <span className="self-chip">você</span>}
                            </strong>
                            <span>{item.email}</span>
                          </div>
                          <span className={`fp-badge fp-badge-${item.is_active ? 'success' : 'neutral'} fp-badge-sm`}>
                            <i className={`bi ${item.is_active ? 'bi-check-circle-fill' : 'bi-pause-circle'}`} />
                            {item.is_active ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>

                        <div className="user-card-meta">
                          <div>
                            <span>Perfil</span>
                            <span className={`fp-badge fp-badge-${ROLE_TONE[item.role] || 'neutral'} fp-badge-sm`}>
                              {item.role_label || roleLabel(item.role)}
                            </span>
                          </div>
                          <div>
                            <span>Último acesso</span>
                            <strong>{formatDateTime(item.last_login_at)}</strong>
                          </div>
                          <div>
                            <span>Senha provisória</span>
                            <strong className={item.must_change_password ? 'text-warning' : ''}>
                              {item.must_change_password ? 'Troca pendente' : 'Definida pelo usuário'}
                            </strong>
                          </div>
                        </div>

                        <div className="user-card-actions">
                          <button type="button" className="btn btn-sm btn-light" onClick={() => openEdit(item)}>
                            <i className="bi bi-pencil" /> Editar
                          </button>
                          <button type="button" className="btn btn-sm btn-light" onClick={() => openReset(item)}>
                            <i className="bi bi-key" /> Redefinir senha
                          </button>
                          {!isSelf && (
                            <button
                              type="button"
                              className={`btn btn-sm ${item.is_active ? 'btn-outline-danger' : 'btn-outline-primary'}`}
                              onClick={() => setToggleTarget(item)}
                            >
                              <i className={`bi ${item.is_active ? 'bi-person-dash' : 'bi-person-check'}`} />
                              {item.is_active ? 'Desativar' : 'Ativar'}
                            </button>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {tab === 'auditoria' && (
            <>
              <div className="audit-toolbar">
                <div className="filter-search">
                  <i className="bi bi-search" />
                  <input
                    type="search"
                    className="form-control fp-input"
                    placeholder="Buscar por descrição, usuário ou entidade…"
                    value={auditSearchInput}
                    onChange={(event) => setAuditSearchInput(event.target.value)}
                    aria-label="Buscar na auditoria"
                  />
                </div>
                {hasAuditFilters && (
                  <button type="button" className="btn btn-link" onClick={clearAuditFilters}>
                    <i className="bi bi-x-circle" /> Limpar filtros
                  </button>
                )}
              </div>

              <div className="advanced-filters audit-filters">
                <label className="filter-field">
                  <span>Entidade</span>
                  <select
                    className="form-select fp-input"
                    value={auditEntity}
                    onChange={(event) => setAuditEntity(event.target.value)}
                  >
                    <option value="">Todas</option>
                    {ENTITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="filter-field">
                  <span>Ação</span>
                  <select
                    className="form-select fp-input"
                    value={auditAction}
                    onChange={(event) => setAuditAction(event.target.value)}
                  >
                    <option value="">Todas</option>
                    {ACTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="filter-field">
                  <span>Usuário</span>
                  <select
                    className="form-select fp-input"
                    value={auditUserId}
                    onChange={(event) => setAuditUserId(event.target.value)}
                  >
                    <option value="">Todos</option>
                    {users.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <label className="filter-field">
                  <span>De</span>
                  <input
                    type="date"
                    className="form-control fp-input"
                    value={auditFrom}
                    max={auditTo || undefined}
                    onChange={(event) => setAuditFrom(event.target.value)}
                  />
                </label>
                <label className="filter-field">
                  <span>Até</span>
                  <input
                    type="date"
                    className="form-control fp-input"
                    value={auditTo}
                    min={auditFrom || undefined}
                    onChange={(event) => setAuditTo(event.target.value)}
                  />
                </label>
              </div>

              {auditLoading && !auditItems.length ? (
                <LoadingBlock label="Carregando registros de auditoria…" />
              ) : auditError ? (
                <ErrorBlock message={auditError} onRetry={loadAudit} />
              ) : auditItems.length === 0 ? (
                <EmptyState
                  icon="bi-clock-history"
                  title="Nenhum registro encontrado"
                  message={
                    hasAuditFilters
                      ? 'Ajuste os filtros para ampliar a consulta.'
                      : 'As ações realizadas no sistema aparecerão aqui.'
                  }
                />
              ) : (
                <>
                  <div className={`audit-list ${auditLoading ? 'is-refreshing' : ''}`}>
                    {auditItems.map((entry) => {
                      const meta = ACTION_META[entry.action] || { label: entry.action, variant: 'neutral' }
                      const entity = ENTITY_OPTIONS.find((option) => option.value === entry.entity)
                      return (
                        <button
                          type="button"
                          className="audit-row"
                          key={entry.id}
                          onClick={() => setSelectedLog(entry)}
                        >
                          <span className={`audit-icon fp-badge-${meta.variant}`}>
                            <i className={`bi ${
                              entry.action === 'LOGIN' || entry.action === 'LOGOUT'
                                ? 'bi-box-arrow-in-right'
                                : entry.action === 'DELETE'
                                  ? 'bi-trash3'
                                  : entry.action === 'CREATE'
                                    ? 'bi-plus-circle'
                                    : entry.action.includes('PASSWORD')
                                      ? 'bi-key'
                                      : 'bi-pencil-square'
                            }`} />
                          </span>
                          <span className="audit-main">
                            <span className="audit-title">
                              <strong>{entry.description || `${meta.label} em ${entry.entity}`}</strong>
                              <span className={`fp-badge fp-badge-${meta.variant} fp-badge-sm`}>{meta.label}</span>
                            </span>
                            <span className="audit-meta">
                              <span><i className="bi bi-person" /> {entry.user || 'sistema'}</span>
                              <span><i className="bi bi-clock" /> {formatDateTime(entry.created_at)}</span>
                              <span><i className="bi bi-tag" /> {entity?.label || entry.entity}</span>
                              {entry.entity_id && <span>#{entry.entity_id}</span>}
                              {entry.ip_address && <span><i className="bi bi-router" /> {entry.ip_address}</span>}
                            </span>
                          </span>
                          <i className="bi bi-chevron-right audit-chevron" />
                        </button>
                      )
                    })}
                  </div>
                  <Pagination meta={auditMeta} onChange={setAuditPage} />
                </>
              )}
            </>
          )}
        </div>
      </div>

      <Modal
        open={userModal}
        onClose={savingUser ? () => {} : () => setUserModal(false)}
        title={editingUser ? 'Editar usuário' : 'Novo usuário'}
        subtitle={editingUser ? 'As alterações são registradas na auditoria.' : 'O usuário deverá trocar a senha no primeiro acesso.'}
        icon="bi-person-gear"
        size="md"
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={() => setUserModal(false)} disabled={savingUser}>
              Cancelar
            </button>
            <button type="submit" form="user-form" className="btn btn-primary" disabled={savingUser}>
              {savingUser ? (
                <>
                  <span className="spinner-border spinner-border-sm" aria-hidden="true" /> Salvando…
                </>
              ) : (
                <>
                  <i className="bi bi-check2" /> {editingUser ? 'Salvar alterações' : 'Criar usuário'}
                </>
              )}
            </button>
          </>
        }
      >
        {userMessage && (
          <div className="alert alert-danger fp-alert" role="alert">
            <i className="bi bi-exclamation-octagon-fill" /> {userMessage}
          </div>
        )}
        <form id="user-form" onSubmit={submitUser} className="form-grid" noValidate>
          <Field
            label="Nome completo"
            name="user_name"
            icon="bi-person"
            className="span-2"
            value={userForm.name}
            onChange={updateUserField('name')}
            error={userErrors.name}
            maxLength={120}
            required
          />
          <Field
            label="E-mail de acesso"
            name="user_email"
            type="email"
            icon="bi-envelope"
            className="span-2"
            value={userForm.email}
            onChange={updateUserField('email')}
            error={userErrors.email}
            autoComplete="off"
            required
          />
          <Field
            label="Perfil de acesso"
            name="user_role"
            error={userErrors.role}
            required
          >
            <select className="form-select fp-input" value={userForm.role} onChange={updateUserField('role')}>
              {roles.map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Situação" name="user_active">
            <label className="switch-row">
              <input
                type="checkbox"
                className="form-check-input"
                checked={userForm.is_active}
                onChange={updateUserField('is_active')}
              />
              <span>{userForm.is_active ? 'Usuário ativo' : 'Usuário inativo'}</span>
            </label>
          </Field>
          {!editingUser && (
            <Field
              label="Senha provisória"
              name="user_password"
              type="password"
              icon="bi-key"
              className="span-2"
              value={userForm.password}
              onChange={updateUserField('password')}
              error={userErrors.password}
              hint="Mínimo de 8 caracteres, com letras e números. O usuário deverá alterá-la no primeiro acesso."
              autoComplete="new-password"
              required
            />
          )}
          {editingUser && (
            <div className="inline-alert info span-2">
              <i className="bi bi-info-circle-fill" />
              <span>
                Para alterar a senha deste usuário, use a ação “Redefinir senha”. A troca é registrada na
                auditoria.
              </span>
            </div>
          )}
        </form>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={resetting ? () => {} : () => setResetTarget(null)}
        title="Redefinir senha"
        subtitle={resetTarget ? `${resetTarget.name} · ${resetTarget.email}` : ''}
        icon="bi-key"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={() => setResetTarget(null)} disabled={resetting}>
              Cancelar
            </button>
            <button type="submit" form="reset-form" className="btn btn-primary" disabled={resetting}>
              {resetting ? (
                <>
                  <span className="spinner-border spinner-border-sm" aria-hidden="true" /> Salvando…
                </>
              ) : (
                <>
                  <i className="bi bi-shield-check" /> Redefinir senha
                </>
              )}
            </button>
          </>
        }
      >
        {resetMessage && (
          <div className="alert alert-danger fp-alert" role="alert">
            <i className="bi bi-exclamation-octagon-fill" /> {resetMessage}
          </div>
        )}
        <form id="reset-form" onSubmit={submitReset} className="form-grid" noValidate>
          <Field
            label="Nova senha provisória"
            name="reset_password"
            type="password"
            icon="bi-lock"
            className="span-2"
            value={resetForm.password}
            onChange={updateReset('password')}
            error={resetErrors.password}
            hint="O usuário será obrigado a trocá-la no próximo acesso."
            autoComplete="new-password"
            required
          />
          <Field
            label="Confirmar senha"
            name="reset_confirm"
            type="password"
            icon="bi-lock-fill"
            className="span-2"
            value={resetForm.confirm}
            onChange={updateReset('confirm')}
            error={resetErrors.confirm}
            autoComplete="new-password"
            required
          />
        </form>
      </Modal>

      <Modal
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title="Detalhe da auditoria"
        subtitle={selectedLog ? `${formatDateTime(selectedLog.created_at)} · ${selectedLog.user || 'sistema'}` : ''}
        icon="bi-shield-check"
        size="md"
      >
        {selectedLog && (
          <div className="audit-detail">
            <dl className="detail-grid">
              <div>
                <dt>Ação</dt>
                <dd>
                  <span className={`fp-badge fp-badge-${(ACTION_META[selectedLog.action] || {}).variant || 'neutral'} fp-badge-sm`}>
                    {(ACTION_META[selectedLog.action] || {}).label || selectedLog.action}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Entidade</dt>
                <dd>
                  {ENTITY_OPTIONS.find((option) => option.value === selectedLog.entity)?.label || selectedLog.entity}
                  {selectedLog.entity_id ? ` #${selectedLog.entity_id}` : ''}
                </dd>
              </div>
              <div>
                <dt>Usuário</dt>
                <dd>{selectedLog.user || 'sistema'}</dd>
              </div>
              <div>
                <dt>Endereço IP</dt>
                <dd>{selectedLog.ip_address || '—'}</dd>
              </div>
              <div className="span-2">
                <dt>Descrição</dt>
                <dd>{selectedLog.description || '—'}</dd>
              </div>
            </dl>

            <h4 className="audit-detail-title">Alterações registradas</h4>
            {selectedLog.changes && Object.keys(selectedLog.changes).length ? (
              <ul className="change-grid">
                {Object.entries(selectedLog.changes).map(([field, value]) => (
                  <li key={field}>
                    <span>{field}</span>
                    <strong>{formatChangeValue(value)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel-hint">Este evento não possui alterações de campos registradas.</p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={toggleTarget?.is_active ? 'Desativar usuário?' : 'Ativar usuário?'}
        message={
          toggleTarget?.is_active
            ? `${toggleTarget.name} perderá o acesso ao sistema imediatamente. O histórico e a auditoria são preservados.`
            : `${toggleTarget?.name} voltará a poder acessar o sistema com o perfil atual.`
        }
        confirmLabel={toggleTarget?.is_active ? 'Desativar' : 'Ativar'}
        tone={toggleTarget?.is_active ? 'danger' : 'primary'}
        loading={toggling}
        onCancel={() => setToggleTarget(null)}
        onConfirm={confirmToggle}
      />
    </div>
  )
}
