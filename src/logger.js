const { logLevel } = require('./config')
const pino = require('pino')

const logger = pino({
  level: logLevel,
  redact: {
    paths: ['err.config.headers', 'err.config.data', 'data'],
    remove: true
  }
}, pino.destination(1, { sync: false }))

logger.on('level-change', (lvl, val, prevLvl, prevVal) => {
  logger.info('%s (%d) was changed to %s (%d)', prevLvl, prevVal, lvl, val)
})

module.exports = { logger }
