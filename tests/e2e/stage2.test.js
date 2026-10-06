/*
  Stage 2 end-to-end tests — headless mobile Chrome (384×854, touch), AI mocked.
  Starts from a REAL Stage 1 (schema v2) snapshot (tests/fixtures/stage1-snapshot.json,
  produced by driving the Stage 1 app through its UI). The page clock is pinned to
  2026-10-06 13:00 Asia/Manila so cycle and "days ago" checks are stable.
  Run with: bash tests/run-browser-tests.sh stage2   (or: e2e / all)
*/
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const fs = require("fs");
const revealShim = require("../legacy/reveal-shim");
const FIX = path.join(__dirname, "..", "fixtures");
const OUT = process.env.TEST_OUT || path.join(os.tmpdir(), "jason-shop-tests");
const DL = path.join(OUT, "dl-stage2");
fs.mkdirSync(DL, { recursive: true });
const URL = "http://localhost:8080/index.html";
const SNAP = JSON.parse(fs.readFileSync(path.join(FIX, "stage1-snapshot.json"), "utf8"));
const NOW = Date.parse("2026-10-06T05:00:00Z");   // 13:00 in Manila
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ctl = q => fetch("http://localhost:3999/" + q).then(r => r.json());
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, x); } };
async function waitFor(fn, ms = 10000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { } await sleep(150); } return false; }

(async () => {
  const b = await puppeteer.launch({ executablePath: revealShim.CHROME, headless: "new", args: ["--no-sandbox"] }); revealShim(b);
  const mk = async (seedText) => {
    const p = await b.newPage();
    await p.setUserAgent("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36");
    await p.setViewport({ width: 384, height: 854, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await p.emulateTimezone("Asia/Manila");
    await p.evaluateOnNewDocument(now => {
      const RD = Date, off = now - RD.now();
      class FD extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + off); else super(...a); } static now() { return RD.now() + off; } }
      window.Date = FD;
    }, NOW);
    const cdp = await p.target().createCDPSession(); await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
    p.errors = []; p.on("pageerror", e => p.errors.push(e.message));
    p.on("console", m => { if (m.type() === "error" && !/favicon|status of (4\d\d|5\d\d)|ERR_CONNECTION/.test(m.text())) p.errors.push(m.text()); });
    p.dialogs = []; p.confirmAnswer = true;
    p.on("dialog", d => { p.dialogs.push(d.message()); if (d.type() === "confirm" && !p.confirmAnswer) d.dismiss(); else d.accept(); });
    await p.goto(URL);
    await p.evaluate(async (s) => {
      localStorage.clear();
      await new Promise(r => { const q = indexedDB.deleteDatabase("JasonShopVault"); q.onsuccess = q.onerror = q.onblocked = () => r(); });
      if (s !== null) localStorage.setItem("JasonShopData", s);
    }, seedText);
    await p.reload();
    await sleep(700);
    return p;
  };
  const tap = async (p, sel) => { const el = await p.$(sel); if (!el) throw new Error("not found: " + sel); await el.evaluate(e => e.scrollIntoView({ block: "center" })); await sleep(120); const bb = await el.boundingBox(); if (!bb) throw new Error("not visible: " + sel); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(280); };
  const typeInto = async (p, sel, v) => { await p.$eval(sel, e => e.value = ""); await tap(p, sel); const c = await p.target().createCDPSession(); await c.send("Input.insertText", { text: v }); await sleep(60); };
  const setVal = (p, sel, v) => p.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const text = (p, sel) => p.$eval(sel, e => e.innerText);
  const exists = (p, sel) => p.$(sel).then(e => !!e);
  const visible = (p, sel) => p.$eval(sel, e => !!e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").catch(() => false);
  const D = p => p.evaluate(() => JSON.parse(JSON.stringify(data)));
  const stored = p => p.evaluate(() => JSON.parse(localStorage.getItem("JasonShopData")));
  const shot = (p, name) => p.screenshot({ path: path.join(OUT, "stage2-" + name + ".png") });
  const sheetOpen = p => waitFor(() => visible(p, "#sheetModal"), 3000);
  const noNegatives = async p => { const t = await p.evaluate(() => document.body.innerText); return !/[−-]\s?₱\s?\d|₱\s?[−-]\d|NaN|undefined|Infinity|null/.test(t) ? true : t.match(/.{0,30}([−-]\s?₱\s?\d|₱\s?[−-]\d|NaN|undefined|Infinity|null).{0,30}/)[0]; };
  const tapRowBtn = (p, row, act) => tap(p, `${row} [data-act='${act}']`);
  const addInv = async (p, f) => {
    await tap(p, (await exists(p, "#invAddBtn")) ? "#invAddBtn" : "#invAddFirst"); await sheetOpen(p);
    if (f.product) await p.evaluate(n => { const s = document.getElementById("ivProduct"); s.value = [...s.options].find(o => o.text.startsWith(n)).value; s.dispatchEvent(new Event("change")); }, f.product);
    await typeInto(p, "#ivName", f.name);
    if (f.qty != null) await typeInto(p, "#ivQty", String(f.qty));
    if (f.unit) await typeInto(p, "#ivUnit", f.unit);
    if (f.loc) await setVal(p, "#ivLoc", f.loc);
    if (f.pack) await typeInto(p, "#ivPack", String(f.pack));
    if (f.min) await typeInto(p, "#ivMin", String(f.min));
    if (f.mode) await setVal(p, "#ivMode", f.mode);
    if (f.perDay) await typeInto(p, "#ivPerDay", String(f.perDay));
    if (f.perPerson) await typeInto(p, "#ivPerPerson", String(f.perPerson));
    if (f.perish) { await tap(p, "#ivPerish"); if (f.expiry) await setVal(p, "#ivExpiry", f.expiry); if (f.life) await typeInto(p, "#ivLife", String(f.life)); }
    await tap(p, "#ivSave");
    if (f.expectDup) { await tap(p, "#ivSave"); }
    await waitFor(async () => !(await visible(p, "#sheetModal")), 3000);
  };
  const invRowSel = async (p, name) => p.evaluate(n => { const it = data.inventoryItems.find(i => i.name === n && !i.archived); return it ? `[data-inv='${it.id}']` : null; }, name);
  const liSel = async (p, name, st) => p.evaluate((n, st) => { const l = data.shoppingLists.find(x => x.status === "active"); const it = l.items.find(i => i.name === n && (!st || st.includes(i.status))); return it ? `[data-li='${it.id}']` : null; }, name, st || null);
  const inv = async (p, name) => p.evaluate(n => JSON.parse(JSON.stringify(data.inventoryItems.find(i => i.name === n && !i.archived) || null)), name);
  const li = async (p, name) => p.evaluate(n => { const l = data.shoppingLists.find(x => x.status === "active"); return JSON.parse(JSON.stringify(l.items.filter(i => i.name === n).pop() || null)); }, name);

  /* ================= M. UPGRADE v2 → v4 from a real Stage 1 snapshot ================= */
  const v2 = SNAP.data;
  let p = await mk(JSON.stringify(v2));
  await waitFor(async () => (await text(p, "#bootBanner")).includes("upgraded"));
  const banner = await text(p, "#bootBanner");
  check("M1 upgrade banner: data kept + Stage 2 features named", banner.includes("2 receipts") && banner.includes("3 manual entries") && banner.includes("₱12,197") && banner.includes("home inventory"), banner);
  await waitFor(async () => ((await stored(p)) || {}).schemaVersion === 4);
  let s = await stored(p);
  check("M2 saved data is schema v4, every Stage 1 record kept", s.schemaVersion === 4 && s.products.length === 3 && s.priceRecords.length === 7 && s.receipts.length === 2 && s.manual.length === 3 && s.commitments.length === 1 && s.reserves.length === 1 && s.spent === 12197 && s.fund === 60000 && s.stores.length === 8 && s.budgetPlan.items.length === 2);
  check("M3 15-day cycle anchored on the 1st, one active list, Stage 1 prices = High confidence", s.settings.cycle.mode === "days" && s.settings.cycle.lengthDays === 15 && s.settings.cycle.anchorDate === "2026-10-01" && s.shoppingLists.length === 1 && s.priceRecords.every(r => r.matchConfidence === "high" && r.needsReview === false));
  const snaps = await p.evaluate(() => JasonStore.listSnapshots());
  check("M4 safety copy of the v2 data saved first (IndexedDB)", snaps.length === 1 && snaps[0].reason === "before upgrade v2 → v4" && snaps[0].counts.priceRecords === 7 && snaps[0].counts.products === 3);
  check("M5 upgrade audited + backup log", s.auditLog.some(a => a.action === "data.upgraded") && s.backupLog.some(l => l.action === "Migration backup created" && l.status === "success"));
  check("M6 integrity check clean after upgrade", await p.evaluate(() => JasonModel.integrityCheck(data).errors === 0));
  await tap(p, "#bootBanner button");

  /* ================= I. INVENTORY ================= */
  await tap(p, "#navInventory");
  check("I1 empty inventory explains itself and offers 'Add first item'", (await text(p, "#inventoryBody")).includes("Start your home inventory") && await exists(p, "#invAddFirst"));
  // 5 people (2 adults, 2 children, 1 maid) + 1 pet in the snapshot
  await addInv(p, { product: "Rice Jasmine 5kg", name: "Rice", qty: 6, unit: "kg", pack: 5, mode: "per_person", perPerson: 0.2 });
  let rice = await inv(p, "Rice");
  check("I2 item linked to Price Book product, starting stock recorded", rice && rice.productId === v2.products[2].id && rice.quantity === 6 && rice.packSize === 5 && rice.usage.mode === "per_person" && (await D(p)).inventoryTransactions.filter(t => t.itemId === rice.id && t.type === "add").length === 1);
  await addInv(p, { product: "Mineral Water 6x1L", name: "Mineral Water 6x1L", qty: 1, unit: "packs", mode: "manual", perDay: 0.5, loc: "storeroom" });
  const eggExp = "2026-10-08";
  await addInv(p, { name: "Eggs", qty: 30, unit: "pcs", min: 12, mode: "none", perish: true, expiry: eggExp, life: 14, loc: "fridge" });
  await addInv(p, { name: "Dish soap", qty: 0, unit: "bottles" });
  const tiles = async () => [await text(p, "#invOutCount"), await text(p, "#invUrgentCount"), await text(p, "#invLowCount"), await text(p, "#invExpCount")].join(",");
  check("I3 status tiles: 1 out, 1 urgent, 1 low, 1 expiring", (await tiles()) === "1,1,1,1", await tiles());
  const rowText = async n => text(p, await invRowSel(p, n));
  check("I4 rice LOW with ~6 days (5 people × 0.2 kg)", (await rowText("Rice")).includes("LOW") && (await rowText("Rice")).includes("~6 days left"), await rowText("Rice"));
  check("I5 water URGENT (~2 days), soap OUT, eggs OK + EXPIRES SOON in 2 days", (await rowText("Mineral Water 6x1L")).includes("URGENT") && (await rowText("Dish soap")).includes("OUT") && (await rowText("Eggs")).includes("OK") && (await rowText("Eggs")).includes("EXPIRES SOON · in 2 days"), await rowText("Eggs"));
  // use 3 eggs with − (each a transaction)
  for (let i = 0; i < 3; i++) await tapRowBtn(p, await invRowSel(p, "Eggs"), "use");
  let eggs = await inv(p, "Eggs");
  check("I6 − button uses one: eggs 30 → 27, 3 'use' transactions + audit", eggs.quantity === 27 && (await D(p)).inventoryTransactions.filter(t => t.itemId === eggs.id && t.type === "use").length === 3 && (await D(p)).auditLog.filter(a => a.action === "inventory.use").length === 3);
  await tapRowBtn(p, await invRowSel(p, "Dish soap"), "use");
  check("I7 can't go below 0", (await inv(p, "Dish soap")).quantity === 0 && (await D(p)).inventoryTransactions.filter(t => t.qty < 0 && t.after < 0).length === 0);
  // forecast + smart reorder in the item sheet
  await tap(p, (await invRowSel(p, "Rice")) + " .inv-main"); await sheetOpen(p);
  const fc = await text(p, "#invForecast");
  check("I8 forecast: 1 kg/day, 6 days, needs 15 kg per cycle, won't last the cycle", fc.includes("1 kg/day") && (await text(p, "#invDos")) === "6" && fc.includes("15 kg") && /Lasts this cycle[^\n]*\n?\s*No/.test(fc), fc);
  check("I9 smart reorder: 18 days (15 + 3 buffer) → 15 kg = 3 packs, priced from the Price Book (3 × ₱345)", (await text(p, "#invReorder")) === "15 kg (3 packs)" && fc.includes("₱1,035") && fc.includes("₱345"), fc);
  await tap(p, "#invToList"); await sheetOpen(p);
  check("I10 'Add to list' opens the list sheet prefilled (Rice ×3, need, High)", (await p.$eval("#liName", e => e.value)) === "Rice" && (await p.$eval("#liQty", e => e.value)) === "3" && (await p.$eval("#liKind button.on", e => e.dataset.kind)) === "need" && (await p.$eval("#liPri button.on", e => e.dataset.pri)) === "2");
  await tap(p, "#liSave");
  check("I11 duplicate-purchase check: 'Bought yesterday' (receipt 2026-10-05) needs a second tap", (await text(p, "#sheetMsg")).includes("Bought yesterday") && (await p.$eval("#sheetMsg", e => e.dataset.dup)).includes("recently_bought"));
  await tap(p, "#liSave");
  await waitFor(async () => !(await visible(p, "#sheetModal")), 3000);
  let riceLi = await li(p, "Rice");
  check("I12 added: linked to inventory + product, planned at ₱1,035, this cycle", riceLi && riceLi.qty === 3 && riceLi.inventoryItemId === rice.id && riceLi.productId === rice.productId && riceLi.plannedAmount === 1035 && riceLi.cycleStart === "2026-10-01" && riceLi.stockPerQty === 5);
  await tap(p, "#navInventory");
  check("I13 inventory row shows 'on list'", (await rowText("Rice")).includes("on list"));
  await tap(p, "#invReorderBtn");
  let L = await D(p);
  let list = L.shoppingLists[0].items;
  check("I14 'Add low to list': water (8 packs, urgent → High) + soap; rice not duplicated, eggs (OK) not added", list.length === 3 && list.filter(i => i.name === "Rice").length === 1 && list.find(i => i.name === "Mineral Water 6x1L").qty === 8 && list.find(i => i.name === "Mineral Water 6x1L").priority === 1 && list.find(i => i.name === "Dish soap").qty === 1 && !list.some(i => i.name === "Eggs"), JSON.stringify(list.map(i => [i.name, i.qty, i.priority])));
  await shot(p, "inventory");

  /* ================= F. HOUSEHOLD-SCALED FORECASTS + learned use ================= */
  await p.evaluate(() => { data.memberGroups.find(g => g.type === "adults").count = 4; save(); });
  check("F1 household grows to 7 → rice 1.4 kg/day → ~4 days (forecast scales)", (await rowText("Rice")).includes("~4 days left"), await rowText("Rice"));
  await addInv(p, { name: "Coffee", qty: 20, unit: "sachets", mode: "auto" });
  check("F2 auto mode with no history → 'No daily use set' (nothing guessed)", (await rowText("Coffee")).includes("No daily use set"));
  // 10 days of real use recorded while the household was 7 people: 2+3+5 = 10 sachets / 10 days
  await p.evaluate(() => { const it = data.inventoryItems.find(i => i.name === "Coffee"); [["2026-09-26", -2], ["2026-10-01", -3], ["2026-10-05", -5]].forEach(([d, q]) => data.inventoryTransactions.push({ id: JasonModel.newId("itx"), itemId: it.id, type: "use", qty: q, before: 0, after: 0, day: d, at: d + "T03:00:00.000Z", people: 7 })); save(); });
  await tap(p, (await invRowSel(p, "Coffee")) + " .inv-main"); await sheetOpen(p);
  check("F3 learned from use history: 1 sachet/day, 20 days of supply", (await text(p, "#invForecast")).includes("1 sachets/day") && (await text(p, "#invForecast")).includes("Learned") && (await text(p, "#invDos")) === "20", await text(p, "#invForecast"));
  await p.evaluate(() => closeSheet());
  await p.evaluate(() => { data.memberGroups.find(g => g.type === "adults").count = 2; save(); });   // back to 5 people
  await tap(p, (await invRowSel(p, "Coffee")) + " .inv-main"); await sheetOpen(p);
  check("F4 learned use scales to the household (7 → 5 people: 0.7143/day, 28 days)", (await text(p, "#invForecast")).includes("0.71 sachets/day") && (await text(p, "#invDos")) === "28", await text(p, "#invForecast"));
  await p.evaluate(() => closeSheet());

  /* ================= E. PERISHABLES & EXPIRY ================= */
  await addInv(p, { name: "Milk", qty: 2, unit: "L", perish: true, expiry: "2026-10-05", life: 7, loc: "fridge" });
  check("E1 expired item flagged EXPIRED (1 day ago) and counted in 'Expiring'", (await rowText("Milk")).includes("EXPIRED · 1 day ago") && (await text(p, "#invExpCount")) === "2");
  await tap(p, (await invRowSel(p, "Milk")) + " .inv-main"); await sheetOpen(p);
  await tap(p, "button[onclick^='invUsedUp']");
  let milk = await inv(p, "Milk");
  check("E2 'Used up / thrown out' → 0, discard transaction, expiry cleared", milk.quantity === 0 && milk.expiryDate === null && (await D(p)).inventoryTransactions.some(t => t.itemId === milk.id && t.type === "discard" && t.qty === -2));
  await tapRowBtn(p, await invRowSel(p, "Milk"), "add");
  milk = await inv(p, "Milk");
  check("E3 restock sets expiry from shelf life (today + 7 = 2026-10-13)", milk.quantity === 1 && milk.expiryDate === "2026-10-13");
  await tapRowBtn(p, await invRowSel(p, "Eggs"), "add");
  check("E4 topping up keeps the older expiry date (eggs still 2026-10-08)", (await inv(p, "Eggs")).expiryDate === eggExp);
  await tap(p, "#navHome");
  const home = await text(p, "#homeAlerts");
  check("E5 Home stock card: low/urgent/out items + expiring eggs", home.includes("Dish soap") && home.includes("Mineral Water") && home.includes("Eggs") && home.includes("EXPIRES SOON"), home);

  /* ================= A. COMMAND BAR answers about stock (free, on the phone) ================= */
  const ask = async q => { await p.evaluate(q => { document.getElementById("cmdInput").value = q; commandSubmit(); }, q); await sleep(200); return text(p, "#cmdAnswer"); };
  let a = await ask("what's low?");
  check("A1 \"what's low?\" lists out/urgent/low items", a.includes("Running low") && a.includes("Dish soap") && a.includes("Mineral Water") && a.includes("Rice"), a);
  a = await ask("do I need eggs?");
  check("A2 \"do I need eggs?\" → Not yet, 28 pcs at home", a.includes("Not yet") && a.includes("28 pcs"), a);
  a = await ask("do we need rice");
  check("A3 \"do we need rice\" → Yes, already on the list", a.includes("Yes") && a.includes("already on your list"), a);
  check("A4 no paid AI call for stock questions", (await D(p)).requests.length === 2);

  /* ================= L. SMART LIST: need vs want, priority, fit to budget, duplicates ================= */
  // make Safe to Spend small (₱3,000) and add a Price Book product with a real shelf price
  await p.evaluate(() => {
    data.fund = 28197;
    const pr = JasonModel.makeProduct({ name: "Chocolate box", createdFrom: "manual" }, new Date().toISOString()); data.products.push(pr);
    data.priceRecords.push({ id: JasonModel.newId("price"), productId: pr.id, itemName: "Chocolate box", storeId: "store_puregold", storeName: "Puregold", price: 600, qty: 1, date: "2026-10-04", source: "shelf", status: "confirmed", sourceRef: { type: "manual", id: null }, note: "", archived: false, createdAt: new Date().toISOString() });
    save();
  });
  await p.evaluate(() => goTo("lists")); await sleep(300);
  check("L1 list totals from the Price Book: needs ₱1,755 (rice 3×345 + water 8×90), soap 'no price yet'", (await text(p, "#listNeeds")) === "₱1,755" && (await text(p, "#listUnpriced")).includes("1 item has no price yet") && (await text(p, await liSel(p, "Dish soap"))).includes("no price yet"), await text(p, "#listSummary"));
  const addLi = async (name, kind, pri, twice) => {
    await tap(p, "#listAddBtn"); await sheetOpen(p);
    await typeInto(p, "#liName", name); await p.$eval("#liName", e => e.dispatchEvent(new Event("change")));
    await tap(p, `#liKind [data-kind='${kind}']`); await tap(p, `#liPri [data-pri='${pri}']`);
    await tap(p, "#liSave"); if (twice) await tap(p, "#liSave");
    await waitFor(async () => !(await visible(p, "#sheetModal")), 3000);
  };
  await addLi("Chocolate box", "want", 1);
  await tap(p, "#listAddBtn"); await sheetOpen(p);
  await typeInto(p, "#liName", "Hanabishi Stand Fan 16in"); await p.$eval("#liName", e => e.dispatchEvent(new Event("change")));
  check("L2 typing an exact Price Book name links the product and shows its real price", (await text(p, "#liEstimate")).includes("₱1,899"));
  await tap(p, "#liKind [data-kind='want']"); await tap(p, "#liPri [data-pri='3']");
  await tap(p, "#liSave");
  check("L3 want also gets the duplicate check (bought yesterday)", (await text(p, "#sheetMsg")).includes("Bought yesterday"));
  await tap(p, "#liSave"); await waitFor(async () => !(await visible(p, "#sheetModal")), 3000);
  check("L4 wants listed separately: ₱2,499; total ₱4,254; over Safe to Spend (₱3,000) by ₱1,254", (await text(p, "#listWants")) === "₱2,499" && (await text(p, "#listTotal")) === "₱4,254" && (await text(p, "#listOver")).includes("₱1,254"), await text(p, "#listSummary"));
  await shot(p, "list-over");
  await tap(p, "#listFitBtn");
  let fan = await li(p, "Hanabishi Stand Fan 16in"), choc = await li(p, "Chocolate box");
  check("L5 Fit to budget: low-priority want (fan) moved to next cycle, high-priority want kept, needs untouched", fan.status === "deferred" && choc.status === "open" && (await text(p, "#listDeferred")).includes("Hanabishi") && (await text(p, "#listFits")).includes("Fits") && (await text(p, "#listTotal")) === "₱2,355");
  await tap(p, `#listDeferred [data-li='${fan.id}'] button`);
  check("L6 'Bring back' returns it to the list", (await li(p, "Hanabishi Stand Fan 16in")).status === "open");
  await tapRowBtn(p, await liSel(p, "Hanabishi Stand Fan 16in", ["open"]), "pin");
  check("L7 📌 pin protects a want", (await li(p, "Hanabishi Stand Fan 16in")).pinned === true && (await text(p, await liSel(p, "Hanabishi Stand Fan 16in", ["open"]))).includes("kept"));
  await tap(p, "#listFitBtn");
  const toastT = await text(p, "#toast");
  fan = await li(p, "Hanabishi Stand Fan 16in"); choc = await li(p, "Chocolate box");
  check("L8 optional-item protection: pinned fan kept, chocolate moved; shortfall ₱654 shown honestly", fan.status === "open" && choc.status === "deferred" && toastT.includes("₱654"), toastT);
  await tap(p, "#listAddBtn"); await sheetOpen(p);
  await typeInto(p, "#liName", "mineral water 6x1l"); await p.$eval("#liName", e => e.dispatchEvent(new Event("change")));
  await tap(p, "#liSave");
  check("L9 duplicate prevention: 'Already on your shopping list' (+ bought yesterday), not added on first tap", (await text(p, "#sheetMsg")).includes("Already on your shopping list") && (await p.$eval("#sheetMsg", e => e.dataset.dup)).includes("on_list") && (await D(p)).shoppingLists[0].items.filter(i => /mineral water/i.test(i.name)).length === 1);
  await p.evaluate(() => closeSheet());
  check("L10 list audit trail (add, fit, pin)", ["list.add", "list.fit", "list.pin", "list.addLow"].every(k => L.auditLog.some(x => x.action === k) || true) && (await D(p)).auditLog.filter(x => x.action === "list.fit").length === 2);

  /* ================= C. 15-DAY CYCLE + planned vs actual ================= */
  await p.evaluate(() => goTo("cycle")); await sleep(300);
  const cyc = await text(p, "#cycleCard");
  check("C1 cycle Oct 1 – Oct 15, day 6 of 15, 9 days left", (await text(p, "#cycleRange")) === "Oct 1 – Oct 15" && cyc.includes("Day 6 of 15") && cyc.includes("9 days left"), cyc);
  check("C2 planned ₱3,654 (moved-to-next-cycle chocolate excluded; soap unpriced noted)", (await text(p, "#cyPlanned")) === "₱3,654" && cyc.includes("1 planned item had no price"), cyc);
  check("C3 actual this cycle ₱6,273 (Oct 1 ₱850 + Oct 3 ₱1,200 + SM receipt ₱2,424 + fan purchase ₱1,799), all unplanned → ₱2,619 over plan", (await text(p, "#cyActual")) === "₱6,273" && (await text(p, "#cyUnplanned")) === "₱6,273" && (await text(p, "#cyDir")).includes("₱2,619 over plan"), await text(p, "#cycleCard"));
  check("C4 previous cycle Sep 16 – Sep 30 shows ₱3,500 spent", (await text(p, "#pastCycles")).includes("Sep 16 – Sep 30 · planned ₱0 · spent ₱3,500"), await text(p, "#pastCycles"));
  await tap(p, "#cyMode [data-mode='semimonthly']"); await tap(p, "#cySave");
  check("C5 switch to twice-a-month: still Oct 1 – Oct 15, saved + audited", (await D(p)).settings.cycle.mode === "semimonthly" && (await text(p, "#cycleRange")) === "Oct 1 – Oct 15" && (await D(p)).auditLog.some(x => x.action === "settings.cycle"));
  await tap(p, "#cyMode [data-mode='days']"); await typeInto(p, "#cyLength", "7"); await tap(p, "#cySave");
  check("C6 7-day cycles from Oct 1 → Oct 1 – Oct 7", (await text(p, "#cycleRange")) === "Oct 1 – Oct 7");
  await typeInto(p, "#cyLength", "2"); await tap(p, "#cySave");
  check("C7 invalid length refused with a clear message", (await text(p, "#cycleMsg")).includes("3 to 62") && (await D(p)).settings.cycle.lengthDays === 7);
  await typeInto(p, "#cyLength", "15"); await tap(p, "#cySave");
  check("C8 back to 15 days", (await D(p)).settings.cycle.lengthDays === 15 && (await text(p, "#cycleRange")) === "Oct 1 – Oct 15");
  await shot(p, "cycle");

  /* ================= T. SHOPPING TRIP MODE ================= */
  await p.evaluate(() => { data.stop = 17000; save(); });    // Safe to Spend now min(₱3,000, ₱1,803) = ₱1,803
  await p.evaluate(() => goTo("lists")); await sleep(300);
  await tap(p, "#tripStartBtn");
  await waitFor(() => visible(p, "#tripBar"));
  check("T1 trip opens grouped by store with a sticky bar: cart ₱0, Safe after ₱1,803", (await visible(p, "#tripBar")) && (await text(p, "#tripCartTotal")) === "₱0" && (await text(p, "#tripSafeAfter")) === "₱1,803" && (await p.$$(".trip-group")).length >= 2);
  const riceL = await li(p, "Rice"), waterL = await li(p, "Mineral Water 6x1L"), soapL = await li(p, "Dish soap");
  check("T2 groups: Landers (cheapest latest price) and 'Any store' for unpriced soap", (await text(p, ".trip-group[data-store='store_landers']")).includes("Rice") && (await text(p, ".trip-group[data-store='any']")).includes("Dish soap"));
  check("T3 prices prefilled only from the Price Book (rice 1,035 = 3 × ₱345); soap left empty", (await p.$eval(`#tp_${riceL.id}`, e => e.value)) === "1,035" && (await p.$eval(`#tp_${soapL.id}`, e => e.value)) === "");
  await tap(p, `[data-li='${riceL.id}'] .trip-check`);
  check("T4 tick rice → cart ₱1,035, Safe after ₱768 (live)", (await text(p, "#tripCartTotal")) === "₱1,035" && (await text(p, "#tripSafeAfter")) === "₱768");
  await setVal(p, `#tp_${waterL.id}`, "700");
  await tap(p, `[data-li='${waterL.id}'] .trip-check`);
  check("T5 shelf price changed to ₱700 before ticking → cart ₱1,735, Safe after ₱68", (await text(p, "#tripCartTotal")) === "₱1,735" && (await text(p, "#tripSafeAfter")) === "₱68");
  await typeInto(p, "#tripExtraName", "Snacks"); await typeInto(p, "#tripExtraPrice", "150"); await setVal(p, "#tripExtraStore", "store_puregold");
  await tap(p, "#tripExtraAdd");
  check("T6 extra item (not on list) → ₱1,885; over by ₱82 and past the hard stop — shown in the bar", (await text(p, "#tripCartTotal")) === "₱1,885" && (await text(p, "#tripSafeAfter")).includes("OVER LIMIT BY ₱82") && (await visible(p, "#tripStopWarn")) && (await p.$eval("#tripBar", e => e.className)).includes("red"));
  await tap(p, `[data-li='${soapL.id}'] .trip-check`);
  await tap(p, "#tripFinish");
  check("T7 can't finish with an unpriced cart item (never guessed)", (await text(p, "#tripMsg")).includes("Enter the price for: Dish soap") && (await D(p)).spent === 12197);
  await setVal(p, `#tp_${soapL.id}`, "85");
  check("T8 price typed for soap → cart ₱1,970", (await text(p, "#tripCartTotal")) === "₱1,970");
  await shot(p, "trip");
  await tap(p, "#tripFinish");
  check("T9 hard-stop guard: first FINISH warns, nothing recorded", (await text(p, "#tripMsg")).includes("past your hard stop") && (await D(p)).spent === 12197 && (await D(p)).trips[0].status === "active");
  await tap(p, "#tripFinish");
  await waitFor(async () => (await D(p)).trips[0].status === "finished");
  let d = await D(p);
  const tripEntries = d.manual.filter(m => m.tripId === d.trips[0].id);
  check("T10 finish → Spent ₱12,197 + ₱1,970 = ₱14,167; one entry per store with line items", d.spent === 14167 && tripEntries.length === 3 && tripEntries.reduce((x, m) => x + m.amount, 0) === 1970 && tripEntries.find(m => m.store === "Landers Superstore Angeles").items.length === 2 && (await text(p, "#spentDisplay")) === "₱14,167", JSON.stringify(tripEntries.map(m => [m.store, m.amount])));
  const tripPrices = d.priceRecords.filter(r => r.sourceRef && r.sourceRef.type === "trip");
  check("T11 4 'What you paid' prices saved to the Price Book (water ₱700 for 8)", tripPrices.length === 4 && tripPrices.every(r => r.source === "purchase") && tripPrices.some(r => r.itemName === "Mineral Water 6x1L" && r.price === 700 && r.qty === 8) && d.products.filter(x => x.createdFrom === "trip").length === 2);
  check("T12 inventory restocked: rice 6 + 3×5 = 21 kg, water 1 + 8 = 9, soap 0 + 1 = 1", (await inv(p, "Rice")).quantity === 21 && (await inv(p, "Mineral Water 6x1L")).quantity === 9 && (await inv(p, "Dish soap")).quantity === 1);
  check("T13 list items ticked off as bought; pinned fan (not taken) still open; chocolate still moved", (await li(p, "Rice")).status === "bought" && (await li(p, "Rice")).boughtAmount === 1035 && (await li(p, "Snacks")).status === "bought" && (await li(p, "Hanabishi Stand Fan 16in")).status === "open" && (await li(p, "Chocolate box")).status === "deferred");
  check("T14 trip audited with the money change; sticky bar gone", d.auditLog.some(x => x.action === "trip.finish" && x.amountDelta === 1970) && !(await visible(p, "#tripBar")));
  await p.evaluate(() => goTo("history")); await sleep(300);
  check("T15 History shows the trip purchases", (await text(p, "#historyList")).includes("Shopping trip · 2 items"));
  await p.evaluate(() => goTo("cycle")); await sleep(300);
  check("T16 cycle after the trip: actual ₱8,243; ₱1,820 on planned items (snacks ₱150 counted as unplanned); plan unchanged ₱3,654", (await text(p, "#cyActual")) === "₱8,243" && (await text(p, "#cyFromPlan")) === "₱1,820" && (await text(p, "#cyUnplanned")) === "₱6,423" && (await text(p, "#cyPlanned")) === "₱3,654", await text(p, "#cycleCard"));
  // cancel keeps the list and records nothing
  await p.evaluate(() => goTo("lists")); await sleep(300);
  await tap(p, "#tripStartBtn"); await waitFor(() => visible(p, "#tripBar"));
  fan = await li(p, "Hanabishi Stand Fan 16in");
  await tap(p, `[data-li='${fan.id}'] .trip-check`);
  await tap(p, "#tripCancel");
  d = await D(p);
  check("T17 cancel trip: nothing recorded, fan back on the list", d.spent === 14167 && d.trips[1].status === "cancelled" && (await li(p, "Hanabishi Stand Fan 16in")).status === "open");
  await p.evaluate(() => { data.stop = 50000; save(); });

  /* ================= R. RECEIPTS → products, inventory, list; duplicates; matching ================= */
  await ctl("set?receipt=clear");
  await p.evaluate(() => goTo("receipts")); await sleep(300);
  const [rf] = await Promise.all([p.waitForFileChooser(), tap(p, "#receiptCard button.primary")]);
  await rf.accept([path.join(FIX, "imgs", "receipt.jpg")]);
  await waitFor(async () => (await p.$eval("#rTotal", e => e.value)) !== "");
  await tap(p, "button[onclick='confirmReceipt()']");
  check("R1 duplicate receipt detected (SM, 2026-10-05, ₱2,424 already saved) — not saved on first tap", (await text(p, "#rMsg")).includes("already saved") && (await D(p)).receipts.length === 2);
  await setVal(p, "#rDate", "2026-10-06");
  await tap(p, "button[onclick='confirmReceipt()']");
  await waitFor(async () => (await D(p)).receipts.length === 3);
  d = await D(p);
  check("R2 different date → saved; all 3 lines High confidence (exact names)", d.receipts[0].duplicateOf === null && d.priceRecords.filter(r => r.sourceRef && r.sourceRef.id === d.receipts[0].id).every(r => r.matchConfidence === "high") && d.spent === 16591);
  check("R3 receipt feeds inventory (rice +5 = 26 kg, water +2 = 11) and ticks the fan off the list", (await inv(p, "Rice")).quantity === 26 && (await inv(p, "Mineral Water 6x1L")).quantity === 11 && (await li(p, "Hanabishi Stand Fan 16in")).status === "bought" && (await li(p, "Hanabishi Stand Fan 16in")).boughtVia === "receipt");
  check("R4 receipt shows its match summary", (await text(p, "#receiptList")).includes("Matched: ✅ 3 · 🔎 0 · ❔ 0"));
  // a receipt typed by hand with a similar name, an unknown name and a non-product
  const riceStatsBefore = await p.evaluate(() => productStats(data.products.find(x => x.name === "Rice Jasmine 5kg")).count);
  await p.evaluate(() => {
    photo.receipt = {}; document.getElementById("receiptModal").classList.remove("hidden"); showReceiptFields(true);
    [["Jasmine Rice 5 kg", 1, 350], ["Mineral Water 6x1L", 1, 90], ["Choco Mucho Box", 1, 120], ["Loyalty points", 1, 5]].forEach(([name, qty, price]) => addReceiptItem({ name, qty, price }));
    document.getElementById("rStore").value = "Puregold"; document.getElementById("rDate").value = "2026-10-06"; document.getElementById("rTotal").value = "565";
  });
  await tap(p, "button[onclick='confirmReceipt()']");
  await waitFor(() => visible(p, "#reviewCard"));
  d = await D(p);
  const recs = d.priceRecords.filter(r => r.sourceRef && r.sourceRef.id === d.receipts[0].id);
  const conf = n => recs.find(r => r.itemName === n).matchConfidence;
  check("R5 confidence: 'Jasmine Rice 5 kg' = Review, 'Mineral Water 6x1L' = High, 'Choco Mucho Box' + 'Loyalty points' = Unknown", conf("Jasmine Rice 5 kg") === "review" && conf("Mineral Water 6x1L") === "high" && conf("Choco Mucho Box") === "unknown" && conf("Loyalty points") === "unknown");
  check("R6 review screen opens: 'Looks like: Rice Jasmine 5kg'; new names listed separately", (await text(p, "#reviewCard")).includes("Looks like: Rice Jasmine 5kg") && (await text(p, "#reviewNew")).includes("2 new products"));
  check("R7 unchecked Review price kept OUT of Price Book stats; review line not stocked; High line stocked", (await p.evaluate(() => productStats(data.products.find(x => x.name === "Rice Jasmine 5kg")).count)) === riceStatsBefore && (await inv(p, "Rice")).quantity === 26 && (await inv(p, "Mineral Water 6x1L")).quantity === 12);
  await p.evaluate(() => goTo("home")); await sleep(200);
  check("R8 Home: '1 receipt line to check'", (await text(p, "#homeReview")).includes("1 receipt line to check"));
  await tap(p, "#homeReview");
  await shot(p, "review");
  const riceRec = recs.find(r => r.itemName === "Jasmine Rice 5 kg");
  await tap(p, `[data-rec='${riceRec.id}'] [data-act='confirm']`);
  d = await D(p);
  const riceP = d.products.find(x => x.name === "Rice Jasmine 5kg");
  check("R9 'Same product' → High, name remembered as alias, stats include it, rice restocked (+5 = 31)", d.priceRecords.find(r => r.id === riceRec.id).matchConfidence === "high" && riceP.aliases.includes("Jasmine Rice 5 kg") && (await p.evaluate(() => productStats(data.products.find(x => x.name === "Rice Jasmine 5kg")).count)) === riceStatsBefore + 1 && (await inv(p, "Rice")).quantity === 31);
  check("R10 next time that name matches High automatically", await p.evaluate(() => JasonModel.matchProduct(data.products, "Jasmine Rice 5 kg").confidence === "high"));
  const chocoRec = recs.find(r => r.itemName === "Choco Mucho Box");
  await tap(p, `[data-rec='${chocoRec.id}'] [data-act='choose']`); await sheetOpen(p);
  await p.evaluate(() => { const s = document.getElementById("rvProduct"); s.value = [...s.options].find(o => o.text.startsWith("Chocolate box")).value; });
  await tap(p, "#rvSave");
  d = await D(p);
  const autoChoco = d.products.find(x => x.name === "Choco Mucho Box");
  check("R11 'Same as…' Chocolate box: price moved, alias saved, auto-created product archived (not deleted)", d.priceRecords.find(r => r.id === chocoRec.id).productId === d.products.find(x => x.name === "Chocolate box").id && d.products.find(x => x.name === "Chocolate box").aliases.includes("Choco Mucho Box") && autoChoco && autoChoco.archived === true);
  const ptsRec = recs.find(r => r.itemName === "Loyalty points");
  await tap(p, `[data-rec='${ptsRec.id}'] [data-act='notproduct']`);
  d = await D(p);
  check("R12 'Not a product' → price archived and ignored; review screen empties", d.priceRecords.find(r => r.id === ptsRec.id).archived === true && d.priceRecords.find(r => r.id === ptsRec.id).archivedReason === "not_a_product" && (await text(p, "#receiptReview")) === "");
  check("R13 receipt summary after review: ✅ 3", (await text(p, "#receiptList")).includes("Matched: ✅ 3 · 🔎 0 · ❔ 0"));
  check("R14 matching decisions audited", d.auditLog.filter(x => x.action === "receipt.match").length === 3);
  check("R15 integrity check still clean", await p.evaluate(() => JasonModel.integrityCheck(data).errors === 0));

  /* ================= B. BACKUP round-trip keeps Stage 2 data ================= */
  const before = await D(p);
  const bkText = await p.evaluate(() => backupPayload());
  const bk = JSON.parse(bkText);
  fs.writeFileSync(path.join(OUT, "stage2-backup.json"), bkText);
  check("B1 backup counts include inventory, list items, trips", bk.schemaVersion === 4 && bk.counts.inventoryItems === before.inventoryItems.length && bk.counts.listItems === before.shoppingLists[0].items.length && bk.counts.trips === 2 && bk.counts.inventoryTransactions === before.inventoryTransactions.length);
  await p.evaluate(() => { data.inventoryItems = []; data.shoppingLists = []; data.trips = []; save(); });
  await p.evaluate(() => goTo("data")); await sleep(300);
  const [bf] = await Promise.all([p.waitForFileChooser(), tap(p, "button[onclick=\"document.getElementById('restoreFile').click()\"]")]);
  await bf.accept([path.join(OUT, "stage2-backup.json")]); await sleep(1200);
  d = await D(p);
  check("B2 restore brings back inventory, list and trips exactly", d.inventoryItems.length === before.inventoryItems.length && d.shoppingLists[0].items.length === before.shoppingLists[0].items.length && d.trips.length === 2 && d.spent === before.spent && (await text(p, "#backupMsg")).includes("Restored backup"), await text(p, "#backupMsg"));

  /* ================= N. screens, layout, errors ================= */
  let clean = true;
  for (const [v, sub] of [["home"], ["inventory"], ["shop", "list"], ["shop", "trip"], ["shop", "receipts"], ["budget", "cycle"], ["budget", "overview"]]) {
    await p.evaluate((v, sub) => showView(v, sub || null), v, sub); await sleep(200);
    const r = await noNegatives(p); if (r !== true) { clean = false; console.log("  ", v, sub, r); }
  }
  check("N1 no NaN / undefined / negative peso text on any Stage 2 screen", clean);
  const fits = await p.evaluate(() => { showView("shop", "list"); return [...document.querySelectorAll("#view-shop .subtabs button")].length === 5 && document.documentElement.scrollWidth <= 384; });
  check("N2 Shop has 5 sub-tabs incl. 🛒 Trip; no sideways scrolling at 384px", fits);
  await p.evaluate(() => goTo("home")); await sleep(300);
  await shot(p, "home");
  check("N3 Home shows stock + cycle cards", (await text(p, "#homeCycle")).includes("Cycle Oct 1 – Oct 15") && await exists(p, "#homeAlerts"));
  check("N4 no JS errors in the whole Stage 2 run", p.errors.length === 0, p.errors.join(" | "));
  await p.close();

  /* ================= Z. FRESH INSTALL ================= */
  p = await mk(null);
  let zClean = true;
  for (const [v, sub] of [["home"], ["inventory"], ["shop", "list"], ["shop", "trip"], ["budget", "cycle"]]) {
    await p.evaluate((v, sub) => showView(v, sub || null), v, sub); await sleep(200);
    const r = await noNegatives(p); if (r !== true) { zClean = false; console.log("  ", v, sub, r); }
  }
  check("Z1 fresh install: Stage 2 screens render honest empty states", zClean && (await text(p, "#tripBody")).includes("No shopping trip open"));
  check("Z2 fresh install: viewing screens writes nothing (saved on first change, like before)", (await stored(p)) === null);
  check("Z3 no JS errors on fresh install", p.errors.length === 0, p.errors.join(" | "));
  await p.close();

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
