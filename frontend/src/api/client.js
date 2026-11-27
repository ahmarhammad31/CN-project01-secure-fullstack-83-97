// Single place where the frontend talks to the network.
//
// Three rules the whole app depends on:
//  1. Every URL is relative (/api/v1/...). The frontend never knows an IP or a
//     host name, so the same dist/ works on VM1, in Docker and in local dev.
//  2. credentials: 'same-origin' lets the browser attach the `token` cookie.
//     The cookie is HttpOnly, so JavaScript cannot read it; the app only ever
//     knows *who* it is by asking the server (GET /auth/me).
//  3. No token, user object or anything else is written to localStorage,
//     sessionStorage or a non-HttpOnly cookie.

const BASE = '/api/v1'

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = Array.isArray(details) ? details : []
  }
}

// The session layer registers a callback here so that *any* 401 anywhere in the
// app ends the session once, in one place, instead of each page handling it.
let onUnauthorized = () => {}
export function setUnauthorizedHandler(fn) {
  onUnauthorized = typeof fn === 'function' ? fn : () => {}
}

/**
 * @param {string} path            e.g. '/donors' or '/donors/3'
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.body]  serialised as JSON when present
 * @param {boolean} [options.expectUnauthorized]
 *        true for calls where a 401 is a normal answer ("am I logged in?"),
 *        so it must not be reported as the session ending.
 */
export async function api(path, { method = 'GET', body, expectUnauthorized = false } = {}) {
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // DNS failure, connection refused, TLS rejected, VM2 unreachable...
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.')
  }

  // Not every response is our JSON envelope: Nginx answers a rate-limited
  // login with its own HTML 429 page, so parsing must be allowed to fail.
  let payload = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }

  if (res.ok && payload && payload.success === true) return payload.data

  if (res.status === 429) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many login attempts, wait a minute.')
  }

  // A 5xx that is NOT our JSON envelope did not come from the API at all: it is
  // the reverse proxy answering for it. On VM1 that is Nginx's 502/504 when the
  // backend on VM2 is down or unreachable (and the Vite dev proxy's 500 locally)
  // - an HTML page, not {success:false,...}. A genuine API 500 does carry the
  // envelope, so it still shows its own message below.
  if (res.status >= 500 && !payload) {
    throw new ApiError(
      res.status,
      'SERVICE_UNAVAILABLE',
      'Cannot reach the server. It may be down or restarting — please try again in a moment.',
    )
  }

  const err = (payload && payload.error) || {}
  const apiError = new ApiError(
    res.status,
    err.code || `HTTP_${res.status}`,
    err.message || `Request failed (${res.status})`,
    err.details,
  )

  // A 401 has two meanings in this API and they must not be confused:
  //   - UNAUTHENTICATED: no cookie, or an expired/tampered token. The session
  //     is over, so it is dropped and the guard sends the user to /login.
  //   - INVALID_CREDENTIALS: the credentials *in the body* were wrong (login,
  //     or the current password on PUT /auth/password). The session, if any,
  //     is still perfectly valid, so mistyping a password must not log you out.
  if (res.status === 401 && !expectUnauthorized && apiError.code !== 'INVALID_CREDENTIALS') {
    onUnauthorized()
  }
  throw apiError
}

/**
 * Turns the server's `details` array into a { field: message } map for the form.
 * Accepts both shapes a zod-backed API may send: { field, message } or
 * { path: ['field'], message }. Anything without a field becomes a form-level
 * message, so a validation error can never be silently swallowed.
 */
export function fieldErrorsFrom(error) {
  const fields = {}
  const general = []
  for (const detail of error?.details ?? []) {
    const name = detail.field ?? (Array.isArray(detail.path) ? detail.path.join('.') : detail.path)
    const message = detail.message ?? String(detail)
    if (name) fields[name] = message
    else general.push(message)
  }
  return { fields, general }
}
