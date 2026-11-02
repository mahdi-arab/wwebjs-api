/* global window, document, navigator, fetch, URL */
const $ = id => document.getElementById(id)
let csrf = ''
let timer
let qrUrl
let destroyed = false
const messages = {
  invalid_phone: 'شماره را با کد کشور و بدون صفر ابتدای شماره داخلی وارد کنید.',
  invalid_credentials: 'اطلاعات دسترسی معتبر نیست. برای اتصال جدید دعوت‌نامه معتبر، و برای سشن قبلی کلید اختصاصی لازم است.',
  server_busy: 'ظرفیت اتصال موقتاً تکمیل است. کمی بعد دوباره تلاش کنید.',
  authentication_required: 'دسترسی مرورگر منقضی شده است. با شماره و کلید اختصاصی دوباره وارد شوید.',
  connection_in_progress: 'اتصال هنوز در حال راه‌اندازی است؛ کمی صبر کنید.',
  request_rejected: 'درخواست رد شد. صفحه را از آدرس اصلی سرویس باز کنید.',
  portal_not_configured: 'مدیر باید آدرس امن این سرویس را تنظیم کند.',
  phone_mismatch: 'شماره حساب اسکن‌شده با شماره ثبت‌شده یکسان نیست. سشن را ببندید و از مدیر دعوت‌نامه جدید بگیرید.',
  connection_failed: 'اتصال به واتساپ برقرار نشد. شبکه را بررسی کنید و دوباره تلاش کنید.',
  existing_account: 'برای این شماره سشن وجود دارد. از کلید اختصاصی قبلی استفاده کنید.'
}
async function request (route, body) {
  const options = { credentials: 'same-origin', cache: 'no-store' }
  if (body !== undefined) Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-portal-csrf': csrf }, body: JSON.stringify(body) })
  const response = await fetch('portal/' + route, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(response.status === 429 ? 'درخواست‌ها بیش از حد مجاز است؛ چند دقیقه بعد تلاش کنید.' : messages[data.error] || 'درخواست انجام نشد؛ دوباره تلاش کنید.')
    error.status = response.status
    throw error
  }
  return data
}
function showSession () { $('connect-form').hidden = true; $('session').hidden = false }
async function poll () {
  clearTimeout(timer)
  if (destroyed) return
  try {
    const data = await request('state')
    csrf = data.csrf
    showSession()
    $('session-id').textContent = data.sessionId
    const ready = data.state === 'ready'
    $('api-box').hidden = !ready
    $('step-two').classList.toggle('active', !ready)
    $('step-three').classList.toggle('active', ready)
    $('retry').hidden = !['offline', 'connection_failed', 'server_busy'].includes(data.state)
    $('disconnect').disabled = data.state === 'connecting'
    $('status').textContent = ready ? 'اتصال برقرار شد؛ واتساپ شما آماده است.' : data.state === 'qr' ? 'کد QR را با واتساپ شماره ' + data.phone + ' اسکن کنید.' : messages[data.state] || (data.state === 'offline' ? 'سشن فعلاً آفلاین است. برای بازیابی تلاش کنید.' : 'در حال اتصال به واتساپ؛ لطفاً صبر کنید…')
    $('qr').hidden = data.state !== 'qr'
    $('qr-help').hidden = data.state !== 'qr'
    if (data.state === 'qr') {
      const response = await fetch('portal/qr', { credentials: 'same-origin', cache: 'no-store' })
      if (response.ok) {
        if (qrUrl) URL.revokeObjectURL(qrUrl)
        qrUrl = URL.createObjectURL(await response.blob())
        $('qr').src = qrUrl
      }
    } else if (qrUrl) { URL.revokeObjectURL(qrUrl); qrUrl = null; $('qr').removeAttribute('src') }
    const api = new URL('client/getState/' + data.sessionId, window.location.href).href
    $('example').textContent = 'curl ' + JSON.stringify(api) + ' \\\n  -H "x-api-key: YOUR_SESSION_KEY"'
    $('error').textContent = ''
    timer = window.setTimeout(poll, ready ? 15000 : 4000)
  } catch (error) {
    if (error.status === 401) {
      $('connect-form').hidden = false
      $('session').hidden = true
      return
    }
    $('error').textContent = error.message
    timer = window.setTimeout(poll, 15000)
  }
}
$('connect-form').addEventListener('submit', async event => {
  event.preventDefault()
  $('connect').disabled = true
  $('error').textContent = ''
  try {
    const data = await request('connect', { phone: $('phone').value, invitation: $('invitation').value.trim(), key: $('recovery').value.trim() })
    csrf = data.csrf
    if (data.key) { $('secret').value = data.key; $('secret-box').hidden = false }
    $('invitation').value = ''
    $('recovery').value = ''
    await poll()
  } catch (error) { $('error').textContent = error.message } finally { $('connect').disabled = false }
})
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('secret').value); $('copy').textContent = 'کپی شد' } catch { $('secret').select() }
})
$('retry').addEventListener('click', async () => {
  try { await request('retry', {}); await poll() } catch (error) { $('error').textContent = error.message }
})
$('disconnect').addEventListener('click', async () => {
  if (!window.confirm('اتصال واتساپ بسته و کلید اختصاصی باطل شود؟')) return
  $('disconnect').disabled = true
  clearTimeout(timer)
  try {
    await request('disconnect', {})
    destroyed = true
    if (qrUrl) URL.revokeObjectURL(qrUrl)
    $('secret').value = ''
    $('secret-box').hidden = true
    $('session').hidden = true
    $('connect-form').hidden = false
    $('error').textContent = 'سشن بسته شد. برای اتصال جدید از مدیر دعوت‌نامه بگیرید.'
  } catch (error) { $('error').textContent = error.message; await poll() } finally { $('disconnect').disabled = false; destroyed = false }
})
window.addEventListener('pagehide', () => { destroyed = true; clearTimeout(timer); if (qrUrl) URL.revokeObjectURL(qrUrl) })
poll()
