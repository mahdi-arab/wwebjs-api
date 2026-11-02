require('./routes')
const express = require('express')
const cors = require('cors')
const { routes } = require('./routes')
const { maxAttachmentSize, basePath, trustProxy } = require('./config')

const app = express()

// Initialize Express app
app.disable('x-powered-by')

// Configure trust proxy for reverse proxy compatibility
if (trustProxy) {
  app.set('trust proxy', true)
}

// Portal parsing, origin checks and small body limits run before the API parser/CORS.
app.use(basePath, require('./portal').router)
app.use(basePath, require('./middleware').authenticateBeforeBody)

app.use(express.json({ limit: maxAttachmentSize + 1000000 }))
app.use(express.urlencoded({ limit: maxAttachmentSize + 1000000, extended: true }))

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}))

// Mount routes with configurable base path
app.use(basePath, routes)

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  res.status(error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500).json({ success: false, error: 'Request failed' })
})

module.exports = app
