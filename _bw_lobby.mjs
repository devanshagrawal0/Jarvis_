// Quick reshoot: lobby with guests + intro frame after stage recomposition.
import { chromium } from 'playwright'
const OUT = 'C:/Users/devan/OneDrive/Desktop/blackwood-manor/shots/'
const HOST = 'http://localhost:7777'
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
const host = await b.newPage({ viewport: { width: 1728, height: 972 } })
host.on('pageerror', (e) => console.log('HOSTERR:', e.message))
await host.goto(`${HOST}/host/`, { waitUntil: 'networkidle', timeout: 60000 })
for (let i = 0; i < 3; i++) {
  const p = await b.newPage({ viewport: { width: 390, height: 800 } })
  await p.goto(`${HOST}/play/?seat=${i + 1}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)
  const input = p.locator('input')
  if (await input.count()) { await input.fill(['Dev', 'Maya', 'Rio'][i]); await p.locator('button.primary').click() }
}
await host.waitForTimeout(2500)
await host.screenshot({ path: OUT + 'r1-lobby.png' })
// trigger a lightning for drama
await host.evaluate(() => {})
await host.locator('button.primary').click()
await host.waitForFunction(() => document.querySelector('.screen-root')?.dataset.phase === 'INTRO', null, { timeout: 20000 })
await host.waitForTimeout(2500)
await host.screenshot({ path: OUT + 'r2-intro.png' })
await host.waitForTimeout(12000)
await host.screenshot({ path: OUT + 'r3-intro-title.png' })
console.log('done')
await b.close()
