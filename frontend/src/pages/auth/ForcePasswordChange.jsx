import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import Field from '../../components/form/Field'
import AuthLayout from '../../components/layout/AuthLayout'

export default function ForcePasswordChange() {
  const { user, setUser, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({ current: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setMessage('')
  }

  const submit = async (event) => {
    event.preventDefault()
    const nextErrors = {}
    if (!form.current) nextErrors.current = 'Informe a senha atual.'
    if (form.password.length < 8) nextErrors.password = 'A senha deve ter no mínimo 8 caracteres.'
    else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
      nextErrors.password = 'A senha deve conter letras e números.'
    }
    if (form.password !== form.confirm) nextErrors.confirm = 'As senhas não conferem.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setLoading(true)
    try {
      const { data } = await authApi.changePassword(form.current, form.password)
      setUser((current) => ({ ...current, must_change_password: false }))
      toast.success('Senha atualizada', data.message)
      navigate('/', { replace: true })
    } catch (error) {
      const parsed = apiError(error)
      setErrors(parsed.errors || {})
      setMessage(parsed.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      footer={
        <button type="button" className="link-button" onClick={() => logout()}>
          Sair desta conta
        </button>
      }
    >
      <div className="auth-card-title">
        <span className="auth-badge">Primeiro acesso</span>
        <h2>Defina uma nova senha</h2>
        <p>
          Olá, {user?.name?.split(' ')[0]}. Por segurança, altere a senha provisória antes de continuar
          usando o sistema.
        </p>
      </div>

      {message && (
        <div className="alert alert-danger fp-alert" role="alert">
          <i className="bi bi-exclamation-octagon-fill" /> {message}
        </div>
      )}

      <form onSubmit={submit} noValidate>
        <Field
          label="Senha atual (provisória)"
          name="current_password"
          type="password"
          icon="bi-lock"
          autoComplete="current-password"
          value={form.current}
          onChange={update('current')}
          error={errors.current_password || errors.current}
          required
        />
        <Field
          label="Nova senha"
          name="new_password"
          type="password"
          icon="bi-shield-lock"
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          value={form.password}
          onChange={update('password')}
          error={errors.new_password || errors.password}
          hint="Use letras e números. Não use a mesma senha provisória."
          required
        />
        <Field
          label="Confirmar nova senha"
          name="confirm_password"
          type="password"
          icon="bi-shield-check"
          autoComplete="new-password"
          value={form.confirm}
          onChange={update('confirm')}
          error={errors.confirm}
          required
        />
        <button type="submit" className="btn btn-primary btn-lg w-100 auth-submit" disabled={loading}>
          {loading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Salvando…
            </>
          ) : (
            <>
              <i className="bi bi-check2-circle" /> Salvar e continuar
            </>
          )}
        </button>
      </form>
    </AuthLayout>
  )
}
