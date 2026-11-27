import { NavLink, useNavigate } from 'react-router-dom'
import { useSession } from '../session/SessionContext.jsx'

export default function Nav() {
  const { user, isAdmin, signOut } = useSession()
  const navigate = useNavigate()

  async function handleLogout() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <header className="nav">
      <div className="nav-brand">
        <span className="drop" aria-hidden="true">🩸</span>
        <span>Blood Donor Registry</span>
      </div>

      <nav className="nav-links">
        {user ? (
          <>
            <NavLink to="/donors">Donors</NavLink>
            <NavLink to="/change-password">Change password</NavLink>
            {/* Shown to admins only. The server still enforces the role. */}
            {isAdmin && (
              <NavLink to="/admin" data-testid="admin-link">
                Admin
              </NavLink>
            )}
          </>
        ) : (
          <>
            <NavLink to="/login">Login</NavLink>
            <NavLink to="/register">Register</NavLink>
          </>
        )}
      </nav>

      {user && (
        <div className="nav-user">
          <span className="user-email" data-testid="current-user">{user.email}</span>
          <span className={`badge badge-${user.role}`}>{user.role}</span>
          <button type="button" className="btn btn-ghost" onClick={handleLogout} data-testid="logout">
            Log out
          </button>
        </div>
      )}
    </header>
  )
}
