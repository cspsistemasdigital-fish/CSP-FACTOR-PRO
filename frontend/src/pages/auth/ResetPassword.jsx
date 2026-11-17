import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../../api'
import { apiError } from '../../api/client'
import Field from '../../components/form/Field'
import AuthLayout from '../../components/layout/AuthLayout'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined, password: field === 'password' ? undefined : current.password }))
    setMessage('')
  }

  const submit = async (event) => {
    event.preventDefault()
    const nextErrors = {}
    if (form.password.length < 8) nextErrors.password = 'A senha deve ter no mínimo 8 caracteres.'
    else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
      nextErrors.password = 'A senha deve conter letras e números.'
    }
    if (form.password !== form.confirm) nextErrors.confirm = 'As senhas não conferem.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setLoading(true)
    try {
      const { data } = await authApi.resetPassword(token, form.password)
      setMessage(data.message)
      setDone(true)
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
        <span>
          <Link to="/login">Voltar para o login</Link>
        </span>
      }
    >
      <div className="auth-card-title">
        <span className="auth-badge">Nova senha</span>
        <h2>Redefinir senha</h2>
        <p>Escolha uma nova senha com pelo menos 8 caracteres, contendo letras e números.</p>
      </div>

      {!token && (
        <div className="alert alert-warning fp-alert" role="alert">
          <i className="bi bi-exclamation-triangle-fill" /> Link inválido: o token de recuperação não foi
          informado. Solicite uma nova recuperação em <Link to="/esqueci-senha">Esqueci minha senha</Link>.
        </div>
      )}

      {message && (
        <div className={`alert ${done ? 'alert-success' : 'alert-danger'} fp-alert`} role="alert">
          <i className={`bi ${done ? 'bi-check-circle-fill' : 'bi-exclamation-octagon-fill'}`} /> {message}
        </div>
      )}

      {done ? (
        <Link to="/login" className="btn btn-primary btn-lg w-100 auth-submit">
          <i className="bi bi-box-arrow-in-right" /> Entrar com a nova senha
        </Link>
      ) : (
        token && (
          <form onSubmit={submit} noValidate>
            <Field
              label="Nova senha"
              name="new_password"
              type="password"
              icon="bi-lock"
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
              value={form.password}
              onChange={update('password')}
              error={errors.password || errors.new_password}
              hint="Use letras e números. Evite dados pessoais fáceis de adivinhar."
              required
            />
            <Field
              label="Confirmar nova senha"
              name="confirm_password"
              type="password"
              icon="bi-lock-fill"
              autoComplete="new-password"
              placeholder="Repita a nova senha"
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
                  <i className="bi bi-shield-check" /> Salvar nova senha
                </>
              )}
            </button>
          </form>
        )
      )}
    </AuthLayout>
  )
}
