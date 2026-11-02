const express = require('express')
const path = require('path')
const fs = require('fs').promises
const qr = require('qr-image')
const rateLimit = require('express-rate-limit')
const { basePath, sessionFolderPath, globalApiKey } = require('./config')
const store = require('./portalStore')
const { sessions, setupSession } = require('./sessions')
const router = express.Router()
const prefix = basePath.replace(/\/$/, '')
const cookieName = process.env.NODE_ENV === 'production' ? (prefix ? '__Secure-wa_portal' : '__Host-wa_portal') : 'wa_portal'
const pending = new Map()
const busy = new Set()
const maxSessions = Math.max(1, Math.min(100, parseInt(process.env.PORTAL_MAX_SESSIONS) || 10))
const ttl = 10 * 60 * 1000
const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: prefix + '/', maxAge: 30 * 24 * 60 * 60 * 1000 }
const fail = (res, code, error) => res.status(code).json({ error })
const wrapper = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
router.use((req, res, next) => {
  if (req.path !== '/' && !req.path.startsWith('/portal/') && !req.path.startsWith('/portal-assets/') && !req.path.startsWith('/portal-admin')) return next('router')
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  })
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000')
  if (process.env.NODE_ENV === 'production' && !req.secure) return fail(res, 426, 'https_required')
  next()
})
router.use('/portal', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }))
router.use('/portal', express.json({ limit: '4kb' }))
const writes = (req, res, next) => {
  let origin
  try { origin = new URL(process.env.PORTAL_ORIGIN || (process.env.NODE_ENV !== 'production' ? `${req.protocol}://${req.get('host')}` : '')).origin } catch { return fail(res, 503, 'portal_not_configured') }
  if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) return fail(res, 503, 'portal_not_configured')
  if (req.get('origin') !== origin || req.get('sec-fetch-site') === 'cross-site' || !req.is('application/json')) return fail(res, 403, 'request_rejected')
  next()
}
const auth = (req, res, next) => {
  const value = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || ''
  const [id, token] = value.split('.')
  const record = store.authorize(id, token)
  if (!record) return fail(res, 401, 'authentication_required')
  req.portal = record
  req.portalToken = token
  next()
}
const csrf = (req, res, next) => store.same(req.get('x-portal-csrf'), store.digest(req.portalToken + ':csrf')) ? next() : fail(res, 403, 'request_rejected')
const close = async record => {
  const client = sessions.get(record.id)
  if (client) {
    if (client._portalReady) await client.logout()
    await client.destroy().catch(() => {})
    sessions.delete(record.id)
  }
  await fs.rm(path.join(sessionFolderPath, 'session-' + record.id), { recursive: true, force: true })
  store.remove(record)
}
const start = record => {
  if (sessions.has(record.id) || pending.has(record.id)) return
  if (pending.size >= 2) { record.error = 'server_busy'; return }
  record.error = null
  const task = setupSession(record.id).then(result => { if (!result.success) record.error ||= 'connection_failed' }).catch(() => { record.error ||= 'connection_failed' }).finally(() => pending.delete(record.id))
  pending.set(record.id, task)
}
const enrollmentLimit = rateLimit({ windowMs: 3600000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false })
router.post('/portal/connect', writes, enrollmentLimit, wrapper(async (req, res) => {
  const phone = store.normalizePhone(req.body.phone)
  if (!phone) return fail(res, 400, 'invalid_phone')
  let record = store.byPhone(phone)
  const existing = !!record
  let key = req.body.key
  if (record) {
    const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || ''
    const [id, token] = cookie.split('.')
    if (id === record.id && store.authorize(id, token)) key = token
    if (!store.authorize(record.id, key)) return fail(res, 403, 'invalid_credentials')
  } else {
    // Do not turn failed recovery attempts into new accounts.
    if (key) return fail(res, 403, 'invalid_credentials')
    if (store.records.size >= maxSessions || sessions.size >= maxSessions || pending.size >= 2) return fail(res, 429, 'server_busy')
    if (!store.consumeInvite(phone, req.body.invitation)) return fail(res, 403, 'invalid_credentials')
    const created = store.create(phone)
    record = created.record
    key = created.key
  }
  res.cookie(cookieName, `${record.id}.${key}`, cookieOptions)
  start(record)
  res.json({ sessionId: record.id, key: existing ? undefined : key, csrf: store.digest(key + ':csrf') })
}))
router.get('/portal/state', auth, (req, res) => {
  const record = req.portal
  const client = sessions.get(record.id)
  res.json({ phone: record.phone, sessionId: record.id, csrf: store.digest(req.portalToken + ':csrf'), state: record.error || (client?._portalReady ? 'ready' : client?.qr ? 'qr' : pending.has(record.id) || client ? 'connecting' : 'offline') })
})
router.get('/portal/qr', auth, (req, res) => {
  const client = sessions.get(req.portal.id)
  if (!client?.qr || client._portalReady) return res.sendStatus(404)
  res.type('png').send(qr.imageSync(client.qr, { type: 'png', margin: 2 }))
})
router.post('/portal/retry', writes, auth, csrf, wrapper(async (req, res) => {
  if (req.portal.error === 'phone_mismatch') return fail(res, 409, 'phone_mismatch')
  if (busy.has(req.portal.id)) return fail(res, 409, 'connection_in_progress')
  busy.add(req.portal.id)
  try {
    if (req.portal.error === 'offline') {
      await sessions.get(req.portal.id)?.destroy().catch(() => {})
      sessions.delete(req.portal.id)
    }
    start(req.portal)
    res.json({ success: true })
  } finally { busy.delete(req.portal.id) }
}))
router.post('/portal/disconnect', writes, auth, csrf, wrapper(async (req, res) => {
  if (pending.has(req.portal.id) || busy.has(req.portal.id)) return fail(res, 409, 'connection_in_progress')
  busy.add(req.portal.id)
  try {
    await close(req.portal)
    const clearOptions = { ...cookieOptions }
    delete clearOptions.maxAge
    res.clearCookie(cookieName, clearOptions)
    res.json({ success: true })
  } finally { busy.delete(req.portal.id) }
}))
const adminLimit = rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false })
const administrator = (req, res, next) => globalApiKey && store.same(req.get('x-api-key'), globalApiKey) ? next() : fail(res, 403, 'invalid_credentials')
router.get('/portal-admin/', (req, res) => res.sendFile(path.resolve(__dirname, '../public/portal/admin.html')))
router.post('/portal-admin/invitations', adminLimit, express.json({ limit: '4kb' }), administrator, writes, wrapper(async (req, res) => {
  const phone = store.normalizePhone(req.body.phone)
  if (!phone) return fail(res, 400, 'invalid_phone')
  if (store.byPhone(phone)) return fail(res, 409, 'existing_account')
  res.json(store.issueInvite(phone))
}))
router.delete('/portal-admin/invitations', adminLimit, express.json({ limit: '4kb' }), administrator, writes, wrapper(async (req, res) => {
  const phone = store.normalizePhone(req.body.phone)
  if (!phone) return fail(res, 400, 'invalid_phone')
  store.revokeInvites(phone)
  res.json({ success: true })
}))
router.get('/', (req, res) => {
  if (!req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(302, prefix + '/')
  res.sendFile(path.resolve(__dirname, '../public/portal/index.html'))
})
router.use('/portal-assets', express.static(path.resolve(__dirname, '../public/portal'), { index: false, dotfiles: 'deny' }))
router.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  fail(res, error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500, 'request_failed')
})
const cleanup = setInterval(() => {
  for (const record of store.records.values()) {
    if (!record.verified && Date.now() - record.createdAt > ttl && !busy.has(record.id)) {
      pending.delete(record.id)
      busy.add(record.id)
      close(record).catch(() => {}).finally(() => busy.delete(record.id))
    }
  }
}, 30000)
cleanup.unref()
module.exports = { router }
