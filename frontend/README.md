# Frontend — Blood Donor Registry (P1)

React + Vite single-page app. It is built to static files (`dist/`) and served by
Nginx on VM1 (`/var/www/app`); Nginx proxies `/api/` to the backend on VM2.

## Run it locally

Two terminals, from this folder:

```bash
npm install
npm run mock     # terminal 1: development stand-in for the API on 127.0.0.1:8000
npm run dev      # terminal 2: app on http://localhost:5173 (proxies /api to the mock)
```

Seeded account for the mock: `admin@lab.local` / `Admin12345` (role `admin`).
This is a throwaway development value baked into `dev-mock-server.mjs`, not a
secret: the mock is in-memory and is never deployed. The real admin is created
on VM2 by `backend/scripts/seed-admin.js` from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
in the environment. Register any other account through the UI to get a `user`.

```bash
npm run build    # writes dist/  -> scp to VM1:/var/www/app
npm run preview  # serves the real dist/ on http://localhost:4173, same /api proxy
```

## What is where

| Path | Purpose |
|---|---|
| `src/api/client.js` | the only place that calls the network: relative `/api/v1/...`, `credentials: 'same-origin'`, one error shape |
| `src/session/SessionContext.jsx` | who is logged in, learned from `GET /auth/me`; handles logout and session end |
| `src/components/ProtectedRoute.jsx` | redirect to `/login` when logged out, 403 notice when not an admin |
| `src/pages/` | Register, Login, ChangePassword, Donors, Admin, NotFound |
| `dev-mock-server.mjs` | development API stand-in (see below) |

## Security notes (the reasons, for the viva)

- **The app never sees the token.** It is in a `HttpOnly; SameSite=Strict` cookie
  set by the server, so JavaScript cannot read it and XSS cannot steal it.
  `document.cookie` is empty while logged in.
- **Nothing is stored client-side.** No `localStorage`, no `sessionStorage`, no
  readable cookie. After a reload the app asks `GET /auth/me` who it is.
- **Relative URLs only.** No IP or host name is compiled into the build, so the
  same `dist/` works on VM1, in Docker and in local development, and the browser
  sends API calls to the origin that served the page.
- **No validation rule is invented here.** Every message shown next to a field
  comes from the server's `error.details`; the client only places it.
- **Route guards are convenience, not security.** Hiding the Admin link and
  showing a 403 page are UX. The server's 401/403 middleware is the real check.
- **Two kinds of 401.** `UNAUTHENTICATED` (no/expired/tampered token) ends the
  session and returns to login; `INVALID_CREDENTIALS` (wrong password in the
  request body) is shown on the form, so mistyping a password does not log you
  out. The backend must keep using these two codes.
- **429 is Nginx's**, from `limit_req` on `/api/v1/auth/login`. Its body is HTML,
  not our JSON envelope, so the client handles a non-JSON response and shows
  "Too many login attempts, wait a minute."

## dev-mock-server.mjs — development only

The real backend (`backend/`, DESIGN.md section 5) does not exist yet, so this
file stands in for it while the UI is built and tested. It uses only Node
built-ins (`http`, `crypto`, `os`), so it adds no dependency, and it implements
the same contract: same routes, same status codes, the same
`{success,data}` / `{success:false,error:{code,message,details}}` envelope, an
`HttpOnly` cookie on login, a seeded admin, and `user`/`admin` behaviour
(401, 403, 404, 400 with `details`, 409).

It is **not** the backend: everything is in memory and lost on restart, its JWT
and AES keys are random per start and never written anywhere, it holds no real
secret, and it is never deployed. Delete it once the Express API runs.

It also reproduces the Nginx login limiter (`5r/m`, `burst=3`) so the 429 path
can be exercised locally. In production that 429 comes from Nginx, never from
the API.
