#!/usr/bin/env node
/**
 * dev-mock-server.mjs — DEVELOPMENT TOOL ONLY. Delete once backend/ runs.
 *
 * The real backend (DESIGN.md section 5) does not exist yet, so this stands in
 * for it while the frontend is built and tested. It implements the same
 * /api/v1 contract: same routes, same status codes, the same
 * {success,data} / {success:false,error:{code,message,details}} envelope, an
 * HttpOnly cookie on login, a seeded admin, and user/admin behaviour.
 *
 * What it is NOT:
 *  - It is not the backend. Everything lives in memory and is lost on restart.
 *  - It holds no real secrets. The JWT key, the AES key and the dev passwords
 *    are generated or defaulted at startup and never written anywhere.
 *  - It is never deployed. VM1 serves dist/ and Nginx proxies to VM2.
 *
 * Only Node built-ins are used (http, crypto, os), so it adds no dependency.
 *
 *   npm run mock      # http://127.0.0.1:8000
 */

import http from 'node:http'
import crypto from 'node:crypto'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 8000)
const BIND_HOST = process.env.BIND_HOST ?? '127.0.0.1'
const LAB_SUBNET_PREFIX = process.env.LAB_SUBNET_PREFIX ?? '192.168.'
const HOST_IP = process.env.HOST_IP ?? ''
// Dev runs over plain http through the Vite proxy, so Secure would make the
// browser drop the cookie. On VM1 everything is HTTPS and the real backend
// defaults COOKIE_SECURE to true.
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true'
const TOKEN_TTL_SECONDS = Number(process.env.JWT_EXPIRES_SECONDS ?? 900) // 15 min
const BODY_LIMIT_BYTES = 10 * 1024

// Dev-only credentials for the seeded admin. Overridable, never a real secret.
const ADMIN_EMAIL = (process.env.MOCK_ADMIN_EMAIL ?? 'admin@lab.local').toLowerCase()
const ADMIN_PASSWORD = process.env.MOCK_ADMIN_PASSWORD ?? 'Admin12345'

// Mirrors the Nginx login limiter on VM1:
//   limit_req_zone ... rate=5r/m;  limit_req zone=login burst=3 nodelay;
// In production the 429 comes from Nginx, never from the API. It is reproduced
// here only so the frontend's rate-limit message can be tested locally.
const LOGIN_RATE_PER_MIN = Number(process.env.MOCK_LOGIN_RATE_PER_MIN ?? 5)
const LOGIN_BURST = Number(process.env.MOCK_LOGIN_BURST ?? 3)

// Ephemeral keys: new on every start, in memory only, never configured.
const JWT_SECRET = crypto.randomBytes(32)
const ENCRYPTION_KEY = crypto.randomBytes(32)

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

// ---------------------------------------------------------------------------
// In-memory store (stands in for PostgreSQL)
// ---------------------------------------------------------------------------

const db = {
  users: [],
  donors: [],
  nextUserId: 1,
  nextDonorId: 1,
}

// ---------------------------------------------------------------------------
// Dev stand-ins for the backend's crypto. The real API uses bcrypt (cost 12)
// and AES-256-GCM with a key from the environment; these use Node built-ins so
// the mock needs no dependency, and so that no password is ever kept in clear
// text even in a throwaway store.
// ---------------------------------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(password, salt, 32)
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`
}

function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$')
  if (scheme !== 'scrypt') return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length)
  return crypto.timingSafeEqual(expected, actual)
}

// Compared against when the email is unknown, so a wrong email and a wrong
// password take the same time and timing cannot be used to enumerate accounts.
const DUMMY_HASH = hashPassword('dummy-password-for-constant-time-compare')

// Same format as the backend: v1:<iv b64>:<tag b64>:<ciphertext b64>.
function encryptPhone(plain) {
  const iv = crypto.randomBytes(12) // fresh IV per encryption, never reused
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}

function decryptPhone(stored) {
  const [version, ivB64, tagB64, ctB64] = String(stored).split(':')
  if (version !== 'v1') throw new Error('unsupported ciphertext version')
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64')) // tampering throws here
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}

// Real HS256 JWT, so a tampered or expired token fails exactly as it will
// against the backend.
function signToken(userId, role) {
  const now = Math.floor(Date.now() / 1000)
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: String(userId),
    role,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  })}`
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyToken(token) {
  const parts = String(token).split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts
  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url')
  const given = Buffer.from(sigB64)
  const want = Buffer.from(expected)
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null
  let header
  let payload
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'))
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  // Pin the algorithm: never trust the token's own header to pick it.
  if (header.alg !== 'HS256') return null
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function send(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  res.end(body)
}

const ok = (res, data, status = 200, headers) => send(res, status, { success: true, data }, headers)

const fail = (res, status, code, message, details, headers) =>
  send(res, status, { success: false, error: { code, message, ...(details ? { details } : {}) } }, headers)

function cookieHeader(value, maxAge) {
  const parts = [
    `token=${value}`,
    'Path=/',
    'HttpOnly', // JavaScript cannot read it, so XSS cannot steal the token
    'SameSite=Strict', // not sent on cross-site requests: CSRF protection
    `Max-Age=${maxAge}`,
  ]
  if (COOKIE_SECURE) parts.push('Secure') // HTTPS only
  return parts.join('; ')
}

function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=')
    if (index === -1) continue
    if (pair.slice(0, index).trim() === name) return pair.slice(index + 1).trim()
  }
  return null
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT_BYTES) {
        // Stop buffering so memory stays bounded, but keep draining the socket:
        // destroying it here would reset the connection and the client would
        // never read the 413 we are about to send.
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve({ tooLarge, raw: Buffer.concat(chunks).toString('utf8') }))
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Validation (mirrors the zod rules in DESIGN.md section 5; unknown fields,
// including a smuggled "role", are dropped because only listed keys are read)
// ---------------------------------------------------------------------------

const detail = (field, message) => ({ field, message })

function validateRegister(body) {
  const errors = []
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (name.length < 2 || name.length > 100) errors.push(detail('name', 'Name must be 2 to 100 characters.'))
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(detail('email', 'Enter a valid email address.'))
  errors.push(...passwordErrors(password, 'password'))

  return { errors, value: { name, email, password } }
}

function passwordErrors(password, field) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    return [detail(field, 'Password must be 8 to 72 characters.')]
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return [detail(field, 'Password must contain at least one letter and one digit.')]
  }
  return []
}

function validateDonor(body) {
  const errors = []
  const full_name = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const blood_group = typeof body.blood_group === 'string' ? body.blood_group.trim() : ''
  const city = typeof body.city === 'string' ? body.city.trim() : ''
  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  const phone = rawPhone.replace(/[\s-]/g, '') // spaces and dashes removed first
  const available = body.available === undefined ? true : body.available

  if (full_name.length < 2 || full_name.length > 100) {
    errors.push(detail('full_name', 'Full name must be 2 to 100 characters.'))
  }
  if (!BLOOD_GROUPS.includes(blood_group)) {
    errors.push(detail('blood_group', `Blood group must be one of ${BLOOD_GROUPS.join(', ')}.`))
  }
  if (city.length < 2 || city.length > 80) errors.push(detail('city', 'City must be 2 to 80 characters.'))
  if (!/^\+?[0-9]{10,13}$/.test(phone)) {
    errors.push(detail('phone', 'Phone must be 10 to 13 digits, with an optional leading +.'))
  }
  if (typeof available !== 'boolean') errors.push(detail('available', 'Available must be true or false.'))

  return { errors, value: { full_name, blood_group, city, phone, available } }
}

// Path ids: positive integer, no larger than PostgreSQL's int4 maximum.
function parseId(raw) {
  if (!/^[0-9]+$/.test(raw)) return null
  const id = Number(raw)
  if (id < 1 || id > 2147483647) return null
  return id
}

// ---------------------------------------------------------------------------
// Login rate limiter (stands in for Nginx limit_req, see note above)
// ---------------------------------------------------------------------------

const loginBuckets = new Map()
const RATE_INTERVAL_MS = 60000 / LOGIN_RATE_PER_MIN

function loginRateLimited(ip) {
  const now = Date.now()
  const bucket = loginBuckets.get(ip) ?? { excess: 0, last: now }
  // Leaky bucket, like Nginx: the backlog drains at the configured rate.
  const excess = Math.max(0, bucket.excess - (now - bucket.last) / RATE_INTERVAL_MS)
  if (excess > LOGIN_BURST) {
    loginBuckets.set(ip, { excess, last: now })
    return true
  }
  loginBuckets.set(ip, { excess: excess + 1, last: now })
  return false
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role })

function donorView(donor, { withOwner = false } = {}) {
  const view = {
    id: donor.id,
    full_name: donor.full_name,
    blood_group: donor.blood_group,
    city: donor.city,
    phone: decryptPhone(donor.phone_enc), // decrypted on read, as the API does
    available: donor.available,
    created_at: donor.created_at,
  }
  if (withOwner) {
    view.owner_email = db.users.find((u) => u.id === donor.user_id)?.email ?? null
  }
  return view
}

function labIp() {
  if (HOST_IP) return HOST_IP
  // Never gethostbyname(gethostname()): on Ubuntu that returns 127.0.1.1.
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
  return addresses.find((a) => a.startsWith(LAB_SUBNET_PREFIX)) ?? addresses[0] ?? '127.0.0.1'
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const started = Date.now()
  const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const ip = req.socket.remoteAddress ?? 'unknown'

  res.on('finish', () => {
    // One line per request, like morgan on the backend.
    console.log(`${ip} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started} ms`)
  })

  try {
    if (!path.startsWith('/api/v1')) {
      return fail(res, 404, 'NOT_FOUND', 'Unknown route.')
    }
    const route = path.slice('/api/v1'.length) || '/'

    // --- body -------------------------------------------------------------
    let body = {}
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const { tooLarge, raw } = await readBody(req)
      if (tooLarge) return fail(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw)
        } catch {
          return fail(res, 400, 'INVALID_JSON', 'Request body is not valid JSON.')
        }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          return fail(res, 400, 'INVALID_JSON', 'Request body must be a JSON object.')
        }
      }
    }

    // --- current user from the cookie -------------------------------------
    const claims = verifyToken(readCookie(req, 'token') ?? '')
    const currentUser = claims ? db.users.find((u) => u.id === Number(claims.sub)) ?? null : null
    const requireUser = () => {
      if (!currentUser) {
        fail(res, 401, 'UNAUTHENTICATED', 'You are not logged in.')
        return false
      }
      return true
    }
    const requireAdmin = () => {
      if (!requireUser()) return false
      if (currentUser.role !== 'admin') {
        fail(res, 403, 'FORBIDDEN', 'This action requires the admin role.')
        return false
      }
      return true
    }

    // --- routes -----------------------------------------------------------

    if (route === '/health' && req.method === 'GET') {
      return ok(res, { status: 'ok', hostname: os.hostname(), ip: labIp(), database: true })
    }

    if (route === '/auth/register' && req.method === 'POST') {
      const { errors, value } = validateRegister(body)
      if (errors.length) return fail(res, 400, 'VALIDATION_ERROR', 'Please correct the errors below.', errors)
      if (db.users.some((u) => u.email === value.email)) {
        return fail(res, 409, 'EMAIL_IN_USE', 'That email address is already registered.')
      }
      const user = {
        id: db.nextUserId++,
        name: value.name,
        email: value.email,
        password_hash: hashPassword(value.password),
        role: 'user', // always 'user'; a "role" sent in the body is ignored
        created_at: new Date().toISOString(),
      }
      db.users.push(user)
      return ok(res, publicUser(user), 201)
    }

    if (route === '/auth/login' && req.method === 'POST') {
      if (loginRateLimited(ip)) {
        return fail(res, 429, 'RATE_LIMITED', 'Too many login attempts, wait a minute.', undefined, {
          'Retry-After': '60',
        })
      }
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const errors = []
      if (!email) errors.push(detail('email', 'Email is required.'))
      if (!password) errors.push(detail('password', 'Password is required.'))
      if (errors.length) return fail(res, 400, 'VALIDATION_ERROR', 'Please correct the errors below.', errors)

      const user = db.users.find((u) => u.email === email)
      const matches = verifyPassword(password, user ? user.password_hash : DUMMY_HASH)
      if (!user || !matches) {
        // One message for both cases: never reveal whether the email exists.
        return fail(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.')
      }
      return ok(res, publicUser(user), 200, {
        'Set-Cookie': cookieHeader(signToken(user.id, user.role), TOKEN_TTL_SECONDS),
      })
    }

    if (route === '/auth/logout' && req.method === 'POST') {
      // Cleared with the same flags it was set with, or the browser keeps it.
      return ok(res, { loggedOut: true }, 200, { 'Set-Cookie': cookieHeader('', 0) })
    }

    if (route === '/auth/me' && req.method === 'GET') {
      if (!requireUser()) return undefined
      return ok(res, publicUser(currentUser))
    }

    if (route === '/auth/password' && req.method === 'PUT') {
      if (!requireUser()) return undefined
      const current = typeof body.current_password === 'string' ? body.current_password : ''
      const next = typeof body.new_password === 'string' ? body.new_password : ''
      const errors = passwordErrors(next, 'new_password')
      if (errors.length) return fail(res, 400, 'VALIDATION_ERROR', 'Please correct the errors below.', errors)
      if (!verifyPassword(current, currentUser.password_hash)) {
        return fail(res, 401, 'INVALID_CREDENTIALS', 'Your current password is not correct.')
      }
      currentUser.password_hash = hashPassword(next)
      return ok(res, { updated: true })
    }

    if (route === '/donors' && req.method === 'GET') {
      if (!requireUser()) return undefined
      const isAdmin = currentUser.role === 'admin'
      const rows = isAdmin ? db.donors : db.donors.filter((d) => d.user_id === currentUser.id)
      return ok(res, rows.map((d) => donorView(d, { withOwner: isAdmin })))
    }

    if (route === '/donors' && req.method === 'POST') {
      if (!requireUser()) return undefined
      const { errors, value } = validateDonor(body)
      if (errors.length) return fail(res, 400, 'VALIDATION_ERROR', 'Please correct the errors below.', errors)
      const donor = {
        id: db.nextDonorId++,
        user_id: currentUser.id,
        full_name: value.full_name,
        blood_group: value.blood_group,
        city: value.city,
        phone_enc: encryptPhone(value.phone), // encrypted before storage
        available: value.available,
        created_at: new Date().toISOString(),
      }
      db.donors.push(donor)
      return ok(res, donorView(donor), 201)
    }

    const donorMatch = route.match(/^\/donors\/([^/]+)$/)
    if (donorMatch && ['GET', 'PUT', 'DELETE'].includes(req.method)) {
      if (!requireUser()) return undefined
      const id = parseId(donorMatch[1])
      if (id === null) {
        return fail(res, 400, 'VALIDATION_ERROR', 'The record id must be a positive integer.')
      }
      const index = db.donors.findIndex((d) => d.id === id)
      // 404 before 403: the record's existence is checked first, then ownership.
      if (index === -1) return fail(res, 404, 'NOT_FOUND', 'No donor record with that id.')
      const donor = db.donors[index]
      const isAdmin = currentUser.role === 'admin'
      if (donor.user_id !== currentUser.id && !isAdmin) {
        return fail(res, 403, 'FORBIDDEN', 'This record belongs to another user.')
      }

      if (req.method === 'GET') return ok(res, donorView(donor, { withOwner: isAdmin }))

      if (req.method === 'PUT') {
        const { errors, value } = validateDonor(body)
        if (errors.length) return fail(res, 400, 'VALIDATION_ERROR', 'Please correct the errors below.', errors)
        Object.assign(donor, {
          full_name: value.full_name,
          blood_group: value.blood_group,
          city: value.city,
          phone_enc: encryptPhone(value.phone), // new IV on every write
          available: value.available,
        })
        return ok(res, donorView(donor, { withOwner: isAdmin }))
      }

      db.donors.splice(index, 1)
      return ok(res, { deleted: id })
    }

    if (route === '/admin/users' && req.method === 'GET') {
      if (!requireAdmin()) return undefined
      return ok(
        res,
        db.users.map((user) => ({
          ...publicUser(user),
          created_at: user.created_at,
          donor_count: db.donors.filter((d) => d.user_id === user.id).length,
        })),
      )
    }

    if (route === '/admin/stats' && req.method === 'GET') {
      if (!requireAdmin()) return undefined
      const by_blood_group = Object.fromEntries(BLOOD_GROUPS.map((g) => [g, 0]))
      for (const donor of db.donors) by_blood_group[donor.blood_group] += 1
      return ok(res, {
        users: db.users.length,
        donors: db.donors.length,
        available_donors: db.donors.filter((d) => d.available).length,
        by_blood_group,
      })
    }

    return fail(res, 404, 'NOT_FOUND', 'Unknown route.')
  } catch (err) {
    // Logged here, never sent: a stack trace must not reach the client.
    console.error('mock server error:', err)
    if (!res.headersSent) fail(res, 500, 'INTERNAL_ERROR', 'Something went wrong.')
  }
})

// ---------------------------------------------------------------------------
// Seed + start
// ---------------------------------------------------------------------------

db.users.push({
  id: db.nextUserId++,
  name: 'Lab Admin',
  email: ADMIN_EMAIL,
  password_hash: hashPassword(ADMIN_PASSWORD),
  role: 'admin',
  created_at: new Date().toISOString(),
})

server.listen(PORT, BIND_HOST, () => {
  console.log(`[mock] DEVELOPMENT API on http://${BIND_HOST}:${PORT}/api/v1`)
  console.log('[mock] In-memory only. Not the backend. Never deploy this file.')
  console.log(`[mock] Seeded admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}  (dev credentials)`)
  console.log(`[mock] Cookie: HttpOnly; SameSite=Strict; Max-Age=${TOKEN_TTL_SECONDS}${COOKIE_SECURE ? '; Secure' : ' (Secure off: dev is plain http)'}`)
  console.log(`[mock] Login limit: ${LOGIN_RATE_PER_MIN}r/m burst ${LOGIN_BURST} -> 429 (Nginx does this in production)`)
})
