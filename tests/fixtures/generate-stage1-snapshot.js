/*
  Builds tests/fixtures/stage1-snapshot.json: real Stage 1 (schema v2) data, made by
  loading the pre-upgrade snapshot into the Stage 1 production app (commit 6e2f8ed)
  and using its UI (household, commitment, reserve, budget plan, a store, a shelf price).

  usage (repo root):
    git worktree add /tmp/jason-shop-s1 6e2f8ed
    (cd /tmp/jason-shop-s1 && python3 -m http.server 8080 &)
    node tests/fixtures/generate-stage1-snapshot.js
*/
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const revealShim = require("../legacy/reveal-shim");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PRE = JSON.parse(fs.readFileSync(path.join(__dirname, "pre-upgrade-snapshot.json"), "utf8"));

(async () => {
  const b = await puppeteer.launch({ executablePath: revealShim.CHROME, headless: "new", args: ["--no-sandbox"] }); revealShim(b);
  const p = await b.newPage();
  await p.setViewport({ width: 384, height: 854, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  p.on("dialog", d => d.accept());
  await p.goto("http://localhost:8080/index.html");
  await p.evaluate(async s => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase("JasonShopVault"); q.onsuccess = q.onerror = q.onblocked = () => r(); }); localStorage.setItem("JasonShopData", s); }, JSON.stringify(PRE.data));
  await p.reload(); await sleep(1500);
  const tap = async sel => { const el = await p.$(sel); await el.evaluate(e => e.scrollIntoView({ block: "center" })); await sleep(120); const bb = await el.boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(250); };
  const typeInto = async (sel, v) => { await p.$eval(sel, e => e.value = ""); await tap(sel); const c = await p.target().createCDPSession(); await c.send("Input.insertText", { text: v }); await sleep(60); };
  const setVal = (sel, v) => p.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, v);

  // household
  await p.evaluate(() => goTo("household")); await sleep(300);
  for (const [g, n] of [["adults", 2], ["children", 2], ["maids", 1], ["pets", 1]]) for (let i = 0; i < n; i++) await tap(`button[onclick="stepGroup('grp_main_${g}',1)"]`);
  // commitment + reserve
  await p.evaluate(() => goTo("commitments")); await sleep(300);
  await tap("button[onclick='openCommitment(null)']"); await typeInto("#cmTitle", "Landers monthly haul"); await typeInto("#cmAmount", "3,000");
  await p.select("#cmCat", "Groceries"); await p.select("#cmStore", "store_landers"); await tap("#sheetBody button.primary");
  await tap("button[onclick='openReserve(null)']"); await typeInto("#rsName", "Emergency"); await typeInto("#rsAmount", "10k"); await tap("#sheetBody button.primary");
  // budget plan
  await p.evaluate(() => goTo("plan")); await sleep(300);
  await typeInto("#al_cat_groceries", "20000"); await typeInto("#al_cat_food_and_dining", "5000");
  await tap("#previewPlanBtn"); await tap("#confirmPlanBtn");
  // custom store from history + shelf price
  await p.evaluate(() => goTo("stores")); await sleep(300);
  await tap("button[onclick*='SM Supermarket']"); await tap("#sheetBody button.primary");
  await p.evaluate(() => goTo("prices")); await sleep(300);
  await tap("button[onclick='openPrice(null)']");
  const riceId = await p.evaluate(() => data.products.find(x => x.name === "Rice Jasmine 5kg").id);
  await p.select("#prProduct", riceId); await typeInto("#prPrice", "360"); await p.select("#prStore", "store_puregold"); await p.select("#prSource", "shelf");
  await setVal("#prDate", "2026-10-04");
  await tap("#sheetBody button.primary");
  await sleep(500);
  const raw = await p.evaluate(() => localStorage.getItem("JasonShopData"));
  const d = JSON.parse(raw);
  const out = { generatedFrom: "6e2f8ed (Stage 1 production app)", generatedAt: new Date().toISOString(), data: d };
  fs.writeFileSync(path.join(__dirname, "stage1-snapshot.json"), JSON.stringify(out, null, 1));
  console.log("schema", d.schemaVersion, "stores", d.stores.length, "products", d.products.length, "prices", d.priceRecords.length, "commitments", d.commitments.length, "reserves", d.reserves.length, "plan", d.budgetPlan.items.length, "spent", d.spent);
  console.log("errors", errors);
  await b.close(); process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
