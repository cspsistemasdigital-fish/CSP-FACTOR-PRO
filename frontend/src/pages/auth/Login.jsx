import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { apiError } from '../../api/client'
import Field from '../../components/form/Field'
import AuthLayout from '../../components/layout/AuthLayout'

export default function Login() {
  const { user, login } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  if (user) {
    return <Navigate to={user.must_change_password ? '/trocar-senha' : '/'} replace />
  }

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setMessage('')
  }

  const submit = async (event) => {
    event.preventDefault()
    const nextErrors = {}
    if (!form.email.trim()) nextErrors.email = 'Informe o e-mail.'
    if (!form.password) nextErrors.password = 'Informe a senha.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setLoading(true)
    setMessage('')
    try {
      await login(form.email.trim().toLowerCase(), form.password)
      toast.success('Bem-vindo de volta', 'Sessão iniciada com sucesso.')
      const from = location.state?.from?.pathname
      navigate(from && from !== '/login' ? from : '/', { replace: true })
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
          Problemas para acessar? <Link to="/esqueci-senha">Recuperar senha</Link>
        </span>
      }
    >
      <div className="auth-card-title">
        <span className="auth-badge">Acesso restrito</span>
        <h2>Entrar no FACTOR PRO</h2>
        <p>Informe suas credenciais para acessar a gestão financeira.</p>
      </div>

      {message && (
        <div className="alert alert-danger fp-alert" role="alert">
          <i className="bi bi-exclamation-octagon-fill" /> {message}
        </div>
      )}

      <form onSubmit={submit} noValidate>
        <Field
          label="E-mail"
          name="email"
          type="email"
          icon="bi-envelope"
          autoComplete="username"
          placeholder="seu.email@empresa.com.br"
          value={form.email}
          onChange={update('email')}
          error={errors.email}
          required
        />
        <Field
          label="Senha"
          name="password"
          type={showPassword ? 'text' : 'password'}
          icon="bi-lock"
          autoComplete="current-password"
          placeholder="Sua senha"
          value={form.password}
          onChange={update('password')}
          error={errors.password}
          required
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShowPassword((value) => !value)}
        >
          <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`} />
          {showPassword ? 'Ocultar senha' : 'Mostrar senha'}
        </button>

        <button type="submit" className="btn btn-primary btn-lg w-100 auth-submit" disabled={loading}>
          {loading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Entrando…
            </>
          ) : (
            <>
              <i className="bi bi-box-arrow-in-right" /> Entrar
            </>
          )}
        </button>
      </form>

      {import.meta.env.DEV && (
        <div className="auth-demo">
          <i className="bi bi-terminal" />
          <div>
            <strong>Ambiente local de desenvolvimento</strong>
            <span>Administrador: admin@factorpro.com.br · Senha: Admin@12345</span>
          </div>
        </div>
      )}
    </AuthLayout>
  )
}
