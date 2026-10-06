/*
  Builds tests/fixtures/stage2-snapshot.json: real Stage 2 (schema v3) data, made by
  loading stage1-snapshot.json into the Stage 2 production app (commit 1dd5846) and
  using its forms: products, shelf prices at several stores and dates, home inventory
  and a shopping list. Stage 3 tests upgrade this v3 data to v4.

  usage (repo root):
    git worktree add /tmp/jason-shop-s2 1dd5846
    (cd /tmp/jason-shop-s2 && python3 -m http.server 8090 &)
    node tests/fixtures/generate-stage2-snapshot.js
*/
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const revealShim = require("../legacy/reveal-shim");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S1 = JSON.parse(fs.readFileSync(path.join(__dirname, "stage1-snapshot.json"), "utf8"));
const PORT = process.env.FIXTURE_PORT || 8090;
const NOW = Date.parse("2026-10-06T04:00:00Z");   // 12:00 Manila, an hour before the Stage 3 tests' clock

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
  await p.evaluate(async s => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase("JasonShopVault"); q.onsuccess = q.onerror = q.onblocked = () => r(); }); localStorage.setItem("JasonShopData", s); }, JSON.stringify(S1.data));
  await p.reload(); await sleep(1500);
  const ver = await p.evaluate(() => JasonModel.SCHEMA_VERSION);
  if (ver !== 3) throw new Error("expected the Stage 2 app (schema 3), got " + ver);
  await p.evaluate(() => { const b = document.querySelector("#bootBanner button"); if (b) b.click(); });
  const tap = async sel => { const el = await p.$(sel); if (!el) throw new Error("missing " + sel); await el.evaluate(e => e.scrollIntoView({ block: "center" })); await sleep(120); const bb = await el.boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(250); };
  const typeInto = async (sel, v) => { await p.$eval(sel, e => e.value = ""); await tap(sel); const c = await p.target().createCDPSession(); await c.send("Input.insertText", { text: v }); await sleep(60); };
  const setVal = (sel, v) => p.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const sheetClosed = async () => { for (let i = 0; i < 20; i++) { if (await p.$eval("#sheetModal", e => e.classList.contains("hidden"))) return true; await sleep(150); } return false; };
  const isClosed = () => p.$eval("#sheetModal", e => e.classList.contains("hidden"));
  const saveSheet = async (sel, what) => {
    for (let i = 0; i < 3; i++) {
      if (await isClosed()) return;
      if (!(await p.$(sel))) { if (i > 0) { await p.evaluate(() => closeSheet()); await sleep(200); return; } break; }   // saved; app opened a detail sheet
      await tap(sel); await sheetClosed();
    }
    if (!(await isClosed())) throw new Error("not saved: " + what + " — " + await p.$eval("#sheetBody", e => e.innerText.slice(0, 300)));
  };
  const pid = name => p.evaluate(n => data.products.find(x => x.name === n && !x.archived).id, name);

  // products
  await p.evaluate(() => goTo("prices")); await sleep(300);
  const products = [
    { name: "Rice Jasmine 25kg sack", size: "25", unit: "kg" },
    { name: "Rice Dinorado 5kg", size: "5", unit: "kg" },
    { name: "Eggs tray", size: "30", unit: "piece" },
    { name: "Cooking Oil 1L", size: "1", unit: "l" },
    { name: "Dish soap 250ml", size: "250", unit: "ml" }
  ];
  for (const f of products) {
    await p.evaluate(() => openProductEdit(null)); await sleep(250);
    await typeInto("#pdName", f.name); await setVal("#pdSize", f.size); await setVal("#pdUnit", f.unit);
    await p.evaluate(() => { const s = document.getElementById("pdCat"); const o = [...s.options].find(o => /Groceries/.test(o.text)); if (o) s.value = o.value; });
    await saveSheet("#sheetBody button.primary", "product not saved: " + f.name);
  }
  // shelf prices (store, price, date) — real history for store rankings and buy/wait advice
  const prices = [
    ["Rice Jasmine 5kg", "store_puregold", 380, "2026-08-20"], ["Rice Jasmine 5kg", "store_puregold", 370, "2026-09-05"],
    ["Rice Jasmine 25kg sack", "store_landers", 1550, "2026-09-20"],
    ["Rice Dinorado 5kg", "store_puregold", 330, "2026-10-03"],
    ["Eggs tray", "store_puregold", 255, "2026-09-15"], ["Eggs tray", "store_puregold", 240, "2026-09-29"],
    ["Eggs tray", "store_sm_supermarket_ax0u", 270, "2026-10-02"], ["Eggs tray", "store_pampang", 225, "2026-10-01"],
    ["Cooking Oil 1L", "store_sm_supermarket_ax0u", 95, "2026-10-02"], ["Cooking Oil 1L", "store_puregold", 89, "2026-09-28"],
    ["Dish soap 250ml", "store_sm_supermarket_ax0u", 45, "2026-10-02"], ["Dish soap 250ml", "store_puregold", 49, "2026-10-01"]
  ];
  for (const [prod, store, price, date] of prices) {
    await p.evaluate(() => openPrice(null)); await sleep(250);
    await setVal("#prProduct", await pid(prod)); await typeInto("#prPrice", String(price)); await setVal("#prStore", store);
    await setVal("#prSource", "shelf"); await setVal("#prDate", date);
    await saveSheet("#sheetBody button.primary", "price not saved: " + prod + " " + price);
  }
  // inventory
  await p.evaluate(() => goTo("inventory")); await sleep(300);
  const inv = [
    { product: "Rice Jasmine 5kg", name: "Rice", qty: 6, unit: "kg", pack: 5, mode: "per_person", perPerson: 0.2 },
    { product: "Eggs tray", name: "Eggs", qty: 6, unit: "pcs", pack: 30, min: 12 },
    { product: "Dish soap 250ml", name: "Dish soap", qty: 0, unit: "bottles" },
    { product: "Cooking Oil 1L", name: "Cooking oil", qty: 2, unit: "bottles", min: 1 }
  ];
  for (const f of inv) {
    await p.evaluate(() => openInvItem(null)); await sleep(250);
    if (f.product) await p.evaluate(n => { const s = document.getElementById("ivProduct"); s.value = [...s.options].find(o => o.text.startsWith(n)).value; s.dispatchEvent(new Event("change")); }, f.product);
    await typeInto("#ivName", f.name); await typeInto("#ivQty", String(f.qty)); await typeInto("#ivUnit", f.unit);
    if (f.pack) await typeInto("#ivPack", String(f.pack));
    if (f.min) await typeInto("#ivMin", String(f.min));
    if (f.mode) await setVal("#ivMode", f.mode);
    if (f.perPerson) await typeInto("#ivPerPerson", String(f.perPerson));
    await saveSheet("#ivSave", "inventory not saved: " + f.name);
  }
  // shopping list
  await p.evaluate(() => goTo("lists")); await sleep(300);
  const list = [["Rice", "Rice Jasmine 5kg", 1], ["Eggs", "Eggs tray", 1], ["Cooking oil", "Cooking Oil 1L", 2], ["Dish soap", "Dish soap 250ml", 1], ["Birthday cake", null, 1]];
  for (const [name, prod, qty] of list) {
    await p.evaluate(() => openListItem(null)); await sleep(250);
    if (prod) await setVal("#liProduct", await pid(prod));
    await typeInto("#liName", name);
    await typeInto("#liQty", String(qty));
    await saveSheet("#liSave", "list item not saved: " + name);
  }
  await sleep(500);
  const d = JSON.parse(await p.evaluate(() => localStorage.getItem("JasonShopData")));
  const out = { generatedFrom: "1dd5846 (Stage 2 production app)", generatedAt: new Date(NOW).toISOString(), data: d };
  fs.writeFileSync(path.join(__dirname, "stage2-snapshot.json"), JSON.stringify(out, null, 1));
  const items = d.shoppingLists.find(l => l.status === "active").items;
  console.log("schema", d.schemaVersion, "products", d.products.length, "prices", d.priceRecords.length, "inventory", d.inventoryItems.length, "list", items.length, items.map(i => i.name + "×" + i.qty + "@" + i.plannedAmount).join(", "), "spent", d.spent);
  console.log("errors", errors);
  await b.close(); process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
