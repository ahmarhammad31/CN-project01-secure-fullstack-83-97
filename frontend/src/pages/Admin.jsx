import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { FormMessage } from '../components/Field.jsx'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

export default function Admin() {
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Both routes are admin-only on the server: 401 without a cookie, 403 with
    // a user's cookie. Reaching this page at all means the role check passed.
    async function load() {
      try {
        const [statsData, usersData] = await Promise.all([
          api('/admin/stats'),
          api('/admin/users'),
        ])
        setStats(statsData)
        setUsers(usersData)
      } catch (err) {
        if (err.status !== 401) setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <p className="muted">Loading…</p>

  return (
    <>
      <section className="card">
        <h1>Administration</h1>
        <FormMessage error={error} />

        {stats && (
          <>
            <div className="stats" data-testid="admin-stats">
              <Stat label="Users" value={stats.users} />
              <Stat label="Donor records" value={stats.donors} />
              <Stat label="Available donors" value={stats.available_donors} />
            </div>

            <h2>By blood group</h2>
            <div className="groups">
              {BLOOD_GROUPS.map((group) => (
                <div className="group" key={group}>
                  <span className="badge badge-group">{group}</span>
                  <strong>{stats.by_blood_group?.[group] ?? 0}</strong>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>
          Users <span className="count">({users.length})</span>
        </h2>
        <div className="table-wrap">
          <table data-testid="admin-users">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Records</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="muted">{user.id}</td>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>
                    <span className={`badge badge-${user.role}`}>{user.role}</span>
                  </td>
                  <td>{user.donor_count}</td>
                  <td className="muted">{formatDate(user.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}
