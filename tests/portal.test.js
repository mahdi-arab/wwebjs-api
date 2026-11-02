const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const request = require('supertest')
process.env.API_KEY = 'portal-admin-secret'
process.env.PORTAL_ORIGIN = 'https://wa.example.test'
process.env.SESSIONS_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-tests-'))
process.env.PORTAL_MAX_SESSIONS = '3'
const mockSessions = new Map()
jest.mock('../src/sessions', () => ({
  sessions: mockSessions,
  setupSession: jest.fn(async id => {
    mockSessions.set(id, { qr: 'test-qr', _portalReady: false, logout: jest.fn().mockResolvedValue(), destroy: jest.fn().mockResolvedValue(), getState: jest.fn().mockResolvedValue('CONNECTED') })
    return { success: true }
  }),
  validateSession: jest.fn(async () => ({ success: true })),
  restoreSessions: jest.fn()
}))
const app = require('../src/app')
const store = require('../src/portalStore')
const { setupSession } = require('../src/sessions')
const { configurePortalClient } = require('../src/portalClient')
let invitation
let cookie
let key
let id
let csrf
const phone = '989123456789'
const post = (route, body) => request(app).post(route).set('Origin', 'https://wa.example.test').send(body)
afterAll(() => fs.rmSync(process.env.SESSIONS_PATH, { recursive: true, force: true }))
test('landing and admin pages have restrictive security headers', async () => {
  const response = await request(app).get('/')
  expect(response.status).toBe(200)
  expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(response.headers['cache-control']).toContain('no-store')
  expect(response.text).not.toContain('portal-admin-secret')
  expect((await request(app).get('/portal-admin/')).status).toBe(200)
})
test('unauthorized invite creation, credentialless QR and cross-origin creation are denied', async () => {
  expect((await post('/portal-admin/invitations', { phone })).status).toBe(403)
  expect((await request(app).get('/portal/qr')).status).toBe(401)
  expect((await request(app).post('/portal/connect').set('Origin', 'https://evil.test').send({ phone })).status).toBe(403)
  expect((await post('/portal/connect', { phone })).status).toBe(403)
  expect(setupSession).not.toHaveBeenCalled()
})
test('only administrator can issue a phone-bound invitation', async () => {
  const response = await post('/portal-admin/invitations', { phone }).set('x-api-key', process.env.API_KEY)
  expect(response.status).toBe(200)
  invitation = response.body.code
  expect(invitation).toMatch(/^[a-f0-9]{64}$/)
  const disk = fs.readFileSync(path.join(process.env.SESSIONS_PATH, '.portal/invitations.json'), 'utf8')
  expect(disk).not.toContain(invitation)
  expect(store.consumeInvite('12025550123', invitation)).toBe(false)
})
test('valid invitation creates one session and secure browser access', async () => {
  const response = await post('/portal/connect', { phone, invitation })
  expect(response.status).toBe(200)
  ;({ key, csrf, sessionId: id } = response.body)
  cookie = response.headers['set-cookie'][0].split(';')[0]
  expect(response.headers['set-cookie'][0]).toContain('HttpOnly')
  expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict')
  expect(setupSession).toHaveBeenCalledTimes(1)
  expect(store.consumeInvite(phone, invitation)).toBe(false)
  expect(JSON.stringify([...store.records.values()])).not.toContain(key)
  const state = await request(app).get('/portal/state').set('Cookie', cookie)
  expect(state.body.state).toBe('qr')
  expect((await request(app).get('/portal/qr').set('Cookie', cookie)).headers['content-type']).toMatch(/image\/png/)
})
test('number alone cannot recover the existing session or reveal its QR', async () => {
  expect((await post('/portal/connect', { phone })).status).toBe(403)
  expect((await request(app).get('/portal/state')).status).toBe(401)
})
test('phone ownership is checked before granting API access', async () => {
  const client = mockSessions.get(id)
  expect((await request(app).get('/client/getState/' + id).set('x-api-key', key)).status).toBe(403)
  const wrong = new EventEmitter()
  wrong.info = { wid: { user: '12025550123' } }
  wrong.logout = jest.fn().mockResolvedValue()
  wrong.destroy = jest.fn().mockResolvedValue()
  configurePortalClient(wrong, id)
  wrong.emit('ready')
  expect(wrong._portalReady).toBe(false)
  expect(store.records.get(id).error).toBe('phone_mismatch')
  const correct = new EventEmitter()
  correct.info = { wid: { user: phone } }
  configurePortalClient(correct, id)
  correct.emit('ready')
  expect(correct._portalReady).toBe(true)
  client._portalReady = true
  expect((await request(app).get('/client/getState/' + id).set('x-api-key', key)).status).toBe(200)
  expect((await request(app).get('/client/getState/p_00000000000000000000000000000000').set('x-api-key', key)).status).toBe(403)
  expect((await request(app).get('/session/getSessions').set('x-api-key', key)).status).toBe(403)
  expect((await request(app).post('/client/sendMessage/' + id).set('x-api-key', key).send({ contentType: 'MessageMediaFromURL', content: 'http://169.254.169.254/' })).status).toBe(403)
})
test('disconnect requires browser authentication and CSRF, then revokes access', async () => {
  expect((await post('/portal/disconnect', {}).set('Cookie', cookie)).status).toBe(403)
  const response = await post('/portal/disconnect', {}).set('Cookie', cookie).set('x-portal-csrf', csrf)
  expect(response.status).toBe(200)
  expect(store.authorize(id, key)).toBeFalsy()
  expect(mockSessions.has(id)).toBe(false)
  expect((await request(app).get('/portal/state').set('Cookie', cookie)).status).toBe(401)
})
test('expired invitation and oversized input fail closed', async () => {
  const issued = store.issueInvite('12025550123')
  store.invitations.get(store.digest(issued.code)).expiresAt = Date.now() - 1
  expect(store.consumeInvite('12025550123', issued.code)).toBe(false)
  expect((await post('/portal/connect', { phone, padding: 'x'.repeat(5000) })).status).toBe(413)
})

test('new invitations revoke old codes and revocation removes outstanding access', () => {
  const first = store.issueInvite('12025550123')
  const second = store.issueInvite('12025550123')
  expect(store.consumeInvite(first.phone, first.code)).toBe(false)
  store.revokeInvites(second.phone)
  expect(store.consumeInvite(second.phone, second.code)).toBe(false)
})
test('credential records survive restart without persisting raw session keys', () => {
  const created = store.create('12025550123')
  jest.isolateModules(() => {
    const restored = require('../src/portalStore')
    expect(restored.authorize(created.record.id, created.key).phone).toBe('12025550123')
  })
  store.remove(created.record)
})
test('unauthenticated oversized API requests are rejected before parsing', async () => {
  const response = await request(app).post('/client/sendMessage/not-owned').send({ content: 'x'.repeat(50000) })
  expect(response.status).toBe(403)
})

test('late ready events cannot resurrect revoked accounts', () => {
  const created = store.create('12025550123')
  const client = new EventEmitter()
  client.info = { wid: { user: created.record.phone } }
  client.destroy = jest.fn().mockResolvedValue()
  configurePortalClient(client, created.record.id)
  store.remove(created.record)
  client.emit('ready')
  expect(store.records.has(created.record.id)).toBe(false)
  expect(client._portalReady).toBe(false)
  expect(client.destroy).toHaveBeenCalled()
})
test('capacity checks reject admission without consuming a valid invitation', async () => {
  const seeded = ['12025550121', '12025550122', '12025550123'].map(number => store.create(number).record)
  const issued = store.issueInvite('12025550124')
  const response = await post('/portal/connect', { phone: issued.phone, invitation: issued.code })
  expect(response.status).toBe(429)
  expect(store.consumeInvite(issued.phone, issued.code)).toBe(true)
  for (const record of seeded) store.remove(record)
})
test('user API payloads are bounded before the legacy large-body parser', async () => {
  const created = store.create('12025550123')
  mockSessions.set(created.record.id, { _portalReady: true })
  const response = await request(app).post('/client/sendMessage/' + created.record.id).set('x-api-key', created.key).send({ content: 'x'.repeat(20000) })
  expect(response.status).toBe(413)
  mockSessions.delete(created.record.id)
  store.remove(created.record)
})
test('failed admission attempts are rate limited without starting browsers', async () => {
  let last
  for (let i = 0; i < 5; i++) last = await post('/portal/connect', { phone: '12025550123', invitation: '0'.repeat(64) })
  expect(last.status).toBe(429)
  expect(setupSession).toHaveBeenCalledTimes(1)
})
test('disconnect revokes access before remote logout completes and tolerates network failure', async () => {
  const created = store.create('12025550123')
  let rejectLogout
  let markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  const client = { _portalReady: true, logout: jest.fn(() => new Promise((resolve, reject) => { rejectLogout = reject; markStarted() })), destroy: jest.fn().mockResolvedValue() }
  mockSessions.set(created.record.id, client)
  const closing = post('/portal/disconnect', {}).set('Cookie', `wa_portal=${created.record.id}.${created.key}`).set('x-portal-csrf', store.digest(created.key + ':csrf')).then(response => response)
  await started
  expect(store.authorize(created.record.id, created.key)).toBeFalsy()
  rejectLogout(new Error('Network unavailable'))
  const response = await closing
  expect(response.status).toBe(200)
  expect(response.body.logoutConfirmed).toBe(false)
  expect(mockSessions.has(created.record.id)).toBe(false)
  expect(store.records.has(created.record.id)).toBe(false)
})
test('production portal requires HTTPS and issues host-only secure cookies', async () => {
  const previousEnvironment = process.env.NODE_ENV
  const previousProxy = process.env.TRUST_PROXY
  process.env.NODE_ENV = 'production'
  process.env.TRUST_PROXY = 'TRUE'
  let productionApp
  let productionStore
  try {
    jest.isolateModules(() => {
      productionApp = require('../src/app')
      productionStore = require('../src/portalStore')
    })
    expect((await request(productionApp).get('/')).status).toBe(426)
    const page = await request(productionApp).get('/').set('X-Forwarded-Proto', 'https')
    expect(page.status).toBe(200)
    expect(page.headers['strict-transport-security']).toContain('max-age=')
    const issued = productionStore.issueInvite('12025550123')
    const response = await request(productionApp).post('/portal/connect').set('X-Forwarded-Proto', 'https').set('Origin', 'https://wa.example.test').send({ phone: issued.phone, invitation: issued.code })
    expect(response.status).toBe(200)
    expect(response.headers['set-cookie'][0]).toMatch(/^__Host-wa_portal=/)
    expect(response.headers['set-cookie'][0]).toContain('Secure')
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly')
    expect(response.headers['set-cookie'][0]).not.toContain('Domain=')
    mockSessions.delete(response.body.sessionId)
    productionStore.remove(productionStore.records.get(response.body.sessionId))
  } finally {
    process.env.NODE_ENV = previousEnvironment
    if (previousProxy === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = previousProxy
  }
})
