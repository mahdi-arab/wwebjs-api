const assert = require('node:assert/strict')
process.env.API_KEY = 'runtime-smoke-test-key'
process.env.ENABLE_WEBHOOK = 'FALSE'
const app = require('../src/app')
const server = app.listen(0, '127.0.0.1', async () => {
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const ping = await fetch(`${base}/ping`)
    assert.equal(ping.status, 200)
    assert.deepEqual(await ping.json(), { success: true, message: 'pong' })
    assert.equal((await fetch(`${base}/session/getSessions`)).status, 403)
    const sessions = await fetch(`${base}/session/getSessions`, {
      headers: { 'x-api-key': process.env.API_KEY }
    })
    assert.equal(sessions.status, 200)
    console.log('Production runtime loads and enforces authentication without optional dependencies')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    server.close()
    server.closeAllConnections()
  }
})
