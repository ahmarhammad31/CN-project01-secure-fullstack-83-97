import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <section className="card">
      <h1>Page not found</h1>
      <p className="muted">
        This address does not exist in the app. Nginx serves <code>index.html</code> for any
        unknown path (<code>try_files $uri /index.html</code>) so that the router can answer,
        which is why you get this page instead of an Nginx 404.
      </p>
      <p>
        <Link to="/donors">Back to donors</Link>
      </p>
    </section>
  )
}
