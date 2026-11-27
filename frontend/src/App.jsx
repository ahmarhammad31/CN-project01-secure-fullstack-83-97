import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Nav from './components/Nav.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Admin from './pages/Admin.jsx'
import ChangePassword from './pages/ChangePassword.jsx'
import Donors from './pages/Donors.jsx'
import Login from './pages/Login.jsx'
import NotFound from './pages/NotFound.jsx'
import Register from './pages/Register.jsx'

// A single-page app never reloads, so the browser would keep the one title from
// index.html on every route. Setting it per route gives each history entry and
// each tab a name, and screen readers announce it on navigation.
const PAGE_TITLES = {
  '/login': 'Log in',
  '/register': 'Register',
  '/donors': 'Donor records',
  '/change-password': 'Change password',
  '/admin': 'Administration',
}

function useDocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    const page = PAGE_TITLES[pathname] ?? 'Page not found'
    document.title = `${page} · Blood Donor Registry`
  }, [pathname])
}

export default function App() {
  useDocumentTitle()

  return (
    <div className="app">
      <Nav />
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/donors" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Everything below needs a valid session cookie. */}
          <Route
            path="/donors"
            element={
              <ProtectedRoute>
                <Donors />
              </ProtectedRoute>
            }
          />
          <Route
            path="/change-password"
            element={
              <ProtectedRoute>
                <ChangePassword />
              </ProtectedRoute>
            }
          />
          {/* adminOnly shows a 403 notice rather than redirecting, so a user who
              types /admin sees why the page is refused. */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly>
                <Admin />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="footer">
        DCCN Lab Project 01 — Blood Donor Registry · frontend only, no secrets, no crypto
      </footer>
    </div>
  )
}
