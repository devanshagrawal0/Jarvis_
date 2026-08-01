// Blackwood Manor E2E shooter — plays a full 3-player game and screenshots every screen.
// Run from jarvis-ui (playwright lives here): node _bw_shoot.mjs
import { chromium } from 'playwright'

const OUT = 'C:/Users/devan/OneDrive/Desktop/blackwood-manor/shots/'
const HOST = 'http://localhost:7777'

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
const host = await b.newPage({ viewport: { width: 1728, height: 972 }, deviceScaleFactor: 1 })
host.on('pageerror', (e) => console.log('HOSTERR:', e.message))
host.on('console', (m) => { if (m.type() === 'error') console.log('HOSTCON:', m.text().slice(0, 200)) })

const phaseOf = (p) => p.evaluate(() => document.querySelector('.screen-root')?.dataset.phase || document.querySelector('.phone-root')?.dataset.phase || null)
async function waitPhase(page, phase, timeout = 90000) {
  await page.waitForFunction(
    (ph) => (document.querySelector('.screen-root')?.dataset.phase || document.querySelector('.phone-root')?.dataset.phase) === ph,
    phase, { timeout }
  )
}
const shot = async (page, name, ms = 0) => { if (ms) await page.waitForTimeout(ms); await page.screenshot({ path: OUT + name }); console.log('shot', name) }

// ---------- lobby ----------
await host.goto(`${HOST}/host/`, { waitUntil: 'networkidle', timeout: 60000 })
await host.waitForTimeout(3000)
await shot(host, '01-lobby-empty.png')

const NAMES = ['Dev', 'Maya', 'Rio']
const phones = []
for (let i = 0; i < NAMES.length; i++) {
  const p = await b.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 })
  p.on('pageerror', (e) => console.log(`P${i}ERR:`, e.message))
  await p.goto(`${HOST}/play/?seat=${i + 1}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  const input = p.locator('input')
  if (await input.count()) {
    await input.fill(NAMES[i])
    await p.locator('button.primary').click()
  }
  await p.waitForTimeout(400)
  phones.push(p)
}
await shot(phones[0], 'p01-join-lobby.png', 500)
await shot(host, '02-lobby-guests.png', 1500)

// ---------- begin ----------
await host.locator('button.primary').click()
await waitPhase(host, 'INTRO')
await shot(host, '03-intro-line1.png', 2500)
await shot(host, '04-intro-mid.png', 6000)

// ---------- deal: open all envelopes ----------
await waitPhase(host, 'DEAL')
await shot(host, '05-deal.png', 1200)
let killerIdx = -1
for (let i = 0; i < phones.length; i++) {
  const p = phones[i]
  const env = p.locator('.envelope')
  try {
    await env.waitFor({ timeout: 5000 })
    const box = await env.boundingBox()
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await p.mouse.down()
    await p.waitForTimeout(1200)
    await p.mouse.up()
  } catch { console.log(`P${i}: no envelope`) }
  if (await p.locator('.killer-banner').count()) killerIdx = i
}
console.log('killer is', killerIdx, NAMES[killerIdx])
// held dossier shot (innocent + killer)
const showDossier = async (i, name) => {
  const p = phones[i]
  const d = p.locator('.dossier')
  if (!(await d.count())) return
  const box = await d.boundingBox()
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await p.mouse.down()
  await p.waitForTimeout(600)
  await shot(p, name)
  await p.mouse.up()
}
await showDossier(killerIdx === 0 ? 1 : 0, 'p02-dossier-innocent.png')
if (killerIdx >= 0) await showDossier(killerIdx, 'p03-dossier-killer.png')

// ---------- night ----------
await waitPhase(host, 'NIGHT')
await shot(host, '06-night.png', 1000)
await shot(phones[killerIdx >= 0 ? killerIdx : 0], 'p04-night-manifest.png', 500)
if (killerIdx >= 0) {
  const kp = phones[killerIdx]
  const tiles = kp.locator('.pick-tile')
  if (await tiles.count()) await tiles.first().click()
}

// ---------- investigation 1 ----------
await waitPhase(host, 'INVESTIGATION_1')
await shot(host, '07-investigation1.png', 1500)
for (let i = 0; i < phones.length; i++) {
  const p = phones[i]
  try {
    await p.locator('.pick-tile').first().waitFor({ timeout: 6000 })
    const tiles = p.locator('.pick-tile')
    await tiles.nth(i % 3).click()
    await tiles.nth((i % 3) + 3).click()
    if (i === 0) await shot(p, 'p05-channels-picked.png', 200)
    await p.locator('button.primary').click()
  } catch (e) { console.log(`P${i} inv1 fail:`, e.message.slice(0, 120)) }
}
await shot(phones[0], 'p06-clues.png', 1200)

// whisper: Dev whispers Maya (if Dev isn't mid-something)
try {
  const wb = phones[0].locator('button', { hasText: 'Whisper' })
  if (await wb.count()) {
    await wb.click()
    await phones[0].locator('.vote-list button').first().click()
    await phones[0].waitForTimeout(600)
    await phones[0].locator('.canned-row button').first().click()
    await shot(phones[0], 'p07-whisper.png', 400)
    await shot(host, '08-whisper-banner.png', 300)
  }
} catch (e) { console.log('whisper fail:', e.message.slice(0, 120)) }

// ---------- parlor ----------
await waitPhase(host, 'PARLOR', 120000)
await shot(host, '09-parlor.png', 1200)
for (let i = 0; i < phones.length; i++) {
  const p = phones[i]
  try {
    await p.locator('.pick-tile.small').first().waitFor({ timeout: 8000 })
    await p.locator('.pick-tile.small').first().click() // claim a room
    await p.waitForTimeout(400)
    const items = p.locator('.pick-tile.small')
    for (let k = 0; k < 4; k++) await items.nth(k).click()
    if (i === 0) await shot(p, 'p08-divergence.png', 200)
    await p.locator('button.primary').click()
  } catch (e) { console.log(`P${i} parlor fail:`, e.message.slice(0, 120)) }
}

// ---------- second kill ----------
await waitPhase(host, 'SECOND_KILL', 120000)
await shot(host, '10-secondkill-narr.png', 2000)
await shot(host, '11-divergence-board.png', 8000)

// ---------- investigation 2 ----------
await waitPhase(host, 'INVESTIGATION_2', 60000)
await shot(host, '12-investigation2.png', 1500)
for (let i = 0; i < phones.length; i++) {
  const p = phones[i]
  try {
    // bargain?
    const acc = p.locator('button.danger', { hasText: 'Accept' })
    if (await acc.count()) { await shot(p, `p09-bargain-${i}.png`); await acc.click() }
    await p.locator('.pick-tile').first().waitFor({ timeout: 6000 })
    await p.locator('.pick-tile').nth(i % 3).click()
    await p.locator('button.primary').click()
  } catch (e) { console.log(`P${i} inv2 fail:`, e.message.slice(0, 120)) }
}

// ---------- tribunal ----------
await waitPhase(host, 'TRIBUNAL', 90000)
await shot(host, '13-tribunal.png', 2000)
for (let i = 0; i < phones.length; i++) {
  const p = phones[i]
  try {
    await p.locator('.wc-msg').first().waitFor({ timeout: 6000 })
    if (i === 0) {
      await p.locator('.wc-msg').first().click()
      await p.waitForTimeout(400)
      const clue = p.locator('.wc-msg').last()
      await clue.click()
      await shot(p, 'p10-tribunal-challenge.png', 200)
      await p.locator('button.danger', { hasText: 'Object' }).click()
    } else {
      await p.locator('button', { hasText: 'Hold my peace' }).click()
    }
  } catch (e) { console.log(`P${i} tribunal fail:`, e.message.slice(0, 120)) }
}
await shot(host, '14-tribunal-challenged.png', 1500)

// ---------- vote ----------
await waitPhase(host, 'VOTE', 120000)
await shot(host, '15-vote.png', 1200)
// everyone votes for the killer (or first candidate)
for (let i = 0; i < phones.length; i++) {
  if (i === killerIdx) continue
  const p = phones[i]
  try {
    await p.locator('.vote-list button').first().waitFor({ timeout: 6000 })
    const btns = p.locator('.vote-list button')
    const n = await btns.count()
    let clicked = false
    for (let k = 0; k < n; k++) {
      const t = await btns.nth(k).innerText()
      if (killerIdx >= 0 && t.includes(NAMES[killerIdx])) { await btns.nth(k).click(); clicked = true; break }
    }
    if (!clicked) await btns.first().click()
  } catch (e) { console.log(`P${i} vote fail:`, e.message.slice(0, 120)) }
}
if (killerIdx >= 0) {
  const kp = phones[killerIdx]
  try {
    await kp.locator('.vote-list button').first().waitFor({ timeout: 6000 })
    await kp.locator('.vote-list button').first().click() // killer votes someone
    // last confession may appear
    await kp.waitForTimeout(2500)
    const conf = kp.locator('.vote-list button')
    if (await conf.count()) { await shot(kp, 'p11-last-confession.png'); await conf.first().click() }
  } catch (e) { console.log('killer vote fail:', e.message.slice(0, 120)) }
}

// ---------- reckoning ----------
await waitPhase(host, 'RECKONING', 120000)
await shot(host, '16-reckoning-verdict.png', 2500)
await shot(host, '17-reckoning-truth.png', 6000)
await shot(host, '18-reckoning-scores.png', 8000)
await shot(phones[0], 'p12-reckoning.png', 500)

console.log('DONE. killer was', NAMES[killerIdx])
await b.close()
