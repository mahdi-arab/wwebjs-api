process.env.API_KEY = 'inbound-secret'
process.env.WEBHOOK_API_KEY = 'outbound-secret'
process.env.ENABLE_WEBSOCKET = 'TRUE'
process.env.ENABLE_WEBHOOK = 'TRUE'
process.env.BASE_PATH = '/'
jest.mock('axios', () => ({ post: jest.fn().mockResolvedValue({}) }))
const http = require('http')
const WebSocket = require('ws')
const axios = require('axios')
const { triggerWebhook } = require('../src/utils')
const { initWebSocketServer, handleUpgrade, triggerWebSocket, terminateWebSocketServer } = require('../src/websocket')

let server
let url
beforeAll(async () => {
  initWebSocketServer('security-test')
  server = http.createServer()
  server.on('upgrade', handleUpgrade)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  url = `ws://127.0.0.1:${server.address().port}/ws/security-test`
})
afterAll(async () => {
  await terminateWebSocketServer('security-test')
  await new Promise(resolve => server.close(resolve))
})

test.each([undefined, 'wrong-secret'])('rejects WebSocket without a valid key (%s)', async key => {
  const ws = new WebSocket(url, { headers: key ? { 'x-api-key': key } : {} })
  const status = await new Promise((resolve, reject) => {
    ws.on('unexpected-response', (req, res) => {
      res.resume()
      ws.terminate()
      resolve(res.statusCode)
    })
    ws.on('error', () => {})
    ws.on('open', () => { ws.terminate(); reject(new Error('Unauthorized connection accepted')) })
  })
  expect(status).toBe(401)
})

test('authorized WebSocket receives events with default base path', async () => {
  const ws = new WebSocket(url, { headers: { 'x-api-key': 'inbound-secret' } })
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  const message = new Promise(resolve => ws.once('message', data => resolve(JSON.parse(data))))
  triggerWebSocket('security-test', 'message', { body: 'local-test' })
  expect(await message).toEqual({ sessionId: 'security-test', dataType: 'message', data: { body: 'local-test' } })
  const closed = new Promise(resolve => ws.once('close', resolve))
  ws.close()
  await closed
})

test('webhook uses only its separate credential and bounds request time', () => {
  triggerWebhook('http://127.0.0.1/hook', 'test', 'message', { body: 'test' })
  expect(axios.post).toHaveBeenCalledWith('http://127.0.0.1/hook', expect.any(Object), {
    headers: { 'x-api-key': 'outbound-secret' }, timeout: 10000
  })
  expect(JSON.stringify(axios.post.mock.calls)).not.toContain('inbound-secret')
})
