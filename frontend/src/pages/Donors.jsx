import { useCallback, useEffect, useState } from 'react'
import { api, fieldErrorsFrom } from '../api/client.js'
import { Field, FormMessage } from '../components/Field.jsx'
import { useSession } from '../session/SessionContext.jsx'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const EMPTY = { full_name: '', blood_group: 'O+', city: '', phone: '', available: true }

export default function Donors() {
  const { isAdmin } = useSession()
  const [donors, setDonors] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [errors, setErrors] = useState({ fields: {}, message: '' })
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  // GET /donors returns only the caller's own records; for an admin the server
  // returns every record plus owner_email. The filtering is the server's job.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDonors(await api('/donors'))
    } catch (err) {
      // A 401 is already handled globally (session ends, guard redirects).
      if (err.status !== 401) setErrors({ fields: {}, message: err.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function update(name, value) {
    setForm((f) => ({ ...f, [name]: value }))
  }

  function startEdit(donor) {
    setEditingId(donor.id)
    setConfirmingId(null)
    setErrors({ fields: {}, message: '' })
    setDone('')
    setForm({
      full_name: donor.full_name,
      blood_group: donor.blood_group,
      city: donor.city,
      phone: donor.phone,
      available: donor.available,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY)
    setErrors({ fields: {}, message: '' })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setErrors({ fields: {}, message: '' })
    setDone('')
    try {
      if (editingId === null) {
        await api('/donors', { method: 'POST', body: form })
        setDone('Donor record added.')
      } else {
        await api(`/donors/${editingId}`, { method: 'PUT', body: form })
        setDone('Donor record updated.')
      }
      setForm(EMPTY)
      setEditingId(null)
      await load()
    } catch (err) {
      const { fields, general } = fieldErrorsFrom(err)
      setErrors({ fields, message: general.join(' ') || err.message })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id) {
    setErrors({ fields: {}, message: '' })
    setDone('')
    try {
      await api(`/donors/${id}`, { method: 'DELETE' })
      setConfirmingId(null)
      if (editingId === id) cancelEdit()
      setDone('Donor record deleted.')
      await load()
    } catch (err) {
      setErrors({ fields: {}, message: err.message })
    }
  }

  return (
    <>
      <section className="card">
        <h1>{editingId === null ? 'Add a donor record' : `Edit record #${editingId}`}</h1>
        <FormMessage error={errors.message} success={done} />

        <form onSubmit={handleSubmit} noValidate>
          <div className="grid">
            <Field label="Full name" name="full_name" error={errors.fields.full_name}>
              <input
                id="full_name"
                name="full_name"
                type="text"
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
              />
            </Field>

            <Field label="Blood group" name="blood_group" error={errors.fields.blood_group}>
              <select
                id="blood_group"
                name="blood_group"
                value={form.blood_group}
                onChange={(e) => update('blood_group', e.target.value)}
              >
                {BLOOD_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="City" name="city" error={errors.fields.city}>
              <input
                id="city"
                name="city"
                type="text"
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
              />
            </Field>

            <Field
              label="Phone"
              name="phone"
              error={errors.fields.phone}
              hint="10 to 13 digits, optional leading +. Stored encrypted (AES-256-GCM) by the API."
            >
              <input
                id="phone"
                name="phone"
                type="tel"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
              />
            </Field>
          </div>

          <p className="field field-inline">
            <input
              id="available"
              name="available"
              type="checkbox"
              checked={form.available}
              onChange={(e) => update('available', e.target.checked)}
            />
            <label htmlFor="available">Available to donate</label>
          </p>

          <div className="actions">
            <button className="btn btn-primary" type="submit" disabled={busy} data-testid="donor-submit">
              {editingId === null ? 'Add record' : 'Save changes'}
            </button>
            {editingId !== null && (
              <button className="btn btn-ghost" type="button" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>
          {isAdmin ? 'All donor records' : 'My donor records'}{' '}
          <span className="count" data-testid="donor-count">({donors.length})</span>
        </h2>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : donors.length === 0 ? (
          <p className="muted" data-testid="donor-empty">No records yet. Add one with the form above.</p>
        ) : (
          <div className="table-wrap">
            <table data-testid="donor-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Full name</th>
                  <th>Group</th>
                  <th>City</th>
                  <th>Phone</th>
                  <th>Available</th>
                  {/* Only an admin's response carries owner_email. */}
                  {isAdmin && <th>Owner</th>}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {donors.map((donor) => (
                  <tr key={donor.id} data-testid={`donor-row-${donor.id}`}>
                    <td className="muted">{donor.id}</td>
                    <td>{donor.full_name}</td>
                    <td>
                      <span className="badge badge-group">{donor.blood_group}</span>
                    </td>
                    <td>{donor.city}</td>
                    <td>{donor.phone}</td>
                    <td>{donor.available ? 'Yes' : 'No'}</td>
                    {isAdmin && <td className="muted">{donor.owner_email ?? '—'}</td>}
                    <td className="row-actions">
                      <button
                        className="btn btn-small"
                        type="button"
                        onClick={() => startEdit(donor)}
                        data-testid={`edit-${donor.id}`}
                      >
                        Edit
                      </button>
                      {confirmingId === donor.id ? (
                        <>
                          <button
                            className="btn btn-small btn-danger"
                            type="button"
                            onClick={() => handleDelete(donor.id)}
                            data-testid={`confirm-delete-${donor.id}`}
                          >
                            Confirm
                          </button>
                          <button
                            className="btn btn-small btn-ghost"
                            type="button"
                            onClick={() => setConfirmingId(null)}
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-small btn-danger"
                          type="button"
                          onClick={() => setConfirmingId(donor.id)}
                          data-testid={`delete-${donor.id}`}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
