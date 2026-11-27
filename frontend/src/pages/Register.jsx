import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api, fieldErrorsFrom } from '../api/client.js'
import { Field, FormMessage } from '../components/Field.jsx'
import { useSession } from '../session/SessionContext.jsx'

const EMPTY = { name: '', email: '', password: '' }

export default function Register() {
  const { user, status, signIn } = useSession()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
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
    try {
      // Only name, email and password are sent. There is deliberately no role
      // field: the server always creates role 'user' and ignores anything else.
      await api('/auth/register', { method: 'POST', body: form })
      await signIn(form.email, form.password)
      navigate('/donors', { replace: true })
    } catch (err) {
      const { fields, general } = fieldErrorsFrom(err)
      setErrors({ fields, message: general.join(' ') || err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h1>Create an account</h1>
      <FormMessage error={errors.message} />

      <form onSubmit={handleSubmit} noValidate>
        <Field label="Name" name="name" error={errors.fields.name} hint="2 to 100 characters">
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </Field>

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

        <Field
          label="Password"
          name="password"
          error={errors.fields.password}
          hint="8 to 72 characters, with at least one letter and one digit"
        >
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
          />
        </Field>

        <button className="btn btn-primary" type="submit" disabled={busy} data-testid="register-submit">
          {busy ? 'Creating…' : 'Register'}
        </button>
      </form>

      <p className="muted">
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </section>
  )
}
