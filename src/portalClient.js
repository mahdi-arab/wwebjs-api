const store = require('./portalStore')
const configurePortalClient = (client, id) => {
  const account = store.records.get(id)
  if (!account) return
  client._portalOwned = true
  client._portalReady = false
  client.on('qr', () => { client._portalReady = false })
  client.on('disconnected', () => { client._portalReady = false; account.error ||= 'offline' })
  client.on('ready', () => {
    if (account.revoked || store.records.get(id) !== account) {
      client.destroy().catch(() => {})
      return
    }
    try {
      if (String(client.info?.wid?.user || '') !== account.phone) {
        account.error = 'phone_mismatch'
        account.verified = false
        store.save(account)
        client.logout().catch(() => {}).finally(() => client.destroy().catch(() => {}))
        return
      }
      account.verified = true
      account.error = null
      store.save(account)
      client._portalReady = true
      client.qr = null
      client.pupPage?.once('close', () => { client._portalReady = false; account.error ||= 'offline' })
    } catch {
      account.error = 'connection_failed'
      client.destroy().catch(() => {})
    }
  })
}
module.exports = { configurePortalClient }
