/*
  Stage 3 end-to-end tests — headless mobile Chrome (384×854, touch), AI mocked (mock5:
  research replies carry OFFER lines and web citations). Starts from a REAL Stage 2
  (schema v3) snapshot (tests/fixtures/stage2-snapshot.json, made by driving the Stage 2
  production app). Page clock pinned to 2026-10-06 13:00 Asia/Manila.
  Run with: bash tests/run-browser-tests.sh stage3   (or: all)
*/
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const fs = require("fs");
const revealShim = require("../legacy/reveal-shim");
const FIX = path.join(__dirname, "..", "fixtures");
const OUT = process.env.TEST_OUT || path.join(os.tmpdir(), "jason-shop-tests");
const DL = path.join(OUT, "dl-stage3");
fs.mkdirSync(DL, { recursive: true });
const URL = "http://localhost:8080/index.html";
const SNAP = JSON.parse(fs.readFileSync(path.join(FIX, "stage2-snapshot.json"), "utf8"));
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
  const shot = (p, name) => p.screenshot({ path: path.join(OUT, "stage3-" + name + ".png") });
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
  const cmd = async (p, t) => { await p.evaluate(() => goTo("home")); await sleep(150); await typeInto(p, "#cmdInput", t); await tap(p, ".cmd-send"); await sleep(250); return text(p, "#cmdAnswer"); };
  const lastCard = p => p.evaluate(() => { const c = [...document.querySelectorAll("#cmdAnswer .ai-preview")].pop(); return c ? { id: c.id, intent: c.dataset.intent, state: c.dataset.state, text: c.innerText, acts: [...c.querySelectorAll(".ap-actions button:not([disabled])")].map(b => b.dataset.act) } : null; });
  const cardAct = async (p, act) => { const c = await lastCard(p); await tap(p, `#${c.id} [data-act='${act}']`); await sleep(250); };
  const pid = (p, n) => p.evaluate(n => (data.products.find(x => x.name === n && !x.archived) || {}).id, n);
  const openProd = async (p, n) => { await p.evaluate(id => openProduct(id), await pid(p, n)); await sheetOpen(p); await sleep(200); };
  const closeSh = async p => { await p.evaluate(() => closeSheet()); await sleep(150); };
  const money0 = v => "₱" + Number(v).toLocaleString("en-PH", { maximumFractionDigits: 2 });
  const listQty = async (p, n) => ((await li(p, n)) || {}).qty;

  /* ================= U. UPGRADE v3 → v4 from a real Stage 2 snapshot ================= */
  const v3 = SNAP.data;
  const v3items = v3.shoppingLists.find(l => l.status === "active").items;
  let p = await mk(JSON.stringify(v3));
  await waitFor(async () => (await text(p, "#bootBanner")).includes("upgraded"));
  const banner = await text(p, "#bootBanner");
  check("U1 upgrade banner: data kept + Stage 3 features named", banner.includes("2 receipts") && banner.includes("₱12,197") && banner.includes("trip planner") && banner.includes("Taglish"), banner);
  await waitFor(async () => ((await stored(p)) || {}).schemaVersion === 4);
  let s = await stored(p);
  const items0 = s.shoppingLists.find(l => l.status === "active").items;
  check("U2 saved data is v4 and every Stage 2 record is kept", s.schemaVersion === 4 && s.products.length === v3.products.length && s.priceRecords.length === v3.priceRecords.length && s.inventoryItems.length === 4 && items0.length === v3items.length && s.inventoryTransactions.length === v3.inventoryTransactions.length && s.receipts.length === 2 && s.manual.length === 3 && s.spent === 12197 && s.commitments.length === 1 && s.trips.length === v3.trips.length);
  check("U3 new fields added without touching old ones: store travel = unknown, recurring/alerts lists, learning, settings", s.stores.every(x => x.travel && x.travel.minutes === null && x.travel.km === null) && Array.isArray(s.recurring) && Array.isArray(s.alerts) && s.learning && s.learning.alertScanAt && s.settings.route.mode === "balance" && s.settings.fund.expensiveAt === 5000 && s.products.every(x => Array.isArray(x.substitutes)));
  const snaps = await p.evaluate(() => JasonStore.listSnapshots());
  check("U4 safety copy of the v3 data saved first (IndexedDB)", snaps.length === 1 && snaps[0].reason === "before upgrade v3 → v4" && snaps[0].counts.priceRecords === v3.priceRecords.length && snaps[0].counts.inventoryItems === 4);
  check("U5 integrity check clean after upgrade", await p.evaluate(() => JasonModel.integrityCheck(data).errors === 0));
  check("U6 old prices recorded before the upgrade don't fire price-drop alerts", (await D(p)).alerts.filter(a => a.kind === "price_drop").length === 0);
  await tap(p, "#bootBanner button");

  /* ================= W. WHERE SHOULD I BUY THIS? ================= */
  await openProd(p, "Eggs tray");
  let where = await text(p, "#piWhere");
  const whereRows = await p.$$eval("#piWhere tr", rs => rs.map(r => r.innerText));
  check("W1 store ranking per piece, cheapest first: Pampang ₱7.5 → Puregold ₱8 → SM ₱9", whereRows[1].includes("Pampang") && whereRows[1].includes("₱7.5/piece") && whereRows[2].includes("Puregold") && whereRows[3].includes("SM"), whereRows.join(" | "));
  check("W2 every price shows freshness + a source label", where.includes("5 days ago") && where.includes("USER ENTERED"), where);
  check("W3 WHY explains the pick with real numbers", where.includes("WHY") && where.includes("lowest latest price") && where.includes("16.67% less than SM"), where);
  await closeSh(p);
  await openProd(p, "Rice Jasmine 5kg");
  where = await text(p, "#piWhere");
  check("W4 receipt prices are labelled RECEIPT VERIFIED; a tie is said honestly", where.includes("RECEIPT VERIFIED") && where.includes("2 stores share the lowest price"), where);
  check("W5 price records table shows the status label column", (await text(p, "#sheetBody .tbl")).includes("RECEIPT VERIFIED"));

  /* ================= A. BUY NOW / WAIT + TARGET ================= */
  let adv = await text(p, "#piAdvice");
  check("A1 rice: BUY NOW — ₱345 is the lowest of 5 recorded prices", adv.includes("BUY NOW") && adv.includes("5 recorded prices") && adv.includes("low ₱345"), adv);

  /* ================= P. PACK SIZE + BULK ================= */
  const pack = await text(p, "#piPack");
  check("P1 pack-size value per kg: 25 kg sack ₱62/kg best, 5 kg costs 11.29% more", pack.includes("₱62/kg") && pack.includes("11.29%"), pack);
  const bulk = await text(p, "#piBulk");
  check("P2 bulk break-even with storage risk and a WHY", /BUY THE BIG PACK|BULK/.test(bulk) && bulk.includes("Storage") && bulk.includes("Break-even"), bulk);

  /* ================= S. SUBSTITUTES ================= */
  let subs = await text(p, "#piSubs");
  check("S1 substitute suggested from the Price Book: Rice Dinorado 5kg, 4% cheaper per kg (₱330 at Puregold)", subs.includes("Rice Dinorado 5kg") && subs.includes("₱330 at Puregold") && subs.includes("4% cheaper per kg"), subs);
  await tap(p, `#piSubs [data-act='sub-no'][onclick*='${await pid(p, "Rice Dinorado 5kg")}']`);
  let d = await D(p);
  const riceP = d.products.find(x => x.name === "Rice Jasmine 5kg");
  check("S2 'Not for me' is remembered (learning from corrections)", riceP.rejectedSubstitutes.includes(d.products.find(x => x.name === "Rice Dinorado 5kg").id) && !(await text(p, "#piSubs")).includes("Dinorado"));
  await closeSh(p);

  await openProd(p, "Eggs tray");
  adv = await text(p, "#piAdvice");
  check("A2 eggs: WAIT — latest ₱270 is above your average; target suggested from history (₱225)", adv.includes("WAIT") && adv.includes("above your average") && adv.includes("₱225"), adv);
  await typeInto(p, "#piTarget", "230"); await tap(p, "#piTargetSave");
  d = await D(p);
  check("A3 target price saved + audited", d.products.find(x => x.name === "Eggs tray").targetPrice === 230 && d.auditLog.some(a => a.action === "product.target"));
  await closeSh(p);
  check("A4 a product with 1 price says 'not enough data' instead of guessing", await p.evaluate(() => { openProduct(data.products.find(x => x.name === "Rice Jasmine 25kg sack").id); const t = document.getElementById("piAdvice").innerText; closeSheet(); return /not enough data/i.test(t); }));

  /* ================= AL. PRICE-DROP + TARGET ALERTS ================= */
  const bell0 = await p.evaluate(() => activeAlerts().filter(a => !a.seen).length);
  await p.evaluate(() => goTo("prices")); await sleep(200);
  await p.evaluate(() => openPrice(null)); await sheetOpen(p);
  await setVal(p, "#prProduct", await pid(p, "Eggs tray")); await typeInto(p, "#prPrice", "220"); await setVal(p, "#prStore", "store_puregold"); await setVal(p, "#prSource", "shelf");
  await tap(p, "#sheetBody button.primary"); await sleep(400); await closeSh(p);
  d = await D(p);
  const drop = d.alerts.find(a => a.kind === "price_drop");
  check("AL1 new lower price → price-drop alert compares with the previous Puregold price (₱240 → ₱220, 8%)", drop && drop.title.includes("Eggs tray is 8% cheaper") && drop.text.includes("₱220") && drop.text.includes("₱240"), drop && drop.title);
  check("AL2 target ₱230 reached → target alert", d.alerts.some(a => a.kind === "target_hit" && a.text.includes("₱220")));
  check("AL3 bell shows the unseen count", (await text(p, "#bellCount")) === String(await p.evaluate(() => activeAlerts().filter(a => !a.seen).length)) && (await p.evaluate(() => activeAlerts().filter(a => !a.seen).length)) >= bell0 + 2);
  await tap(p, "#bellBtn"); await sheetOpen(p);
  const alertsText = await text(p, "#alertList");
  check("AL4 alert center lists price drop, target and low stock (each once)", alertsText.includes("8% cheaper") && alertsText.includes("reached your target") && (alertsText.match(/Eggs — urgent/g) || []).length === 1 && (alertsText.match(/Dish soap — out/g) || []).length === 1, alertsText);
  check("AL5 opening the center marks alerts seen (bell clears)", await waitFor(async () => (await p.$eval("#bellCount", e => e.classList.contains("hidden")))));
  await shot(p, "alerts");
  const nAl = await p.evaluate(() => activeAlerts().length);
  await tap(p, "#alertList [data-act='dismiss']");
  check("AL6 dismiss one", (await p.evaluate(() => activeAlerts().length)) === nAl - 1 && (await D(p)).alerts.length >= nAl);
  await closeSh(p);

  /* ================= R. ROUTE PLANNER ================= */
  // store travel settings (user-entered; live maps are not connected)
  const setTravel = async (id, min, km) => { await p.evaluate(id => openStoreEdit(id), id); await sheetOpen(p); await typeInto(p, "#stMinutes", min); await typeInto(p, "#stKm", km); await tap(p, "#sheetBody button.primary"); await sleep(250); };
  await p.evaluate(() => openStoreEdit("store_sm_supermarket_ax0u")); await sheetOpen(p);
  await typeInto(p, "#stMinutes", "-3"); await tap(p, "#sheetBody button.primary");
  check("R1 store travel validated (no negative minutes)", (await text(p, "#sheetMsg")).includes("0 or more") && (await D(p)).stores.find(x => x.id === "store_sm_supermarket_ax0u").travel.minutes === null);
  await closeSh(p);
  await setTravel("store_sm_supermarket_ax0u", "15", "6");
  await setTravel("store_puregold", "10", "4");
  await setTravel("store_pampang", "25", "9");
  d = await D(p);
  check("R2 travel saved on stores", d.stores.find(x => x.id === "store_puregold").travel.minutes === 10 && d.stores.find(x => x.id === "store_pampang").travel.km === 9);
  await p.evaluate(() => goTo("lists")); await sleep(300);
  await tap(p, "#listPlanBtn"); await sheetOpen(p); await sleep(200);
  check("R3 planner opens in BEST BALANCE; live distance honestly 'NEEDS CONFIGURATION'", (await p.$eval("#rtMode button.on", e => e.dataset.mode)) === "balance" && (await text(p, "#rtLive")).includes("NEEDS CONFIGURATION"));
  const planCalc = await p.evaluate(() => { const pi = planInputs(); const items = pi.rows.map(r => ({ id: r.li.id, prices: r.prices, lock: r.lock })); const out = {}; ["balance", "cheapest", "fewest", "fastest"].forEach(m => { const r = C.planRoute(items, pi.stores, routeSettings(), m); out[m] = { stores: r.best.stores, total: r.best.itemsTotal, minutes: r.best.minutes }; }); return out; });
  // list: Rice ×1 (SM/Landers ₱345, PG ₱360) · Eggs (PG ₱220 new, Pampang ₱225, SM ₱270) · Oil ×2 (PG ₱178, SM ₱190) · Soap (SM ₱45, PG ₱49) · cake (no price)
  check("R4 cheapest = ₱788 (Puregold + SM); fewest = 1 stop (Puregold ₱807); fastest = Puregold (10 min away)", planCalc.cheapest.total === 788 && planCalc.cheapest.stores.slice().sort().join() === "store_puregold,store_sm_supermarket_ax0u" && planCalc.fewest.stores.join() === "store_puregold" && planCalc.fewest.total === 807 && planCalc.fastest.stores.join() === "store_puregold", JSON.stringify(planCalc));
  check("R5 balance trades price against time: no costlier than fewest, no slower than cheapest, and never relies on a store with unknown travel (Landers)", planCalc.balance.total <= planCalc.fewest.total && planCalc.balance.minutes !== null && planCalc.balance.minutes <= planCalc.cheapest.minutes && !planCalc.balance.stores.includes("store_landers"), JSON.stringify(planCalc.balance));
  const rtShown = await text(p, "#rtTotal");
  check("R6 screen shows the balance plan total + time from the stores' minutes", rtShown.includes(Number(planCalc.balance.total).toLocaleString("en-PH")) && /min/.test(await text(p, "#rtTime")), rtShown);
  check("R7 WHY compares with the cheapest and one-stop options", (await text(p, "#rtWhy")).includes("WHY") && /cheapest plan|One-stop|one stop/i.test(await text(p, "#rtWhy")), await text(p, "#rtWhy"));
  await tap(p, "#rtMode [data-mode='cheapest']");
  check("R8 switching to CHEAPEST shows ₱788 and 2 stops", (await text(p, "#rtTotal")).includes("₱788") && (await p.$$eval("#rtBest .stop", e => e.length)) === 2);
  await tap(p, "#rtMode [data-mode='fewest']");
  check("R9 FEWEST STOPS shows one stop", (await p.$$eval("#rtBest .stop", e => e.length)) === 1);
  await shot(p, "planner");
  await tap(p, "#rtMode [data-mode='balance']");
  await tap(p, "#rtEdit");
  const eggsLi = await li(p, "Eggs");
  await setVal(p, `#rtl_${eggsLi.id}`, "store_sm_supermarket_ax0u"); await sleep(250);
  check("R10 manual override: Eggs locked to SM is honoured", await p.evaluate(id => planState.locks[id] === "store_sm_supermarket_ax0u" && computePlan().res.best.assign[id].storeKey === "store_sm_supermarket_ax0u", eggsLi.id));
  await typeInto(p, "#rsShop", "15"); await tap(p, "#rsSave");
  check("R11 route settings editable (shopping 15 min/stop)", (await D(p)).settings.route.shoppingMinutes === 15);
  await tap(p, "#rtApprove"); await sleep(400);
  d = await D(p);
  const items1 = d.shoppingLists.find(l => l.status === "active").items.filter(i => i.status === "open");
  check("R12 Approve assigns each item a store, starts the trip, learns the override + mode", items1.filter(i => i.plannedAmount > 0).every(i => i.storeId) && items1.find(i => i.id === eggsLi.id).storeId === "store_sm_supermarket_ax0u" && d.trips.some(t => t.status === "active") && d.learning.routeModeCounts.balance === 1 && Object.keys(d.learning.storePrefs).length >= 1);
  await closeSh(p);
  // finish the trip state so later list commands see an open list (cancel trip keeps items)
  await p.evaluate(() => cancelTrip());   // dialog auto-accepted; items go back on the list
  await sleep(200);

  /* ================= F. FUND PROTECTION ================= */
  await p.evaluate(() => goTo("commitments")); await sleep(200);
  await p.evaluate(() => openCommitment(null)); await sheetOpen(p);
  await typeInto(p, "#cmAmount", "40000"); await sleep(150);
  check("F1 expensive purchase → EXCEEDS (live while typing) with WHY", (await p.$eval("#cmFund .fund-check", e => e.dataset.verdict)) === "EXCEEDS" && (await text(p, "#cmFund")).includes("WHY"), await text(p, "#cmFund"));
  await typeInto(p, "#cmAmount", "30000"); await sleep(150);
  const v30 = await p.$eval("#cmFund .fund-check", e => e.dataset.verdict);
  await typeInto(p, "#cmAmount", "6000"); await sleep(150);
  const v6 = await p.$eval("#cmFund .fund-check", e => e.dataset.verdict);
  check("F2 verdict scales: ₱30k → WAIT/CAUTION, ₱6k → AFFORDABLE", ["WAIT", "CAUTION"].includes(v30) && v6 === "AFFORDABLE", v30 + "/" + v6);
  await closeSh(p);
  const aff = await cmd(p, "can I afford 5000");
  check("F3 Stage 1 answer kept ('Yes.' + remaining) and fund check added", aff.includes("Yes.") && aff.includes("Fund check") && aff.includes("AFFORDABLE"), aff);

  /* ================= FC. 30-DAY FORECAST ================= */
  await p.evaluate(() => goTo("forecast")); await sleep(300);
  const fcT = await text(p, "#forecastBody");
  check("FC1 forecast tab: projected spending, known items from the list, and WHY", fcT.includes("Projected spending") && fcT.includes("Known coming up") && fcT.includes("WHY") && fcT.includes("averages"), fcT.slice(0, 300));
  check("FC2 pace estimates are whole pesos (no ₱x.4 fake precision)", !/Projected spending\s*₱[\d,]+\.\d/.test(fcT) && !/usual pace ₱[\d,]+\.\d/.test(fcT), fcT.match(/Projected spending\s*₱[\d,.]+/));
  await shot(p, "forecast");

  /* ================= RC. RECURRING → COMMITMENTS ================= */
  const safe0 = await p.evaluate(() => budgetNow().safeToSpend);
  const cmt0 = (await D(p)).commitments.length;
  await p.evaluate(() => goTo("recurring")); await sleep(300);
  await tap(p, "#recAddBtn"); await sheetOpen(p);
  await typeInto(p, "#rcTitle", "Rice sack 25kg"); await typeInto(p, "#rcAmount", "1550"); await sleep(100);
  check("RC1 live fund check while typing the amount", (await text(p, "#rcFund")).includes("AFFORDABLE"));
  await setVal(p, "#rcNext", "2026-10-10"); await typeInto(p, "#rcN", "1"); await setVal(p, "#rcUnit", "months");
  await tap(p, "#rcSave"); await sleep(400);
  d = await D(p);
  const rec = d.recurring.find(r => r.title === "Rice sack 25kg");
  const auto = d.commitments.find(c => c.recurringId === rec.id);
  check("RC2 due within 7 days → becomes a committed purchase automatically; next due moves a month", rec && auto && auto.amount === 1550 && auto.dueDate === "2026-10-10" && rec.nextDue === "2026-11-10" && rec.history.length === 1 && d.commitments.length === cmt0 + 1, JSON.stringify(rec));
  check("RC3 Safe to Spend already accounts for it (−₱1,550)", (await p.evaluate(() => budgetNow().safeToSpend)) === safe0 - 1550);
  check("RC4 recurring alert + audit", d.alerts.some(a => a.kind === "recurring") && d.auditLog.some(a => a.action === "recurring.commit"));
  await tap(p, "#recAddBtn"); await sheetOpen(p);
  await typeInto(p, "#rcTitle", "Water delivery"); await typeInto(p, "#rcAmount", "300"); await setVal(p, "#rcNext", "2026-12-01"); await typeInto(p, "#rcN", "2"); await setVal(p, "#rcUnit", "weeks");
  await tap(p, "#rcSave"); await sleep(300);
  d = await D(p);
  check("RC5 not due soon → no commitment yet", d.commitments.length === cmt0 + 1 && d.recurring.length === 2);
  check("RC6 forecast now includes the recurring purchase", await p.evaluate(() => forecastNow().known.some(k => k.kind === "recurring")) || await p.evaluate(() => forecastNow().known.length > 0));
  await tap(p, "#recAddBtn"); await sheetOpen(p);
  await typeInto(p, "#rcTitle", "Bad"); await typeInto(p, "#rcAmount", "-5"); await tap(p, "#rcSave");
  check("RC7 bad amount rejected", (await text(p, "#sheetMsg")).length > 0 && (await D(p)).recurring.length === 2);
  await closeSh(p);
  await shot(p, "recurring");

  /* ================= ST. SMART SETTINGS ================= */
  await p.evaluate(() => goTo("settings")); await sleep(300);
  await typeInto(p, "#s3Drop", "0"); await tap(p, "#s3Save");
  check("ST1 invalid settings rejected with a clear message", (await text(p, "#s3Msg")).includes("drop 1–99%") && (await D(p)).settings.priceAlerts.dropPct === 5);
  await typeInto(p, "#s3Drop", "5"); await typeInto(p, "#s3Expensive", "1000"); await tap(p, "#s3Save");
  check("ST2 fund-check threshold saved (₱1,000) + audited", (await D(p)).settings.fund.expensiveAt === 1000 && (await D(p)).auditLog.some(a => a.action === "settings.smart"));

  /* ================= C. TEXT COMMANDS (Taglish, local, shared context) ================= */
  await ctl("clear");
  const req0 = (await D(p)).requests.length;
  const riceStock0 = (await inv(p, "Rice")).quantity;
  let ans = await cmd(p, "ubos na yung bigas");
  let card = await lastCard(p);
  check("C1 'ubos na yung bigas' → Rice stock 0 (translated + WHY), no AI call", card.intent === "out_of" && card.state === "done" && (await inv(p, "Rice")).quantity === 0 && card.text.includes("\"bigas\" means rice") && card.text.includes("WHY"), card && card.text);
  check("C2 Undo / Edit / Optimize offered on the action preview", ["undo", "edit", "optimize"].every(a => card.acts.includes(a)), card.acts.join());
  await cardAct(p, "undo");
  check("C3 Undo restores the stock", (await inv(p, "Rice")).quantity === riceStock0);
  const riceQ0 = await listQty(p, "Rice");
  ans = await cmd(p, "add 2 kilo rice");
  card = await lastCard(p);
  check("C4 'add 2 kilo rice' → no duplicate; quantity raised by whole 5 kg packs, explained", card.intent === "add_to_list" && (await listQty(p, "Rice")) === riceQ0 + 1 && card.text.includes("instead of adding a duplicate") && card.text.includes("pack"), card.text);
  ans = await cmd(p, "isa pa");
  check("C5 follow-up 'isa pa' uses the shared context (rice +1)", (await listQty(p, "Rice")) === riceQ0 + 2, ans);
  ans = await cmd(p, "magkano natitira");
  check("C6 'magkano natitira' → Safe to spend (local)", ans.includes("Safe to spend") && ans.includes(money0(await p.evaluate(() => budgetNow().safeToSpend))), ans);
  ans = await cmd(p, "where should I buy eggs");
  check("C7 'where should I buy eggs' → best store from the Price Book with price + freshness", ans.includes("Cheapest") && /Puregold|Pampang/.test(ans) && ans.includes("ago"), ans);
  ans = await cmd(p, "eh yung cooking oil");
  check("C8 follow-up 'eh yung cooking oil' keeps the question (where to buy) → Puregold ₱89/L", ans.includes("Puregold") && ans.includes("₱89/L"), ans);
  ans = await cmd(p, "should I buy rice");
  check("C9 buy-now/wait by command from recorded history", ans.includes("BUY NOW") && ans.includes("recorded prices"), ans);
  ans = await cmd(p, "where to buy air fryer");
  card = await lastCard(p);
  check("C10 unknown item → 'not enough data' + optional 🔎 research (no automatic paid call)", card.text.includes("No prices recorded") && /not enough data/i.test(card.text) && card.acts.includes("research") && (await D(p)).requests.length === req0);
  // money action: needs confirmation
  const spent0 = (await D(p)).spent;
  ans = await cmd(p, "spent 250 at puregold for snacks");
  card = await lastCard(p);
  check("C11 money action waits for OK (pending, nothing recorded yet)", card.state === "pending" && card.acts.includes("approve") && (await D(p)).spent === spent0, card.text);
  ans = await cmd(p, "hindi");
  check("C12 'hindi' cancels — nothing changed", ans.includes("Cancelled") && (await D(p)).spent === spent0);
  await cmd(p, "spent 250 at puregold for snacks");
  ans = await cmd(p, "oo");
  d = await D(p);
  check("C13 'oo' confirms: Spent +₱250, manual entry via command, audited", d.spent === spent0 + 250 && d.manual.some(m => m.via === "command" && m.amount === 250 && m.store === "Puregold") && d.auditLog.some(a => a.action === "spending.add" && a.summary && a.summary.includes("command")), ans);
  // destructive: confirm with the button, then Undo
  await cmd(p, "remove birthday cake");
  card = await lastCard(p);
  check("C14 remove waits for OK", card.state === "pending" && (await li(p, "Birthday cake")).status === "open");
  await cardAct(p, "approve");
  check("C15 Approve removes it (kept as 'removed', not deleted)", (await li(p, "Birthday cake")).status === "removed");
  await cardAct(p, "undo");
  check("C16 Undo brings it back", (await li(p, "Birthday cake")).status === "open");
  // learning from corrections
  ans = await cmd(p, "add panghugas");
  card = await lastCard(p);
  check("C17 unknown word added as a new list item (unpriced, honest)", card.intent === "add_to_list" && !!(await li(p, "Panghugas")), card.text);
  await cardAct(p, "edit"); await sheetOpen(p);
  await setVal(p, "#liProduct", await pid(p, "Dish soap 250ml")); await sleep(150);
  for (let i = 0; i < 3; i++) { if (!(await visible(p, "#sheetModal"))) break; await tap(p, "#liSave"); await sleep(300); }
  d = await D(p);
  check("C18 the Edit correction is learned (panghugas → Dish soap 250ml)", d.learning.terms["panghugas"] && d.learning.terms["panghugas"].productId === d.products.find(x => x.name === "Dish soap 250ml").id, JSON.stringify(d.learning.terms));
  ans = await cmd(p, "where to buy panghugas");
  check("C19 next time the learned word is used, and WHY says so", ans.includes("you corrected this word before") && ans.includes("SM"), ans);
  ans = await cmd(p, "plan my trip fastest");
  check("C20 'plan my trip fastest' opens the planner in FASTEST", (await p.$eval("#rtMode button.on", e => e.dataset.mode).catch(() => "")) === "fastest");
  await closeSh(p);
  ans = await cmd(p, "what's low?");
  check("C21 Stage 2 local answers still work ('what's low?')", ans.includes("Running low") || ans.includes("low"), ans);
  ans = await cmd(p, "how much is left?");
  check("C22 Stage 1 'how much is left?' unchanged", ans.includes("Safe to spend:"), ans);
  check("C23 no AI calls for any of these commands", (await ctl("seen")).length === 0 && (await D(p)).requests.length === req0);

  /* ================= V. VOICE (short spoken replies) ================= */
  await p.evaluate(() => { window.__said = []; voiceSettings.speak = true; window.speechSynthesis.speak = u => window.__said.push(u.text); window.speechSynthesis.cancel = () => { }; });
  await p.evaluate(() => { voice.text = "ubos na yung itlog"; sendVoiceNow(); }); await sleep(400);
  check("V1 spoken 'ubos na yung itlog' handled on the phone: eggs 0, short spoken reply, no research", (await inv(p, "Eggs")).quantity === 0 && (await p.evaluate(() => window.__said.slice(-1)[0] || "")).includes("Eggs is out") && (await D(p)).requests.length === req0, await p.evaluate(() => window.__said.join(" | ")));
  await p.evaluate(() => { voice.text = "magkano natitira"; sendVoiceNow(); }); await sleep(300);
  check("V2 spoken budget question → short spoken answer", (await p.evaluate(() => window.__said.slice(-1)[0] || "")).includes("safely spend"));
  await p.evaluate(() => { voice.text = "Find me the best air fryer under 5,000 pesos"; sendVoiceNow(); }); await sleep(500);
  check("V3 open-ended voice request still goes to AI research (voice source)", (await D(p)).requests.length === req0 + 1 && (await D(p)).requests[0].source === "voice");
  await waitFor(async () => (await D(p)).requests[0].status !== "researching", 20000);

  /* ================= RS. RESEARCH: price labels + source quality ================= */
  await ctl("set?research=offers"); await ctl("clear");
  await cmd(p, "Best 16 inch stand fan under 2,000 pesos");
  await waitFor(async () => (await D(p)).requests[0].status === "done", 20000);
  d = await D(p);
  const rq = d.requests[0];
  check("RS1 research saved with web sources (deduped) + time + parsed offers", rq.text.includes("stand fan") && rq.sources.length === 3 && !!rq.researchedAt && rq.offers.length === 4 && rq.offers[3].price === null && rq.offers[1].price === 1899, JSON.stringify(rq.offers));
  check("RS2 exactly one research call was made (mocked; no real paid call)", (await ctl("seen")).filter(x => x.kind === "research").length === 1);
  await p.evaluate(() => goTo("shopping")); await sleep(400);
  await p.evaluate(id => { const d = document.querySelector(`.research-intel[data-req='${id}']`); if (d) d.closest("details").open = true; }, rq.id);
  const ri = await p.$eval(`.research-intel[data-req='${rq.id}']`, e => e.innerText);
  const rows = await p.$$eval(`.research-intel[data-req='${rq.id}'] .offer-row`, rs => rs.map(r => r.innerText));
  check("RS3 each found price has a status: linked listings LIVE, no-link guess ESTIMATED, missing price UNKNOWN", rows.length === 4 && rows[0].includes("LIVE") && rows[2].includes("ESTIMATED") && rows[3].includes("UNKNOWN") && rows[3].includes("price unknown"), rows.join(" || "));
  check("RS4 source quality shown (marketplace / community / no source)", rows[0].includes("Marketplace") && /Community|Forum/i.test(rows[3]) && /No source/i.test(rows[2]), rows.join(" || "));
  check("RS5 fund check on the best trusted offer (₱1,799 ≥ ₱1,000 threshold)", ri.includes("₱1,799") && ri.includes("Fund check"), ri);
  check("RS6 sources list sorted by quality; OFFER lines hidden from the report text", ri.includes("Sources (3)") && !(await p.$eval(`.research-intel[data-req='${rq.id}']`, e => e.closest("details").querySelector(".report").innerText)).includes("OFFER:"));
  await tap(p, `.research-intel[data-req='${rq.id}'] [data-offer='0'] [data-act='save-offer']`); await sleep(300);
  d = await D(p);
  const saved = d.priceRecords.find(r => r.sourceRef && r.sourceRef.type === "research");
  check("RS7 'Save' puts the verified listing in the Price Book as ONLINE (with URL), audited", saved && saved.source === "online" && saved.price === 1799 && saved.url.includes("lazada") && d.auditLog.some(a => a.action === "price.add" && a.summary.includes("research")));
  await tap(p, `.research-intel[data-req='${rq.id}'] [data-offer='2'] [data-act='save-offer']`); await sleep(300);
  d = await D(p);
  const est = d.priceRecords.find(r => r.sourceRef && r.sourceRef.type === "research" && r.sourceRef.line === 2);
  check("RS8 an AI guess is saved as an ESTIMATE and is never used for store picks", est && est.source === "ai_estimate" && await p.evaluate(id => rankingFor(data.products.find(x => x.id === id)).rows.length === 0, est.productId));
  await shot(p, "research");
  await ctl("set?research=ok");

  /* ================= AL. alert center: dismiss all ================= */
  await tap(p, "#bellBtn"); await sheetOpen(p);
  if (await exists(p, "#alertsDismissAll")) await tap(p, "#alertsDismissAll");
  check("AL7 dismiss all → empty center (alerts kept in data, just dismissed)", (await p.evaluate(() => activeAlerts().length)) === 0 && (await D(p)).alerts.length > 0 && await exists(p, "#alertsEmpty"));
  await closeSh(p);

  /* ================= L. FORGET LEARNING ================= */
  await p.evaluate(() => goTo("settings")); await sleep(300);
  check("L1 settings show what was learned", (await text(p, "#s3Card")).includes("1 word"));
  await tap(p, "#s3Card button.link"); await sleep(200);
  d = await D(p);
  check("L2 'Forget' clears learned words but keeps a record of them", Object.keys(d.learning.terms).length === 0 && d.learning.corrections.some(c => c.type === "reset" && c.before.terms.panghugas));

  /* ================= B. BACKUP round-trip keeps Stage 3 data ================= */
  const before = await D(p);
  const bkText = await p.evaluate(() => backupPayload());
  const bk = JSON.parse(bkText);
  fs.writeFileSync(path.join(OUT, "stage3-backup.json"), bkText);
  check("B1 backup includes recurring, alerts, learning, store travel", bk.schemaVersion === 4 && bk.counts.recurring === 2 && bk.counts.alerts === before.alerts.length && bkText.includes("\"routeModeCounts\"") && bkText.includes("\"travel\""), JSON.stringify(bk.counts));
  await p.evaluate(() => { data.recurring = []; data.alerts = []; save(); });
  await p.evaluate(() => goTo("data")); await sleep(300);
  const [bf] = await Promise.all([p.waitForFileChooser(), tap(p, "button[onclick=\"document.getElementById('restoreFile').click()\"]")]);
  await bf.accept([path.join(OUT, "stage3-backup.json")]); await sleep(1200);
  d = await D(p);
  check("B2 restore brings back recurring + alerts + travel exactly", d.recurring.length === 2 && d.alerts.length === before.alerts.length && d.stores.find(x => x.id === "store_puregold").travel.minutes === 10 && d.spent === before.spent);
  check("B3 integrity check clean at the end", await p.evaluate(() => JasonModel.integrityCheck(data).errors === 0), JSON.stringify(await p.evaluate(() => JasonModel.integrityCheck(data).issues.filter(i => i.level === "error").slice(0, 3))));

  /* ================= N. screens, layout, errors ================= */
  let clean = true;
  for (const [v, sub] of [["home"], ["budget", "forecast"], ["more", "recurring"], ["more", "settings"], ["more", "menu"], ["shop", "list"], ["shop", "prices"]]) {
    await p.evaluate((v, sub) => showView(v, sub || null), v, sub); await sleep(200);
    const r = await noNegatives(p); if (r !== true) { clean = false; console.log("  ", v, sub, r); }
  }
  check("N1 no NaN / undefined / negative peso text on any Stage 3 screen", clean);
  const fits = await p.evaluate(async () => { const w = []; for (const f of [() => showView("budget", "forecast"), () => showView("more", "menu"), () => openPlanner(), () => openAlerts()]) { f(); await new Promise(r => setTimeout(r, 150)); w.push(document.documentElement.scrollWidth); closeSheet(); } return w.every(x => x <= 384) ? true : w; });
  check("N2 no sideways scrolling at 384px (forecast, menu, planner, alerts)", fits === true, JSON.stringify(fits));
  await p.evaluate(() => goTo("home")); await sleep(300);
  await shot(p, "home");
  check("N3 More menu lists Recurring, Alert center, Forecast", await p.evaluate(() => { showView("more", "menu"); return ["more_recurring", "more_alerts", "more_forecast"].every(id => !!document.getElementById(id)); }));
  check("N4 no JS errors in the whole Stage 3 run", p.errors.length === 0, p.errors.join(" | "));
  await p.close();

  /* ================= Z. FRESH INSTALL ================= */
  p = await mk(null);
  let zClean = true;
  for (const [v, sub] of [["home"], ["budget", "forecast"], ["more", "recurring"], ["more", "settings"]]) {
    await p.evaluate((v, sub) => showView(v, sub || null), v, sub); await sleep(200);
    const r = await noNegatives(p); if (r !== true) { zClean = false; console.log("  ", v, sub, r); }
  }
  check("Z1 fresh install: forecast/recurring render honest empty states", zClean && /not enough data|Set up|set up|No recurring/i.test(await p.evaluate(() => document.getElementById("forecastBody").innerText + document.getElementById("recurringBody").innerText)));
  const zc = await p.evaluate(() => { const r = handleCommand("where should I buy rice", "text"); return r ? r.html : ""; });
  check("Z2 fresh install: price question says 'not enough data' (never invents a price)", /not enough data/i.test(zc) && !/₱\d/.test(zc.replace(/<[^>]+>/g, "")));
  await p.evaluate(() => { openPlanner(); }); await sleep(200);
  check("Z3 planner with an empty list explains itself", /empty|Add items/i.test(await p.evaluate(() => document.getElementById("sheetModal").classList.contains("hidden") ? document.getElementById("cmdAnswer").innerText + document.body.innerText : document.getElementById("sheetBody").innerText)));
  await p.evaluate(() => closeSheet());
  check("Z4 fresh install: viewing screens writes nothing", (await stored(p)) === null);
  check("Z5 no JS errors on fresh install", p.errors.length === 0, p.errors.join(" | "));
  await p.close();

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
