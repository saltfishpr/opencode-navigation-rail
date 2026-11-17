import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite"
import solid from "vite-plugin-solid"

let server
let browser
let page

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    plugins: [solid()],
    server: { host: "127.0.0.1", port: 0 },
  })
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
})

after(async () => {
  await page?.close()
  await browser?.close()
  await server?.close()
})

async function fixture() {
  await page?.close()
  page = await browser.newPage({ viewport: { width: 1024, height: 600 } })
  const address = server.httpServer.address()
  await page.goto(`http://127.0.0.1:${address.port}/test/fixture.html`)
  await page.locator(".onr-tick").first().waitFor()
  return page
}

const tick = (id) => page.locator(`[data-turn-id="msg_00${id}"]`)
const scroller = () => page.locator(".scroll-view__viewport")

test("the compiled GUI registers the rail, reads assistant rows and supports keyboard navigation", async () => {
  await fixture()
  assert.equal(await page.locator(".onr-tick").count(), 4)
  assert.equal(await tick(8).getAttribute("aria-current"), "location")
  assert.equal(await tick(9).count(), 0)

  await scroller().evaluate((node) => { node.scrollTop = 850 })
  await page.waitForFunction(() => document.querySelector('[aria-current="location"]')?.dataset.turnId === "msg_005")
  await tick(5).hover()
  await page.getByText("A long reply to the fifth prompt.", { exact: false }).last().waitFor()
  await tick(5).focus()
  await page.keyboard.press("ArrowDown")
  assert.equal(await page.evaluate(() => document.activeElement.dataset.turnId), "msg_006")
  await page.keyboard.press("Escape")
  await page.locator(".onr-preview").waitFor({ state: "hidden" })
  await page.keyboard.press("Enter")
  await page.waitForURL((url) => url.hash === "#message-msg_006")
  assert.equal(new URL(page.url()).hash, "#message-msg_006")
})

test("paging history leaves the transcript in place and choosing an old marker uses its hash", async () => {
  await fixture()
  const scrollBefore = await scroller().evaluate((node) => node.scrollTop)
  await page.getByRole("button", { name: "Load earlier turns" }).click()
  await tick(2).waitFor()
  assert.deepEqual(await page.evaluate(() => window.fixture.seenCursors), [undefined, "older"])
  assert.equal(await scroller().evaluate((node) => node.scrollTop), scrollBefore)
  assert.equal(await page.locator("#message-msg_002").count(), 0)
  assert.equal(await tick(2).getAttribute("aria-label"), "notes.txt")
  await tick(2).click()
  await page.waitForFunction(() => location.hash === "#message-msg_002")
  const target = await page.locator("#message-msg_002").boundingBox()
  assert.ok(target.y >= 47 && target.y <= 50)
})

test("history failure can be retried, and deactivation cancels a request", async () => {
  await fixture()
  await page.evaluate(() => { window.fixture.failures = 1 })
  await page.getByRole("button", { name: "Load earlier turns" }).click()
  const retry = page.getByRole("button", { name: "Could not load earlier turns. Try again" })
  await retry.waitFor()
  await page.evaluate(() => { window.fixture.delayHistory = true })
  await retry.click()
  await page.getByRole("button", { name: "Loading earlier turns…" }).waitFor()
  await page.evaluate(() => window.fixture.setActive(false))
  await page.locator(".onr").waitFor({ state: "detached" })
  await page.waitForFunction(() => window.fixture.aborted)
})

test("the rail follows the conversation pane width", async () => {
  await fixture()
  await page.evaluate(() => window.fixture.setNarrow(true))
  await page.locator(".onr").waitFor({ state: "hidden" })
  await page.evaluate(() => window.fixture.setNarrow(false))
  await page.locator(".onr").waitFor()
})
