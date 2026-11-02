const { launch } = require('puppeteer')
;(async () => {
  const browser = await launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })
  try {
    const page = await browser.newPage()
    await page.setContent('<title>container-smoke</title>')
    if (await page.title() !== 'container-smoke') throw new Error('Chromium page failed')
    console.log('Container Chromium launch and page evaluation passed')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
