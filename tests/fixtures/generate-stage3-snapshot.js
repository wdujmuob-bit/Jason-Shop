/*
  Builds tests/fixtures/stage3-snapshot.json: real Stage 3 (schema v4) data, made by
  loading stage2-snapshot.json into the Stage 3 production app (commit f91cda6) and
  using its forms: months of spending history (incl. one unusually big purchase and a
  double-entered bill), stock use until something runs out, and a finished shopping
  trip that pays real prices for products seen earlier (so savings can be measured).
  Stage 4 tests upgrade this v4 data to v5 and analyse it.

  usage (repo root):
    git worktree add /tmp/jason-shop-s3 f91cda6
    (cd /tmp/jason-shop-s3 && python3 -m http.server 8090 &)
    node tests/fixtures/generate-stage3-snapshot.js
*/
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const revealShim = require("../legacy/reveal-shim");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S2 = JSON.parse(fs.readFileSync(path.join(__dirname, "stage2-snapshot.json"), "utf8"));
const PORT = process.env.FIXTURE_PORT || 8090;
const NOW = Date.parse("2026-10-06T04:00:00Z");   // 12:00 Manila, an hour before the Stage 4 tests' clock

(async () => {
  const b = await puppeteer.launch({ executablePath: revealShim.CHROME, headless: "new", args: ["--no-sandbox"] }); revealShim(b);
  const p = await b.newPage();
  await p.setViewport({ width: 384, height: 854, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.emulateTimezone("Asia/Manila");
  await p.evaluateOnNewDocument(now => {
    const RD = Date, off = now - RD.now();
    class FD extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + off); else super(...a); } static now() { return RD.now() + off; } }
    window.Date = FD;
  }, NOW);
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  p.on("dialog", d => d.accept());
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.evaluate(async s => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase("JasonShopVault"); q.onsuccess = q.onerror = q.onblocked = () => r(); }); localStorage.setItem("JasonShopData", s); }, JSON.stringify(S2.data));
  await p.reload(); await sleep(1500);
  const ver = await p.evaluate(() => JasonModel.SCHEMA_VERSION);
  if (ver !== 4) throw new Error("expected the Stage 3 app (schema 4), got " + ver);
  await p.evaluate(() => { const b = document.querySelector("#bootBanner button"); if (b) b.click(); });
  const setVal = (sel, v) => p.$eval(sel, (e, v) => { if (e.type === "checkbox") e.checked = v; else e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, v);

  // 1. spending history through the Add spending form (Budget → History)
  const entries = [
    ["2026-05-03", 1200, "Pampang Market", "Weekly market"], ["2026-05-20", 1350, "Pampang Market", "Weekly market"],
    ["2026-06-04", 1280, "Pampang Market", "Weekly market"], ["2026-06-21", 1320, "Pampang Market", "Weekly market"],
    ["2026-07-05", 1250, "Pampang Market", "Weekly market"], ["2026-07-22", 1400, "Pampang Market", "Weekly market"],
    ["2026-08-06", 1300, "Pampang Market", "Weekly market"], ["2026-08-23", 1380, "Pampang Market", "Weekly market"],
    ["2026-09-15", 6500, "Pampang Market", "Party food for 30"],
    ["2026-09-27", 850, "Mercury Drug", "Vitamins"], ["2026-09-27", 850, "Mercury Drug", "Vitamins"]
  ];
  for (const [date, amount, store, item] of entries) {
    await p.evaluate(() => { goTo("history"); openEntry(null); }); await sleep(200);
    await setVal("#eDate", date); await setVal("#eAmount", String(amount)); await setVal("#eStore", store); await setVal("#eItem", item);
    await p.evaluate(cat => { const s = document.getElementById("eCategory"); const o = [...s.options].find(o => o.value === cat || o.text.includes(cat)); if (o) s.value = o.value; }, item === "Vitamins" ? "Health" : "Groceries");
    await p.evaluate(() => saveEntry()); await sleep(200);
    if (!(await p.$eval("#entryModal", e => e.classList.contains("hidden")))) throw new Error("entry not saved: " + item + " " + await p.$eval("#entryMsg", e => e.innerText));
  }

  // 2. stock use: cooking oil used up (a stock-out), eggs used
  await p.evaluate(() => goTo("inventory")); await sleep(300);
  const invId = n => p.evaluate(n => data.inventoryItems.find(i => i.name === n).id, n);
  for (let i = 0; i < 2; i++) await p.evaluate(id => quickStock(id, -1), await invId("Cooking oil"));
  for (let i = 0; i < 4; i++) await p.evaluate(id => quickStock(id, -1), await invId("Eggs"));
  await sleep(300);

  // 3. a shopping trip paying real prices (rice ₱345 vs ₱370 before; eggs ₱250 vs ₱225; oil 2 × ₱90 vs ₱95)
  await p.evaluate(() => { goTo("trip"); startTrip(); }); await sleep(400);
  const paid = { "Rice": ["store_landers", "345"], "Eggs": ["store_puregold", "250"], "Cooking oil": ["store_puregold", "180"] };
  for (const [name, [store, price]] of Object.entries(paid)) {
    await p.evaluate((n, store, price) => {
      const li = activeList().items.find(i => i.name === n && i.status === "open");
      document.getElementById("tp_" + li.id).value = price;
      tripCheck(li.id, store);
    }, name, store, price);
    await sleep(150);
  }
  await p.evaluate(() => finishTrip()); await sleep(500);
  const tripOk = await p.evaluate(() => data.trips.some(t => t.status === "finished"));
  if (!tripOk) throw new Error("trip not finished: " + await p.evaluate(() => (document.getElementById("tripMsg") || {}).innerText));

  await sleep(500);
  const d = JSON.parse(await p.evaluate(() => localStorage.getItem("JasonShopData")));
  const out = { generatedFrom: "f91cda6 (Stage 3 production app)", generatedAt: new Date(NOW).toISOString(), data: d };
  fs.writeFileSync(path.join(__dirname, "stage3-snapshot.json"), JSON.stringify(out, null, 1));
  console.log("schema", d.schemaVersion, "manual", d.manual.length, "prices", d.priceRecords.length, "trips", d.trips.map(t => t.status + ":" + t.total).join(","), "tx", d.inventoryTransactions.length, "spent", d.spent, "alerts", d.alerts.length);
  console.log("errors", errors);
  await b.close(); process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
