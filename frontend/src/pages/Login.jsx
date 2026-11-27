import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { fieldErrorsFrom } from '../api/client.js'
import { Field, FormMessage } from '../components/Field.jsx'
import { useSession } from '../session/SessionContext.jsx'

export default function Login() {
  const { user, status, signIn, sessionEnded, clearSessionEnded } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({ fields: {}, message: '' })
  const [busy, setBusy] = useState(false)

  if (status === 'ready' && user) return <Navigate to="/donors" replace />

  function update(name, value) {
    setForm((f) => ({ ...f, [name]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setErrors({ fields: {}, message: '' })
    clearSessionEnded()
    try {
      await signIn(form.email, form.password)
      navigate(location.state?.from ?? '/donors', { replace: true })
    } catch (err) {
      const { fields, general } = fieldErrorsFrom(err)
      // 429 comes from Nginx's limit_req on /api/v1/auth/login, not from the
      // backend; the client turns it into a readable sentence.
      setErrors({ fields, message: general.join(' ') || err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h1>Log in</h1>

      {sessionEnded && (
        <p className="notice notice-warn" data-testid="session-ended" role="status">
          Your session ended. Please log in again.
        </p>
      )}
      <FormMessage error={errors.message} />

      <form onSubmit={handleSubmit} noValidate>
        <Field label="Email" name="email" error={errors.fields.email}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
          />
        </Field>

        <Field label="Password" name="password" error={errors.fields.password}>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
          />
        </Field>

        <button className="btn btn-primary" type="submit" disabled={busy} data-testid="login-submit">
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p className="muted">
        No account yet? <Link to="/register">Register</Link>
      </p>
    </section>
  )
}
