import { useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../../api'
import { apiError } from '../../api/client'
import Field from '../../components/form/Field'
import AuthLayout from '../../components/layout/AuthLayout'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [resetLink, setResetLink] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setResetLink('')
    if (!email.trim()) {
      setError('Informe o e-mail cadastrado.')
      return
    }
    setLoading(true)
    try {
      const { data } = await authApi.forgotPassword(email.trim().toLowerCase())
      setMessage(data.message)
      if (data.reset_token) {
        setResetLink(`/redefinir-senha?token=${encodeURIComponent(data.reset_token)}`)
      }
    } catch (requestError) {
      setError(apiError(requestError).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      footer={
        <span>
          Lembrou a senha? <Link to="/login">Voltar para o login</Link>
        </span>
      }
    >
      <div className="auth-card-title">
        <span className="auth-badge">Recuperação</span>
        <h2>Esqueceu sua senha?</h2>
        <p>Informe o e-mail cadastrado. Enviaremos as instruções de recuperação.</p>
      </div>

      {error && (
        <div className="alert alert-danger fp-alert" role="alert">
          <i className="bi bi-exclamation-octagon-fill" /> {error}
        </div>
      )}

      {message && (
        <div className="alert alert-success fp-alert" role="status">
          <i className="bi bi-check-circle-fill" /> {message}
        </div>
      )}

      {resetLink && (
        <div className="auth-dev-token">
          <strong>
            <i className="bi bi-tools" /> Modo desenvolvimento
          </strong>
          <p>
            O envio de e-mail ainda não está configurado nesta etapa. Use o link abaixo para redefinir a
            senha agora. Em produção o token é enviado por e-mail e nunca exibido na tela.
          </p>
          <Link className="btn btn-outline-primary btn-sm" to={resetLink}>
            <i className="bi bi-key" /> Redefinir senha agora
          </Link>
        </div>
      )}

      {!resetLink && (
        <form onSubmit={submit} noValidate>
          <Field
            label="E-mail cadastrado"
            name="email"
            type="email"
            icon="bi-envelope"
            autoComplete="username"
            placeholder="seu.email@empresa.com.br"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError('')
            }}
            error={error}
            required
          />
          <button type="submit" className="btn btn-primary btn-lg w-100 auth-submit" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Enviando…
              </>
            ) : (
              <>
                <i className="bi bi-send" /> Enviar instruções
              </>
            )}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
