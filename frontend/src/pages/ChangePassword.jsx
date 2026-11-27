import { useState } from 'react'
import { api, fieldErrorsFrom } from '../api/client.js'
import { Field, FormMessage } from '../components/Field.jsx'

const EMPTY = { current_password: '', new_password: '' }

export default function ChangePassword() {
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({ fields: {}, message: '' })
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  function update(name, value) {
    setForm((f) => ({ ...f, [name]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setErrors({ fields: {}, message: '' })
    setDone('')
    try {
      // 400 = the new password is too weak, 401 = the current one is wrong.
      // Only the server can tell these apart, and it checks both.
      await api('/auth/password', { method: 'PUT', body: form })
      setForm(EMPTY)
      setDone('Password changed.')
    } catch (err) {
      const { fields, general } = fieldErrorsFrom(err)
      setErrors({ fields, message: general.join(' ') || err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h1>Change password</h1>
      <FormMessage error={errors.message} success={done} />

      <form onSubmit={handleSubmit} noValidate>
        <Field label="Current password" name="current_password" error={errors.fields.current_password}>
          <input
            id="current_password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            value={form.current_password}
            onChange={(e) => update('current_password', e.target.value)}
          />
        </Field>

        <Field
          label="New password"
          name="new_password"
          error={errors.fields.new_password}
          hint="8 to 72 characters, with at least one letter and one digit"
        >
          <input
            id="new_password"
            name="new_password"
            type="password"
            autoComplete="new-password"
            value={form.new_password}
            onChange={(e) => update('new_password', e.target.value)}
          />
        </Field>

        <button className="btn btn-primary" type="submit" disabled={busy} data-testid="password-submit">
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </section>
  )
}
