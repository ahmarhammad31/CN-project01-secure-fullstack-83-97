import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { SessionProvider } from './session/SessionContext.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* BrowserRouter gives clean paths (/donors, /admin). Nginx must answer any
        unknown path with index.html (try_files $uri /index.html) so a reload or
        a typed URL reaches the router instead of a 404 from the web server. */}
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
)
