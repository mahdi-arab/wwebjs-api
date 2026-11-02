/* global document, fetch, Date */
const $ = id => document.getElementById(id)
$('admin-form').addEventListener('submit', async event => {
  event.preventDefault()
  const button = event.target.querySelector('button')
  button.disabled = true
  $('error').textContent = ''
  $('result').hidden = true
  try {
    const response = await fetch('invitations', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'x-api-key': $('admin-key').value }, body: JSON.stringify({ phone: $('phone').value }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error === 'existing_account' ? 'این شماره سشن دارد؛ برای ورود باید از کلید اختصاصی قبلی استفاده شود.' : response.status === 429 ? 'تعداد درخواست بیش از حد است؛ بعداً تلاش کنید.' : 'درخواست رد شد. شماره، کلید مدیریت و تنظیم آدرس امن سرویس را بررسی کنید.')
    $('invitation').value = data.code
    $('expiry').textContent = 'شماره: ' + data.phone + ' — اعتبار تا: ' + new Date(data.expiresAt).toLocaleString('fa-IR')
    $('result').hidden = false
  } catch (error) { $('error').textContent = error.message } finally { button.disabled = false; $('admin-key').value = '' }
})
