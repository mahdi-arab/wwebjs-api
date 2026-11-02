const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { sessionFolderPath } = require('./config')
const directory = path.join(sessionFolderPath, '.portal')
const records = new Map()
const digest = value => crypto.createHash('sha256').update(value).digest('hex')
const same = (a, b) => {
  const x = Buffer.from(a || '')
  const y = Buffer.from(b || '')
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
const normalizePhone = value => {
  if (typeof value !== 'string') return null
  const phone = value.replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[ +()-]/g, '')
  return /^[1-9][0-9]{7,14}$/.test(phone) ? phone : null
}
if (fs.existsSync(directory)) {
  for (const name of fs.readdirSync(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
    const record = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
    if (!/^p_[a-f0-9]{32}$/.test(record.id) || !normalizePhone(record.phone) || !/^[a-f0-9]{64}$/.test(record.keyHash)) throw new Error('Invalid portal credential store')
    records.set(record.id, record)
  }
}
const save = record => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const target = path.join(directory, digest(record.phone) + '.json')
  const temporary = target + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 })
  fs.renameSync(temporary, target)
  records.set(record.id, record)
}
const remove = record => {
  fs.rmSync(path.join(directory, digest(record.phone) + '.json'), { force: true })
  records.delete(record.id)
}
const byPhone = phone => [...records.values()].find(record => record.phone === phone)
const authorize = (id, token) => {
  const record = records.get(id)
  return record && typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && same(record.keyHash, digest(token)) ? record : null
}
const create = phone => {
  const key = crypto.randomBytes(32).toString('hex')
  const record = { id: 'p_' + crypto.randomBytes(16).toString('hex'), phone, keyHash: digest(key), createdAt: Date.now(), verified: false }
  save(record)
  return { record, key }
}
module.exports = { records, digest, same, normalizePhone, save, remove, byPhone, authorize, create }

const inviteFile = path.join(directory, 'invitations.json')
const invitations = new Map(fs.existsSync(inviteFile) ? JSON.parse(fs.readFileSync(inviteFile, 'utf8')) : [])
const saveInvites = () => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.writeFileSync(inviteFile + '.tmp', JSON.stringify([...invitations]), { mode: 0o600 })
  fs.renameSync(inviteFile + '.tmp', inviteFile)
}
const issueInvite = phone => {
  for (const [hash, item] of invitations) if (item.expiresAt < Date.now() || item.phone === phone) invitations.delete(hash)
  if (invitations.size >= 100) throw new Error('Invitation capacity reached')
  const code = crypto.randomBytes(32).toString('hex')
  const invitation = { phone, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }
  invitations.set(digest(code), invitation)
  saveInvites()
  return { code, ...invitation }
}
const consumeInvite = (phone, code) => {
  if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) return false
  const hash = digest(code)
  const invitation = invitations.get(hash)
  if (!invitation || invitation.phone !== phone || invitation.expiresAt <= Date.now()) return false
  invitations.delete(hash)
  saveInvites()
  return true
}
Object.assign(module.exports, { invitations, issueInvite, consumeInvite })
const revokeInvites = phone => {
  for (const [hash, invitation] of invitations) if (invitation.phone === phone) invitations.delete(hash)
  saveInvites()
}
module.exports.revokeInvites = revokeInvites
