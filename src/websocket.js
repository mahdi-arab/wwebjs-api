const { WebSocketServer } = require('ws')
const { timingSafeEqual } = require('crypto')
const { enableWebSocket, basePath, globalApiKey } = require('./config')
const { logger } = require('./logger')
const wssMap = new Map()

// Function to initialize the WebSocket server if enabled
const initWebSocketServer = (sessionId) => {
  if (enableWebSocket) {
    const server = wssMap.get(sessionId)
    if (server) {
      // happens on session restart
      return
    }
    // init websocket server
    const wss = new WebSocketServer({ noServer: true })
    wssMap.set(sessionId, wss)
    wss.on('connection', (ws) => {
      logger.debug({ sessionId }, 'WebSocket connection established')
      ws.on('close', () => {
        logger.debug({ sessionId }, 'WebSocket connection closed')
      })
      ws.on('error', () => {
        logger.error({ sessionId }, 'WebSocket connection error')
      })
    })
  }
}

// Function to initialize the WebSocket server
const terminateWebSocketServer = async (sessionId) => {
  const server = wssMap.get(sessionId)
  if (!server) {
    return Promise.resolve()
  }
  const closeEventSignal = new Promise((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve(undefined)))
  )
  for (const ws of server.clients) {
    ws.terminate()
  }
  wssMap.delete(sessionId)
  await closeEventSignal
}

const triggerWebSocket = (sessionId, dataType, data) => {
  const server = wssMap.get(sessionId)
  if (server) {
    for (const ws of server.clients) {
      ws.send(JSON.stringify({ dataType, data, sessionId }))
    }
  }
}

const handleUpgrade = (request, socket, head) => {
  const supplied = request.headers['x-api-key']
  const expected = Buffer.from(globalApiKey || '')
  const actual = Buffer.from(typeof supplied === 'string' ? supplied : '')
  if (!expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const { pathname } = new URL(request.url, 'http://localhost')

  // Handle base path for WebSocket connections
  const wsPath = `${basePath.replace(/\/$/, '')}/ws/`
  if (pathname.startsWith(wsPath)) {
    const pathParts = pathname.split('/')
    const sessionId = pathParts[pathParts.length - 1]
    const server = wssMap.get(sessionId)
    if (server) {
      server.handleUpgrade(request, socket, head, (ws) => {
        server.emit('connection', ws, request)
      })
      return
    }
  }
  socket.destroy()
}

module.exports = { initWebSocketServer, terminateWebSocketServer, handleUpgrade, triggerWebSocket }
