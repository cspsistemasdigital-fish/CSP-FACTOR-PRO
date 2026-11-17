import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { authApi, settingsApi } from '../api'
import { apiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useBrand } from '../context/BrandContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import PageHeader from '../components/ui/PageHeader'
import Panel from '../components/ui/Panel'
import Field from '../components/form/Field'
import DocumentField from '../components/form/DocumentField'
import PhoneField from '../components/form/PhoneField'
import { ErrorBlock, LoadingBlock } from '../components/ui/Feedback'
import { formatDateTime } from '../utils/format'

const STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

const EMPTY_PASSWORD = { current: '', password: '', confirm: '' }

const EMPTY_COMPANY = {
  company_name: '',
  app_name: 'FACTOR PRO',
  brand_logo_path: '',
  brand_logo_name: '',
  company_document: '',
  company_phone: '',
  company_email: '',
  company_address: '',
  company_city: '',
  company_state: '',
  company_signature: '',
}

const TABS = [
  { key: 'perfil', label: 'Meu perfil', icon: 'bi-person-circle' },
  { key: 'seguranca', label: 'Segurança', icon: 'bi-shield-lock' },
  { key: 'aparencia', label: 'Aparência', icon: 'bi-palette' },
  { key: 'empresa', label: 'Dados da empresa', icon: 'bi-building', adminOnly: true },
  { key: 'backup', label: 'Backup diário', icon: 'bi-hdd-stack', adminOnly: true },
  { key: 'aplicativo', label: 'Aplicativo', icon: 'bi-phone' },
]

const EMPTY_BACKUP = {
  backup_enabled: 'true',
  backup_time: '03:00',
  backup_retention_days: '7',
  backup_include_uploads: 'true',
  backup_last_at: '',
  backup_last_error: '',
}

function formatBytes(value) {
  const bytes = Number(value) || 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function profileInitials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function validatePassword(form) {
  const errors = {}
  if (!form.current) errors.current = 'Informe a senha atual.'
  if (form.password.length < 8) errors.password = 'A nova senha deve ter no mínimo 8 caracteres.'
  else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
    errors.password = 'A nova senha deve conter letras e números.'
  } else if (form.password === form.current) {
    errors.password = 'A nova senha deve ser diferente da atual.'
  }
  if (form.password !== form.confirm) errors.confirm = 'As senhas não conferem.'
  return errors
}

export default function Settings() {
  const { user, isAdmin, setUser } = useAuth()
  const { appName, refreshBrand } = useBrand()
  const { theme, setTheme } = useTheme()
  const toast = useToast()
  const { canInstall, install, installed } = useInstallPrompt()
  const [params, setParams] = useSearchParams()

  const requestedTab = params.get('tab') || 'perfil'
  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin)
  const activeTab = visibleTabs.some((tab) => tab.key === requestedTab) ? requestedTab : 'perfil'

  const setTab = (key) => {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }

  // --- Password ---------------------------------------------------------
  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD)
  const [passwordErrors, setPasswordErrors] = useState({})
  const [passwordMessage, setPasswordMessage] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const updatePassword = (field) => (event) => {
    setPasswordForm((current) => ({ ...current, [field]: event.target.value }))
    setPasswordErrors((current) => ({ ...current, [field]: undefined }))
    setPasswordMessage('')
  }

  const submitPassword = async (event) => {
    event.preventDefault()
    const errors = validatePassword(passwordForm)
    setPasswordErrors(errors)
    if (Object.keys(errors).length) return
    setSavingPassword(true)
    setPasswordMessage('')
    try {
      const { data } = await authApi.changePassword(passwordForm.current, passwordForm.password)
      setPasswordForm(EMPTY_PASSWORD)
      setUser((current) => ({ ...current, must_change_password: false }))
      toast.success('Senha alterada', data.message)
    } catch (error) {
      const parsed = apiError(error)
      const mapped = { ...parsed.errors }
      if (mapped.new_password && !mapped.password) mapped.password = mapped.new_password
      setPasswordErrors(mapped)
      setPasswordMessage(parsed.message)
    } finally {
      setSavingPassword(false)
    }
  }

  // --- Company settings (ADMIN) ----------------------------------------
  const [company, setCompany] = useState(EMPTY_COMPANY)
  const [companyLoading, setCompanyLoading] = useState(isAdmin)
  const [companyLoadError, setCompanyLoadError] = useState('')
  const [companyErrors, setCompanyErrors] = useState({})
  const [companyMessage, setCompanyMessage] = useState('')
  const [savingCompany, setSavingCompany] = useState(false)

  const loadCompany = useCallback(async () => {
    if (!isAdmin) return
    setCompanyLoading(true)
    setCompanyLoadError('')
    try {
      const { data } = await settingsApi.get()
      setCompany({ ...EMPTY_COMPANY, ...data.settings })
    } catch (error) {
      setCompanyLoadError(apiError(error).message)
    } finally {
      setCompanyLoading(false)
    }
  }, [isAdmin])

  useEffect(() => {
    loadCompany()
  }, [loadCompany])

  // --- Branding: app name + single logo reused everywhere ----------------
  const [logoFile, setLogoFile] = useState(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [removingLogo, setRemovingLogo] = useState(false)
  const [logoPreview, setLogoPreview] = useState(null)

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview)
  }, [logoPreview])

  const onLogoChange = (event) => {
    const file = event.target.files?.[0] || null
    setLogoFile(file)
    if (logoPreview) URL.revokeObjectURL(logoPreview)
    setLogoPreview(file ? URL.createObjectURL(file) : null)
  }

  const applyBrandSettings = (settings, message) => {
    setCompany((current) => ({ ...current, ...settings }))
    setLogoFile(null)
    if (logoPreview) URL.revokeObjectURL(logoPreview)
    setLogoPreview(null)
    refreshBrand()
    toast.success('Marca atualizada', message)
  }

  const submitLogo = async (event) => {
    event.preventDefault()
    if (!logoFile) return
    setUploadingLogo(true)
    try {
      const { data } = await settingsApi.uploadLogo(logoFile)
      applyBrandSettings(data.settings, data.message)
    } catch (error) {
      toast.error('Não foi possível enviar o logotipo', apiError(error).message)
    } finally {
      setUploadingLogo(false)
    }
  }

  const removeLogoImage = async () => {
    setRemovingLogo(true)
    try {
      const { data } = await settingsApi.removeLogo()
      applyBrandSettings(data.settings, data.message)
    } catch (error) {
      toast.error('Não foi possível remover o logotipo', apiError(error).message)
    } finally {
      setRemovingLogo(false)
    }
  }

  const updateCompany = (field) => (value) => {
    setCompany((current) => ({ ...current, [field]: value }))
    setCompanyErrors((current) => ({ ...current, [field]: undefined }))
    setCompanyMessage('')
  }

  const updateCompanyEvent = (field) => (event) => updateCompany(field)(event.target.value)

  const submitCompany = async (event) => {
    event.preventDefault()
    const errors = {}
    if (!company.company_name.trim() || company.company_name.trim().length < 2) {
      errors.company_name = 'Informe o nome da empresa.'
    }
    if (!company.app_name?.trim() || company.app_name.trim().length < 2) {
      errors.app_name = 'Informe o nome do aplicativo.'
    }
    if (company.company_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.company_email)) {
      errors.company_email = 'E-mail inválido.'
    }
    setCompanyErrors(errors)
    if (Object.keys(errors).length) return
    setSavingCompany(true)
    setCompanyMessage('')
    try {
      const { data } = await settingsApi.update({
        ...company,
        company_name: company.company_name.trim(),
        app_name: company.app_name.trim(),
        company_email: company.company_email.trim(),
        company_state: company.company_state.toUpperCase(),
      })
      setCompany({ ...EMPTY_COMPANY, ...data.settings })
      refreshBrand()
      toast.success('Configurações salvas', data.message)
    } catch (error) {
      const parsed = apiError(error)
      setCompanyErrors(parsed.errors || {})
      setCompanyMessage(parsed.message)
    } finally {
      setSavingCompany(false)
    }
  }

  // --- Daily backup (ADMIN) ----------------------------------------------
  const [backupForm, setBackupForm] = useState(EMPTY_BACKUP)
  const [backups, setBackups] = useState([])
  const [schedulerEnabled, setSchedulerEnabled] = useState(true)
  const [backupLoading, setBackupLoading] = useState(isAdmin)
  const [backupErrors, setBackupErrors] = useState({})
  const [savingBackup, setSavingBackup] = useState(false)
  const [runningBackup, setRunningBackup] = useState(false)
  const [deletingBackup, setDeletingBackup] = useState('')

  const loadBackup = useCallback(async () => {
    if (!isAdmin) return
    setBackupLoading(true)
    try {
      const { data } = await settingsApi.backupStatus()
      setBackupForm({ ...EMPTY_BACKUP, ...data.settings })
      setBackups(data.backups || [])
      setSchedulerEnabled(Boolean(data.scheduler_enabled))
    } catch (error) {
      toast.error('Não foi possível carregar o backup', apiError(error).message)
    } finally {
      setBackupLoading(false)
    }
  }, [isAdmin, toast])

  useEffect(() => {
    loadBackup()
  }, [loadBackup])

  const updateBackup = (field) => (event) => {
    setBackupForm((current) => ({ ...current, [field]: event.target.value }))
    setBackupErrors((current) => ({ ...current, [field]: undefined }))
  }

  const submitBackup = async (event) => {
    event.preventDefault()
    setSavingBackup(true)
    setBackupErrors({})
    try {
      const { data } = await settingsApi.saveBackup(backupForm)
      setBackupForm({ ...EMPTY_BACKUP, ...data.settings })
      setBackups(data.backups || [])
      toast.success('Backup configurado', data.message)
    } catch (error) {
      const parsed = apiError(error)
      setBackupErrors(parsed.errors || {})
      toast.error('Não foi possível salvar', parsed.message)
    } finally {
      setSavingBackup(false)
    }
  }

  const runBackup = async () => {
    setRunningBackup(true)
    try {
      const { data } = await settingsApi.runBackup()
      setBackups(data.backups || [])
      setBackupForm((current) => ({ ...current, backup_last_at: data.item?.created_at || current.backup_last_at, backup_last_error: '' }))
      toast.success('Backup criado', `${data.item?.name || 'Arquivo'} salvo com sucesso.`)
    } catch (error) {
      toast.error('Não foi possível criar o backup', apiError(error).message)
    } finally {
      setRunningBackup(false)
    }
  }

  const downloadBackupFile = async (name) => {
    try {
      await settingsApi.downloadBackup(name)
    } catch (error) {
      toast.error('Não foi possível baixar o backup', apiError(error).message)
    }
  }

  const removeBackupFile = async (name) => {
    setDeletingBackup(name)
    try {
      const { data } = await settingsApi.deleteBackup(name)
      setBackups(data.backups || [])
      toast.success('Backup removido', data.message)
    } catch (error) {
      toast.error('Não foi possível remover o backup', apiError(error).message)
    } finally {
      setDeletingBackup('')
    }
  }

  const handleInstall = async () => {
    const choice = await install()
    if (choice?.outcome === 'accepted') {
      toast.success('Aplicativo instalado', `O ${appName} foi adicionado ao seu dispositivo.`)
    }
  }

  const passwordStrength = useMemo(() => {
    const value = passwordForm.password
    if (!value) return 0
    let score = 0
    if (value.length >= 8) score += 1
    if (/[A-Za-z]/.test(value) && /\d/.test(value)) score += 1
    if (value.length >= 12) score += 1
    if (/[^A-Za-z0-9]/.test(value)) score += 1
    return score
  }, [passwordForm.password])

  return (
    <div className="page">
      <PageHeader
        title="Configurações"
        subtitle="Perfil, segurança, aparência, marca e dados institucionais do aplicativo."
        icon="bi-gear-fill"
      />

      <div className="fp-panel settings-shell">
        <div className="fp-tabs" role="tablist">
          {visibleTabs.map((tab) => (
            <button
              type="button"
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`fp-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setTab(tab.key)}
            >
              <i className={`bi ${tab.icon}`} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="tab-body">
          {activeTab === 'perfil' && (
            <div className="settings-layout">
              <div className="settings-main">
                <Panel title="Dados do usuário" icon="bi-person-vcard">
                  <div className="profile-card">
                    <span className="profile-avatar">{profileInitials(user?.name)}</span>
                    <div className="profile-main">
                      <strong>{user?.name}</strong>
                      <span>{user?.email}</span>
                      <span className={`fp-badge fp-badge-${user?.role === 'ADMIN' ? 'petroleum' : user?.role === 'OPERATOR' ? 'success' : 'neutral'}`}>
                        <i className="bi bi-shield-check" /> {user?.role_label}
                      </span>
                    </div>
                  </div>

                  <dl className="detail-grid mt-3">
                    <div>
                      <dt>Perfil de acesso</dt>
                      <dd>{user?.role_label}</dd>
                    </div>
                    <div>
                      <dt>Situação</dt>
                      <dd>{user?.is_active ? 'Ativo' : 'Inativo'}</dd>
                    </div>
                    <div>
                      <dt>Último acesso</dt>
                      <dd>{formatDateTime(user?.last_login_at)}</dd>
                    </div>
                    <div>
                      <dt>Conta criada em</dt>
                      <dd>{formatDateTime(user?.created_at)}</dd>
                    </div>
                  </dl>
                </Panel>

                <Panel title="Permissões do seu perfil" icon="bi-shield-check">
                  <ul className="permission-list">
                    {user?.role === 'ADMIN' && (
                      <>
                        <li><i className="bi bi-check-circle-fill" /> Acesso completo a clientes, cheques, boletos e configurações.</li>
                        <li><i className="bi bi-check-circle-fill" /> Gestão de usuários, auditoria e dados da empresa.</li>
                        <li><i className="bi bi-check-circle-fill" /> Exclusão lógica de clientes e documentos.</li>
                      </>
                    )}
                    {user?.role === 'OPERATOR' && (
                      <>
                        <li><i className="bi bi-check-circle-fill" /> Cadastro e edição de clientes, cheques e boletos.</li>
                        <li><i className="bi bi-check-circle-fill" /> Alteração de status e envio de anexos.</li>
                        <li><i className="bi bi-x-circle text-muted" /> Sem acesso à administração de usuários ou exclusões.</li>
                      </>
                    )}
                    {user?.role === 'VIEWER' && (
                      <>
                        <li><i className="bi bi-check-circle-fill" /> Consulta de clientes, cheques, boletos e dashboard.</li>
                        <li><i className="bi bi-x-circle text-muted" /> Sem permissão para cadastrar ou alterar registros.</li>
                      </>
                    )}
                  </ul>
                </Panel>
              </div>

              <aside className="settings-side">
                <div className="info-note">
                  <i className="bi bi-info-circle" />
                  <div>
                    <strong>Alteração de nome e e-mail</strong>
                    <p>
                      Por segurança, nome e e-mail são alterados apenas pelo administrador, em
                      Administração → Usuários. Fale com o responsável pelo sistema caso precise corrigir
                      esses dados.
                    </p>
                  </div>
                </div>
                <div className="info-note">
                  <i className="bi bi-shield-lock" />
                  <div>
                    <strong>Privacidade (LGPD)</strong>
                    <p>
                      Seus dados são usados exclusivamente para autenticação e registro de auditoria. As
                      ações realizadas no sistema ficam vinculadas ao seu usuário.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          )}

          {activeTab === 'seguranca' && (
            <div className="settings-layout">
              <div className="settings-main">
                <Panel title="Alterar senha" subtitle="Use pelo menos 8 caracteres, com letras e números." icon="bi-key">
                  {passwordMessage && (
                    <div className="alert alert-danger fp-alert" role="alert">
                      <i className="bi bi-exclamation-octagon-fill" /> {passwordMessage}
                    </div>
                  )}
                  <form onSubmit={submitPassword} className="form-grid" noValidate>
                    <Field
                      label="Senha atual"
                      name="current_password"
                      type="password"
                      icon="bi-lock"
                      autoComplete="current-password"
                      className="span-2"
                      value={passwordForm.current}
                      onChange={updatePassword('current')}
                      error={passwordErrors.current || passwordErrors.current_password}
                      required
                    />
                    <Field
                      label="Nova senha"
                      name="new_password"
                      type="password"
                      icon="bi-shield-lock"
                      autoComplete="new-password"
                      value={passwordForm.password}
                      onChange={updatePassword('password')}
                      error={passwordErrors.password || passwordErrors.new_password}
                      hint="Mínimo de 8 caracteres, contendo letras e números."
                      required
                    />
                    <Field
                      label="Confirmar nova senha"
                      name="confirm_password"
                      type="password"
                      icon="bi-shield-check"
                      autoComplete="new-password"
                      value={passwordForm.confirm}
                      onChange={updatePassword('confirm')}
                      error={passwordErrors.confirm}
                      required
                    />
                    <div className="span-2">
                      <div className="password-strength" aria-hidden="true">
                        {[1, 2, 3, 4].map((level) => (
                          <span
                            key={level}
                            className={
                              passwordStrength >= level
                                ? passwordStrength >= 3
                                  ? 'strong'
                                  : 'medium'
                                : ''
                            }
                          />
                        ))}
                      </div>
                      <span className="fp-field-hint">
                        Uma senha forte combina letras, números, símbolos e maior comprimento.
                      </span>
                    </div>
                    <div className="span-2 form-actions">
                      <button type="submit" className="btn btn-primary" disabled={savingPassword}>
                        {savingPassword ? (
                          <>
                            <span className="spinner-border spinner-border-sm" aria-hidden="true" /> Salvando…
                          </>
                        ) : (
                          <>
                            <i className="bi bi-check2" /> Alterar senha
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </Panel>
              </div>

              <aside className="settings-side">
                <Panel title="Sessão e segurança" icon="bi-shield-lock">
                  <ul className="permission-list">
                    <li><i className="bi bi-check-circle-fill" /> Token de acesso mantido apenas em memória.</li>
                    <li><i className="bi bi-check-circle-fill" /> Renovação por cookie httpOnly, inacessível ao JavaScript.</li>
                    <li><i className="bi bi-check-circle-fill" /> Tentativas de login limitadas contra força bruta.</li>
                  </ul>
                </Panel>
                <div className="info-note">
                  <i className="bi bi-exclamation-triangle" />
                  <div>
                    <strong>Senhas provisórias</strong>
                    <p>
                      Ao redefinir sua senha pelo administrador, o sistema exige a troca no próximo acesso.
                      Nunca compartilhe sua senha com outra pessoa.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          )}

          {activeTab === 'aparencia' && (
            <div className="settings-layout">
              <div className="settings-main">
                <Panel
                  title="Tema da interface"
                  subtitle="A preferência fica salva neste navegador e é aplicada automaticamente."
                  icon="bi-palette"
                >
                  <div className="theme-options">
                    <button
                      type="button"
                      className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                      onClick={() => setTheme('light')}
                      aria-pressed={theme === 'light'}
                    >
                      <span className="theme-preview light">
                        <span className="theme-preview-sidebar" />
                        <span className="theme-preview-body">
                          <span />
                          <span />
                          <span />
                        </span>
                      </span>
                      <span className="theme-option-label">
                        <i className="bi bi-sun-fill" /> Claro
                        {theme === 'light' && <span className="fp-badge fp-badge-success fp-badge-sm">Em uso</span>}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                      onClick={() => setTheme('dark')}
                      aria-pressed={theme === 'dark'}
                    >
                      <span className="theme-preview dark">
                        <span className="theme-preview-sidebar" />
                        <span className="theme-preview-body">
                          <span />
                          <span />
                          <span />
                        </span>
                      </span>
                      <span className="theme-option-label">
                        <i className="bi bi-moon-stars-fill" /> Escuro
                        {theme === 'dark' && <span className="fp-badge fp-badge-success fp-badge-sm">Em uso</span>}
                      </span>
                    </button>
                  </div>
                  <div className="inline-alert info mt-3">
                    <i className="bi bi-info-circle-fill" />
                    <span>
                      O tema é salvo apenas neste navegador. Em outro dispositivo, escolha novamente a
                      preferência de exibição.
                    </span>
                  </div>
                </Panel>

                <Panel title="Identidade visual" icon="bi-brush">
                  <div className="palette-row">
                    <span><em style={{ background: '#123D32' }} /> Verde escuro</span>
                    <span><em style={{ background: '#16845B' }} /> Verde</span>
                    <span><em style={{ background: '#DDF4E8' }} /> Verde claro</span>
                    <span><em style={{ background: '#173B57' }} /> Azul petróleo</span>
                    <span><em style={{ background: '#F4F7F6' }} /> Fundo claro</span>
                    <span><em style={{ background: '#101B1A' }} /> Fundo escuro</span>
                  </div>
                </Panel>
              </div>

              <aside className="settings-side">
                <div className="info-note">
                  <i className="bi bi-phone" />
                  <div>
                    <strong>Layout responsivo</strong>
                    <p>
                      O menu lateral pode ser recolhido no desktop e abre como gaveta em telas pequenas. A
                      preferência de recolhimento também é salva no navegador.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          )}

          {activeTab === 'empresa' && isAdmin && (
            <div className="settings-layout">
              <div className="settings-main">
                <Panel
                  title="Marca do aplicativo"
                  subtitle="Personalize o nome e o ícone usados no menu, no PWA e em todas as exportações."
                  icon="bi-palette"
                >
                  <div className="brand-settings">
                    <div className="brand-logo-preview" aria-label="Prévia do logotipo">
                      {logoPreview || company.brand_logo_path ? (
                        <img
                          src={logoPreview || '/api/settings/brand/logo'}
                          alt="Logotipo da empresa"
                        />
                      ) : (
                        <i className="bi bi-image" aria-hidden="true" />
                      )}
                    </div>
                    <div className="brand-logo-info">
                      <strong>{company.brand_logo_name || 'Logotipo padrão'}</strong>
                      <p>
                        Um único arquivo é usado como ícone do aplicativo (favicon, menu e PWA) e como
                        logotipo em PDF, planilhas, recibos e duplicatas.
                      </p>
                      <form onSubmit={submitLogo} className="brand-logo-actions">
                        <label className="btn btn-outline-primary btn-sm mb-0">
                          <i className="bi bi-upload" /> Escolher imagem
                          <input
                            type="file"
                            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                            onChange={onLogoChange}
                            hidden
                          />
                        </label>
                        {logoFile && (
                          <button type="submit" className="btn btn-primary btn-sm" disabled={uploadingLogo}>
                            {uploadingLogo ? (
                              <>
                                <span className="spinner-border spinner-border-sm" aria-hidden="true" /> Enviando…
                              </>
                            ) : (
                              <><i className="bi bi-check2" /> Salvar logotipo</>
                            )}
                          </button>
                        )}
                        {company.brand_logo_path && (
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            onClick={removeLogoImage}
                            disabled={removingLogo}
                          >
                            {removingLogo ? (
                              <><span className="spinner-border spinner-border-sm" aria-hidden="true" /> Removendo…</>
                            ) : (
                              <><i className="bi bi-trash3" /> Remover</>
                            )}
                          </button>
                        )}
                      </form>
                      <small className="text-muted">PNG, JPG ou WEBP · até 10 MB.</small>
                    </div>
                  </div>
                  <div className="form-grid brand-name-field">
                    <Field
                      label="Nome do aplicativo"
                      name="app_name"
                      icon="bi-type"
                      className="span-2"
                      value={company.app_name}
                      onChange={updateCompanyEvent('app_name')}
                      error={companyErrors.app_name}
                      maxLength={60}
                      hint="Exibido no menu, na tela de login, no PWA e no cabeçalho das exportações."
                      required
                    />
                  </div>
                  <p className="brand-hint">
                    <i className="bi bi-info-circle" /> O nome é salvo junto com os dados da empresa pelo botão
                    “Salvar configurações” abaixo. A imagem é salva imediatamente ao escolher “Salvar logotipo”.
                  </p>
                </Panel>

                <Panel
                  title="Dados da empresa"
                  subtitle="Usados em relatórios, exportações e mensagens geradas pelo sistema."
                  icon="bi-building"
                >
                  {companyLoading ? (
                    <LoadingBlock label="Carregando dados da empresa…" />
                  ) : companyLoadError ? (
                    <ErrorBlock message={companyLoadError} onRetry={loadCompany} />
                  ) : (
                    <>
                      {companyMessage && (
                        <div className="alert alert-danger fp-alert" role="alert">
                          <i className="bi bi-exclamation-octagon-fill" /> {companyMessage}
                        </div>
                      )}
                      <form onSubmit={submitCompany} className="form-grid" noValidate>
                        <Field
                          label="Nome / Razão social"
                          name="company_name"
                          icon="bi-building"
                          className="span-2"
                          value={company.company_name}
                          onChange={updateCompanyEvent('company_name')}
                          error={companyErrors.company_name}
                          maxLength={120}
                          required
                        />
                        <DocumentField
                          label="CPF / CNPJ da empresa"
                          value={company.company_document}
                          onChange={updateCompany('company_document')}
                          error={companyErrors.company_document}
                        />
                        <PhoneField
                          label="Telefone"
                          value={company.company_phone}
                          onChange={updateCompany('company_phone')}
                          error={companyErrors.company_phone}
                        />
                        <Field
                          label="E-mail"
                          name="company_email"
                          type="email"
                          icon="bi-envelope"
                          className="span-2"
                          value={company.company_email}
                          onChange={updateCompanyEvent('company_email')}
                          error={companyErrors.company_email}
                          autoComplete="email"
                        />
                        <Field
                          label="Endereço"
                          name="company_address"
                          icon="bi-signpost"
                          className="span-2"
                          value={company.company_address}
                          onChange={updateCompanyEvent('company_address')}
                          error={companyErrors.company_address}
                          maxLength={220}
                        />
                        <Field
                          label="Cidade"
                          name="company_city"
                          icon="bi-geo-alt"
                          value={company.company_city}
                          onChange={updateCompanyEvent('company_city')}
                          error={companyErrors.company_city}
                          maxLength={120}
                        />
                        <Field label="UF" name="company_state" error={companyErrors.company_state}>
                          <select
                            className="form-select fp-input"
                            value={company.company_state}
                            onChange={updateCompanyEvent('company_state')}
                          >
                            <option value="">—</option>
                            {STATES.map((uf) => (
                              <option key={uf} value={uf}>{uf}</option>
                            ))}
                          </select>
                        </Field>
                        <Field
                          label="Assinatura padrão"
                          name="company_signature"
                          as="textarea"
                          rows={4}
                          className="span-2"
                          value={company.company_signature}
                          onChange={updateCompanyEvent('company_signature')}
                          error={companyErrors.company_signature}
                          maxLength={500}
                          hint="Texto usado ao final de mensagens e documentos gerados."
                        />
                        <div className="span-2 form-actions">
                          <button type="button" className="btn btn-light" onClick={loadCompany} disabled={savingCompany}>
                            <i className="bi bi-arrow-counterclockwise" /> Recarregar
                          </button>
                          <button type="submit" className="btn btn-primary" disabled={savingCompany}>
                            {savingCompany ? (
                              <>
                                <span className="spinner-border spinner-border-sm" aria-hidden="true" /> Salvando…
                              </>
                            ) : (
                              <>
                                <i className="bi bi-check2" /> Salvar configurações
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    </>
                  )}
                </Panel>
              </div>

              <aside className="settings-side">
                <div className="info-note">
                  <i className="bi bi-shield-lock" />
                  <div>
                    <strong>Acesso restrito</strong>
                    <p>
                      Somente administradores podem alterar os dados da empresa. Todas as mudanças são
                      registradas na auditoria com valores anteriores e novos.
                    </p>
                  </div>
                </div>
                <div className="info-note">
                  <i className="bi bi-signpost-split" />
                  <div>
                    <strong>Onde aparecem</strong>
                    <p>
                      Estes dados aparecem em relatórios, recibos, duplicatas e mensagens geradas. Nenhuma
                      mensagem é enviada automaticamente — o sistema apenas prepara o texto para conferência.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          )}

          {activeTab === 'backup' && isAdmin && (
            <div className="settings-layout">
              <div className="settings-main">
                <Panel
                  title="Backup diário"
                  subtitle="Uma cópia automática do banco e dos anexos é salva todos os dias, sem apagar os dados originais."
                  icon="bi-hdd-stack"
                >
                  {backupLoading ? (
                    <LoadingBlock label="Carregando configuração de backup…" />
                  ) : (
                    <>
                      <form onSubmit={submitBackup} className="form-grid" noValidate>
                        <div className="span-2 backup-toggle">
                          <label className="fp-check">
                            <input
                              type="checkbox"
                              checked={backupForm.backup_enabled === 'true'}
                              onChange={(event) =>
                                setBackupForm((current) => ({
                                  ...current,
                                  backup_enabled: event.target.checked ? 'true' : 'false',
                                }))
                              }
                            />
                            <span>
                              <strong>Ativar backup automático</strong>
                              <small>
                                {schedulerEnabled
                                  ? 'O agendador está ativo nesta instância.'
                                  : 'O agendador está desativado nesta instância; apenas backups manuais funcionarão.'}
                              </small>
                            </span>
                          </label>
                        </div>
                        <Field
                          label="Horário do backup diário"
                          name="backup_time"
                          type="time"
                          icon="bi-clock"
                          value={backupForm.backup_time}
                          onChange={updateBackup('backup_time')}
                          error={backupErrors.backup_time}
                          hint="Horário local do servidor em que a cópia automática é criada."
                          required
                        />
                        <Field
                          label="Manter por quantos dias"
                          name="backup_retention_days"
                          type="number"
                          icon="bi-calendar3"
                          min={1}
                          max={365}
                          value={backupForm.backup_retention_days}
                          onChange={updateBackup('backup_retention_days')}
                          error={backupErrors.backup_retention_days}
                          hint="Backups mais antigos que esse prazo são removidos automaticamente."
                          required
                        />
                        <div className="span-2 backup-toggle">
                          <label className="fp-check">
                            <input
                              type="checkbox"
                              checked={backupForm.backup_include_uploads === 'true'}
                              onChange={(event) =>
                                setBackupForm((current) => ({
                                  ...current,
                                  backup_include_uploads: event.target.checked ? 'true' : 'false',
                                }))
                              }
                            />
                            <span>
                              <strong>Incluir anexos e fotos no backup</strong>
                              <small>Recomendado: garante que os documentos enviados também sejam restauráveis.</small>
                            </span>
                          </label>
                        </div>
                        <div className="span-2 form-actions">
                          <button type="button" className="btn btn-light" onClick={loadBackup} disabled={savingBackup}>
                            <i className="bi bi-arrow-counterclockwise" /> Recarregar
                          </button>
                          <button type="submit" className="btn btn-primary" disabled={savingBackup}>
                            {savingBackup ? (
                              <><span className="spinner-border spinner-border-sm" aria-hidden="true" /> Salvando…</>
                            ) : (
                              <><i className="bi bi-check2" /> Salvar configuração</>
                            )}
                          </button>
                        </div>
                      </form>

                      <div className="backup-status">
                        <div>
                          <span>Último backup</span>
                          <strong>
                            {backupForm.backup_last_at
                              ? formatDateTime(backupForm.backup_last_at)
                              : 'Nenhum backup registrado'}
                          </strong>
                        </div>
                        <div>
                          <span>Arquivos guardados</span>
                          <strong>{backups.length}</strong>
                        </div>
                        <button type="button" className="btn btn-outline-primary" onClick={runBackup} disabled={runningBackup}>
                          {runningBackup ? (
                            <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Criando…</>
                          ) : (
                            <><i className="bi bi-hdd-stack" /> Criar backup agora</>
                          )}
                        </button>
                      </div>
                      {backupForm.backup_last_error && (
                        <div className="inline-alert danger mt-2">
                          <i className="bi bi-exclamation-triangle-fill" />
                          <span>Último erro: {backupForm.backup_last_error}</span>
                        </div>
                      )}
                    </>
                  )}
                </Panel>

                <Panel title="Backups salvos" subtitle="Baixe uma cópia para guardar em outro local ou remova arquivos antigos." icon="bi-archive">
                  {backups.length ? (
                    <ul className="backup-list">
                      {backups.map((entry) => (
                        <li key={entry.name}>
                          <i className="bi bi-file-earmark-zip" />
                          <div>
                            <strong>{entry.name}</strong>
                            <span>{formatDateTime(entry.created_at)} · {formatBytes(entry.size)}</span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => downloadBackupFile(entry.name)}
                            aria-label={`Baixar ${entry.name}`}
                          >
                            <i className="bi bi-download" /> Baixar
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-link text-danger"
                            onClick={() => removeBackupFile(entry.name)}
                            disabled={deletingBackup === entry.name}
                            aria-label={`Remover ${entry.name}`}
                          >
                            <i className="bi bi-trash3" /> {deletingBackup === entry.name ? 'Removendo…' : 'Remover'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="panel-hint">Nenhum backup salvo ainda. Use “Criar backup agora” para gerar o primeiro.</p>
                  )}
                </Panel>
              </div>

              <aside className="settings-side">
                <div className="info-note">
                  <i className="bi bi-shield-check" />
                  <div>
                    <strong>Segurança dos dados</strong>
                    <p>
                      O backup é um arquivo ZIP com o banco e, opcionalmente, os anexos. Ele fica no servidor
                      em uma pasta protegida e nunca substitui ou altera os dados do aplicativo.
                    </p>
                  </div>
                </div>
                <div className="info-note">
                  <i className="bi bi-exclamation-triangle" />
                  <div>
                    <strong>Boas práticas</strong>
                    <p>
                      Baixe o arquivo periodicamente e guarde-o em outro local (nuvem ou unidade externa).
                      Assim, uma falha no servidor não impede a recuperação das informações dos clientes.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          )}

          {activeTab === 'aplicativo' && (
            <div className="settings-layout">
              <div className="settings-main">
                <Panel title={`Instalar o ${appName}`} subtitle="Use como aplicativo no computador ou celular." icon="bi-phone">
                  <div className={`install-card ${installed ? 'installed' : ''}`}>
                    <span className="install-icon">
                      <i className={`bi ${installed ? 'bi-check-circle-fill' : 'bi-download'}`} />
                    </span>
                    <div>
                      <strong>{installed ? 'Aplicativo instalado' : 'Instalação disponível pelo navegador'}</strong>
                      <p>
                        {installed
                          ? `O ${appName} está sendo executado como aplicativo instalado neste dispositivo.`
                          : canInstall
                            ? 'Clique no botão para instalar. O aplicativo abre em janela própria e mantém o mesmo login seguro.'
                            : 'Se o botão de instalação não aparecer, use o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela de início”.'}
                      </p>
                    </div>
                    {canInstall && !installed && (
                      <button type="button" className="btn btn-primary" onClick={handleInstall}>
                        <i className="bi bi-download" /> Instalar aplicativo
                      </button>
                    )}
                  </div>

                  <div className="install-steps">
                    <h4><i className="bi bi-windows" /> No computador (Chrome ou Edge)</h4>
                    <ol>
                      <li>Abra o menu do navegador (três pontos).</li>
                      <li>Escolha “Instalar {appName}” ou “Aplicativos → Instalar este site”.</li>
                      <li>Confirme a instalação e abra pelo atalho criado.</li>
                    </ol>
                    <h4><i className="bi bi-apple" /> No iPhone ou iPad (Safari)</h4>
                    <ol>
                      <li>Toque no botão Compartilhar.</li>
                      <li>Escolha “Adicionar à Tela de Início”.</li>
                      <li>Confirme o nome {appName} e toque em Adicionar.</li>
                    </ol>
                    <h4><i className="bi bi-android2" /> No Android (Chrome)</h4>
                    <ol>
                      <li>Abra o menu do navegador (três pontos).</li>
                      <li>Toque em “Instalar aplicativo” ou “Adicionar à tela inicial”.</li>
                      <li>Confirme a instalação.</li>
                    </ol>
                  </div>
                </Panel>
              </div>

              <aside className="settings-side">
                <div className="info-note">
                  <i className="bi bi-wifi-off" />
                  <div>
                    <strong>Funcionamento offline</strong>
                    <p>
                      A estrutura visual do aplicativo pode abrir sem conexão, mas os dados financeiros
                      nunca são armazenados em cache: toda consulta à API exige internet.
                    </p>
                  </div>
                </div>
                <div className="info-note">
                  <i className="bi bi-shield-check" />
                  <div>
                    <strong>Sessão segura no app</strong>
                    <p>
                      A instalação não altera as regras de autenticação. O acesso continua protegido por
                      token de curta duração e cookie httpOnly de renovação.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>

      <div className="settings-about">
        <span><strong>{appName}</strong> · Gestão Financeira Inteligente</span>
        <span>Versão 1.6 · Etapa 8 — exportação em listas, backup, atendente e fotos</span>
      </div>
    </div>
  )
}
