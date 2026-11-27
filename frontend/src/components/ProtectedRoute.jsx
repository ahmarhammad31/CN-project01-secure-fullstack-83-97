import { Navigate, useLocation } from 'react-router-dom'
import { useSession } from '../session/SessionContext.jsx'

/**
 * Route guard.
 *
 * This is convenience only. Hiding a page in the browser protects nothing: a
 * user can edit the JavaScript or call the API directly. The real checks are
 * the server's 401 (not logged in) and 403 (not permitted) middleware; this
 * guard only saves the user from staring at an empty page.
 */
export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, status } = useSession()
  const location = useLocation()

  // Still asking /auth/me. Rendering a redirect now would bounce a logged-in
  // user to /login on every page refresh.
  if (status === 'loading') {
    return <p className="muted" data-testid="session-loading">Checking your session…</p>
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (adminOnly && user.role !== 'admin') {
    return (
      <section className="notice notice-error" data-testid="forbidden-notice">
        <h2>403 — Not permitted</h2>
        <p>
          This page is for administrators only. Your account has the role
          <strong> {user.role}</strong>.
        </p>
        <p className="muted">
          The server rejects these routes with 403 as well; this notice is only here so the
          page explains itself.
        </p>
      </section>
    )
  }

  return children
}
