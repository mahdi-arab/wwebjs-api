const { globalApiKey, rateLimitMax, rateLimitWindowMs } = require('./config')
const { sendErrorResponse } = require('./utils')
const { validateSession, sessions } = require('./sessions')
const rateLimiting = require('express-rate-limit')

const portalStore = require('./portalStore')
const userApiLimiter = rateLimiting({ windowMs: 60000, limit: 60, keyGenerator: req => portalStore.digest(req.headers['x-api-key']), standardHeaders: 'draft-7', legacyHeaders: false })
const portalApiAccess = req => {
  const parts = req.path.split('/').filter(Boolean)
  if (parts.length !== 2 || !req.baseUrl.endsWith('/client')) return false
  const [method, id] = parts
  const account = portalStore.authorize(id, req.headers['x-api-key'])
  if (!account || !sessions.get(id)?._portalReady) return false
  if (req.method === 'GET' && ['getState', 'getChats', 'getContacts', 'getClassInfo'].includes(method)) return true
  const allowed = req.method === 'POST' && method === 'sendMessage' && req.body?.contentType === 'string' && typeof req.body.content === 'string' && req.body.content.length <= 10000 && typeof req.body.chatId === 'string' && /^[0-9-]+@(c.us|g.us)$/.test(req.body.chatId)
  if (allowed) req.body.options = {}
  return allowed
}

const apikey = async (req, res, next) => {
  /*
    #swagger.security = [{
          "apiKeyAuth": []
    }]
  */
  /* #swagger.responses[403] = {
        description: "Forbidden.",
        content: {
          "application/json": {
            schema: { "$ref": "#/definitions/ForbiddenResponse" }
          }
        }
      }
  */
  if (globalApiKey && portalStore.same(req.headers['x-api-key'], globalApiKey)) return next()
  if (portalApiAccess(req)) return next()
  return sendErrorResponse(res, 403, 'Invalid API key')
}

const sessionNameValidation = async (req, res, next) => {
  /*
    #swagger.parameters['sessionId'] = {
      in: 'path',
      description: 'Unique identifier for the session (alphanumeric and - allowed)',
      required: true,
      type: 'string',
      example: 'f8377d8d-a589-4242-9ba6-9486a04ef80c'
    }
  */
  if ((!/^[\w-]+$/.test(req.params.sessionId))) {
    /* #swagger.responses[422] = {
        description: "Unprocessable Entity.",
        content: {
          "application/json": {
            schema: { "$ref": "#/definitions/ErrorResponse" }
          }
        }
      }
    */
    return sendErrorResponse(res, 422, 'Session should be alphanumerical or -')
  }
  next()
}

const sessionValidation = async (req, res, next) => {
  const validation = await validateSession(req.params.sessionId)
  if (validation.success !== true) {
    /* #swagger.responses[404] = {
        description: "Not Found.",
        content: {
          "application/json": {
            schema: { "$ref": "#/definitions/NotFoundResponse" }
          }
        }
      }
    */
    return sendErrorResponse(res, 404, validation.message)
  }
  next()
}

const rateLimiter = rateLimiting({
  limit: rateLimitMax,
  windowMs: rateLimitWindowMs,
  message: "You can't make any more requests at the moment. Try again later",
  // Use real client IP when behind reverse proxy
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress
  }
})

const sessionSwagger = async (req, res, next) => {
  /*
    #swagger.tags = ['Session']
    #swagger.responses[500] = {
      description: "Server failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
  */
  next()
}

const clientSwagger = async (req, res, next) => {
  /*
    #swagger.tags = ['Client']
    #swagger.responses[500] = {
      description: "Server failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
  */
  next()
}

const contactSwagger = async (req, res, next) => {
  /*
    #swagger.tags = ['Contact']
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          contactId: {
            type: 'string',
            description: 'Unique WhatsApp ID for the contact',
            example: '6281288888888@c.us'
          }
        }
      }
    }
    #swagger.responses[500] = {
      description: "Server failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
  */
  next()
}

const messageSwagger = async (req, res, next) => {
  /*
    #swagger.tags = ['Message']
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: {
            type: 'string',
            description: 'The chat id which contains the message',
            example: '6281288888888@c.us'
          },
          messageId: {
            type: 'string',
            description: 'Unique WhatsApp ID for the message',
            example: 'ABCDEF999999999'
          }
        }
      }
    }
  */
  next()
}

const chatSwagger = async (req, res, next) => {
  /*
    #swagger.tags = ['Chat']
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: {
            type: 'string',
            description: 'Unique WhatsApp ID for the given chat (either group or personal)',
            example: '6281288888888@c.us'
          }
        }
      }
    }
    #swagger.responses[500] = {
      description: "Server failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
  */
  next()
}

const groupChatSwagger = async (req, res, next) => {
  /*
    #swagger.tags = ['Group Chat']
    #swagger.requestBody = {
      required: true,
      schema: {
        type: 'object',
        properties: {
          chatId: {
            type: 'string',
            description: 'Unique WhatsApp id for the given chat group',
            example: 'XXXXXXXXXX@g.us'
          }
        }
      }
    }
    #swagger.responses[500] = {
      description: "Server failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
  */
  next()
}

const channelSwagger = async (req, res, next) => {
  /*
    #swagger.tags = ['Channel Chat']
    #swagger.responses[500] = {
      description: "Server failure.",
      content: {
        "application/json": {
          schema: { "$ref": "#/definitions/ErrorResponse" }
        }
      }
    }
  */
  next()
}

// Reject unauthenticated API requests before buffering their request bodies.
const smallJson = require('express').json({ limit: '16kb' })
const authenticateBeforeBody = (req, res, next) => {
  if (!/^\/(session|client|chat|contact|message|groupChat|channel|localCallbackExample)(\/|$)/.test(req.path)) return next()
  if (globalApiKey && portalStore.same(req.headers['x-api-key'], globalApiKey)) return next()
  const id = req.path.split('/').filter(Boolean).at(-1)
  if (!portalStore.authorize(id, req.headers['x-api-key']) || !sessions.get(id)?._portalReady) return sendErrorResponse(res, 403, 'Invalid API key')
  return userApiLimiter(req, res, () => smallJson(req, res, next))
}

module.exports = {
  authenticateBeforeBody,
  sessionValidation,
  apikey,
  sessionNameValidation,
  sessionSwagger,
  clientSwagger,
  contactSwagger,
  messageSwagger,
  chatSwagger,
  groupChatSwagger,
  channelSwagger,
  rateLimiter
}
