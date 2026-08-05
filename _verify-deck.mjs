// Proves the Module Deck's behaviour, not its looks: filtering, keyboard navigation, and whether
// "open" actually reflects what is on screen.
//
//   node _verify-deck.mjs

import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (error) => console.log("PAGEERR:", error.message));

const pass = [];
const fail = [];
const check = (name, ok, detail = "") => (ok ? pass : fail).push(`${name}${detail ? ` — ${detail}` : ""}`);

await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(6000);

const openDeck = async () => { await page.evaluate(() => document.querySelector(".jcb-apps")?.click()); await page.waitForTimeout(500); };
const tiles = () => page.$$eval(".jml-tile .jml-text strong", (nodes) => nodes.map((n) => n.textContent.trim()));

await openDeck();
check("the deck opens", await page.$(".jml") !== null);
check("every module is listed", (await tiles()).length === 17, `${(await tiles()).length} tiles`);
check("groups are labelled", (await page.$$eval(".jml-group > header span", (n) => n.map((x) => x.textContent))).join(",") === "System,Intelligence,Work,Personal,Rooms");
check("each module says what it does", (await page.$$eval(".jml-tile .jml-text small", (n) => n.map((x) => x.textContent.trim()))).every(Boolean));

// The search field must already be focused — the whole point is typing without clicking first.
check("search is focused on open", await page.evaluate(() => document.activeElement?.tagName === "INPUT"));

await page.keyboard.type("paired");
await page.waitForTimeout(250);
const filtered = await tiles();
check("search matches the description, not only the name", filtered.includes("Devices") || filtered.includes("Trust"), filtered.join(", "));
check("search excludes what does not match", !filtered.includes("Weather"), filtered.join(", "));

await page.fill(".jml-search input", "zzzznothing");
await page.waitForTimeout(250);
check("a miss explains itself instead of showing a blank panel", (await page.$(".jml-empty")) !== null);

await page.fill(".jml-search input", "memory");
await page.waitForTimeout(250);
// Ranking: Vitals' description contains the word "memory", and without scoring it won an exact
// name match purely by being earlier in the registry. Typing a module's name must select it.
const rankedFirst = (await tiles())[0];
check("an exact name beats a description mention", rankedFirst === "Memory", `first result was ${rankedFirst}`);
await page.keyboard.press("Enter");
await page.waitForTimeout(1400);
check("enter opens the highlighted module", (await page.$(".jml")) === null, "deck should close on launch");
const opened = await page.evaluate(() => document.body.innerText.includes("Memory"));
check("the module actually opened", opened);

// Reopen: the widget just opened must now be marked as open.
await openDeck();
await page.waitForTimeout(600);
const openPills = await page.$$eval(".jml-tile[data-open='true'] .jml-text strong", (n) => n.map((x) => x.textContent.trim()));
check("an already-open module is marked open", openPills.includes("Memory"), openPills.length ? openPills.join(", ") : "nothing marked open");

await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("escape closes the deck", (await page.$(".jml")) === null);

console.log(`\n${"=".repeat(60)}`);
for (const item of pass) console.log(`  PASS  ${item}`);
for (const item of fail) console.log(`  FAIL  ${item}`);
console.log(`${"=".repeat(60)}\n${fail.length ? `${fail.length} CHECK(S) FAILED` : `all ${pass.length} checks passed`}`);

await browser.close();
process.exit(fail.length ? 1 : 0);
