/*
  Stage 4 end-to-end tests — headless mobile Chrome (384×854, touch), AI mocked (mock5).
  Starts from a REAL Stage 3 (schema v4) snapshot (tests/fixtures/stage3-snapshot.json, made by
  driving the Stage 3 production app with tests/fixtures/generate-stage3-snapshot.js).
  Covers Insights (trends, basket index, real savings, store performance, waste/stock-outs,
  accuracy, unusual spending, one-tap AI summary, CSV/PDF export), search, trip history,
  product page, preferences, people/roles, household requests, receipt archive, throw-out,
  restore → recalculation, empty/loading states. Page clock pinned to 2026-10-06 13:00 Manila.
  Run with: bash tests/run-browser-tests.sh stage4   (or: all)
*/
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const fs = require("fs");
const revealShim = require("../legacy/reveal-shim");
const FIX = path.join(__dirname, "..", "fixtures");
const OUT = process.env.TEST_OUT || path.join(os.tmpdir(), "jason-shop-tests");
const DL = path.join(OUT, "dl-stage4");
fs.mkdirSync(DL, { recursive: true });
const URL = "http://localhost:8080/index.html";
const SNAP = JSON.parse(fs.readFileSync(path.join(FIX, "stage3-snapshot.json"), "utf8"));
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
  const shot = (p, name) => p.screenshot({ path: path.join(OUT, "stage4-" + name + ".png") });
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

  const insText = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : ""; }, sel);
  const goInsights = async (p) => { await p.evaluate(() => { s4State.insKey = null; goTo("insights"); }); await waitFor(() => exists(p, "#insTotals,#insEmpty"), 4000); await sleep(100); };
  const summaryCalls = async () => (await ctl("seen")).filter(x => x.kind === "summary");

  /* ================= U. UPGRADE v4 → v5 from a real Stage 3 snapshot ================= */
  const v4 = SNAP.data || SNAP;
  let p = await mk(JSON.stringify(v4));
  await waitFor(async () => (await text(p, "#bootBanner")).includes("upgraded"));
  const banner = await text(p, "#bootBanner");
  check("U1 upgrade banner: data kept + Stage 4 features named (no stale Stage 2/3 lines)", banner.includes("2 receipts") && banner.includes("16 manual entries") && banner.includes("₱31,652") && banner.includes("Insights") && !banner.includes("smart store picks") && !banner.includes("home inventory"), banner);
  await waitFor(async () => ((await stored(p)) || {}).schemaVersion === 5);
  let s = await stored(p);
  check("U2 saved data is v5 and every Stage 3 record is kept", s.schemaVersion === 5 && s.products.length === v4.products.length && s.priceRecords.length === v4.priceRecords.length && s.inventoryItems.length === v4.inventoryItems.length && s.inventoryTransactions.length === v4.inventoryTransactions.length && s.receipts.length === 2 && s.manual.length === 16 && s.spent === 31652 && s.trips.length === 1 && s.recurring.length === v4.recurring.length && s.alerts.length >= v4.alerts.length);
  check("U3 new v5 collections: owner Jason, empty requests, plan history seeded, preferences defaults", s.people.length === 1 && s.people[0].role === "owner" && s.people[0].name === "Jason" && Array.isArray(s.householdRequests) && s.householdRequests.length === 0 && Array.isArray(s.planHistory) && Array.isArray(s.forecastSnapshots) && s.settings.preferences && s.settings.preferences.insightsRange === "90d" && s.settings.preferences.startView === "home", JSON.stringify({ people: s.people, ph: s.planHistory && s.planHistory.length, pf: s.settings.preferences }));
  const snaps = await p.evaluate(() => JasonStore.listSnapshots());
  check("U4 safety copy of the v4 data saved first (IndexedDB)", snaps.some(x => x.reason === "before upgrade v4 → v5" && x.counts.priceRecords === v4.priceRecords.length), JSON.stringify(snaps.map(x => x.reason)));
  check("U5 integrity check clean after upgrade", await p.evaluate(() => JasonModel.integrityCheck(data).errors === 0));
  await tap(p, "#bootBanner button");

  /* ================= I. INSIGHTS ================= */
  check("I1 home shows an Insights card with real last-30-day spending", (await insText(p, "#homeInsights")).includes("₱21,172"), await insText(p, "#homeInsights"));
  const sk = await p.evaluate(() => { showView("budget", "insights"); s4State.insKey = null; renderInsights(); return !!document.getElementById("insLoading"); });
  check("I2 loading skeleton shows first, then the cards", sk && await waitFor(() => exists(p, "#insTotals"), 3000) && !(await exists(p, "#insLoading")));
  check("I3 default range = last 90 days: ₱25,252, change hidden (history too short to compare)", (await text(p, "#insTotal")) === "₱25,252" && (await text(p, "#insChange")) === "—" && (await insText(p, "#insRange .chip.on")).includes("90"), await insText(p, "#insTotals"));
  await shot(p, "insights-top");
  await tap(p, "#insRange button[data-range='30d']"); await waitFor(() => exists(p, "#insTotals"), 3000); await sleep(100);
  check("I4 range chip 30 days: ₱21,172 and a real % vs the 30 days before (₱1,380)", (await text(p, "#insTotal")) === "₱21,172" && (await text(p, "#insChange")) === "+1434.2%" && (await insText(p, "#insTotals")).includes("₱1,380 before") && (await stored(p)).settings.preferences.insightsRange === "30d", await insText(p, "#insTotals"));
  await tap(p, "#insRange button[data-range='all']"); await waitFor(() => exists(p, "#insTotals"), 3000); await sleep(100);
  check("I5 All time = Spent ₱31,652 (matches the budget total)", (await text(p, "#insTotal")) === "₱31,652");
  const charts = await p.evaluate(() => ({ months: document.querySelectorAll("#insMonths svg rect, #insMonths svg .bar").length, cats: document.getElementById("insCategories").innerText, stores: document.getElementById("insStoresSpend").innerText }));
  check("I6 charts: monthly bars (inline SVG) + category & store breakdowns", charts.months >= 5 && charts.cats.includes("Groceries") && charts.cats.includes("₱23,453") && charts.stores.includes("Pampang"), JSON.stringify(charts));
  const basket = await insText(p, "#insBasket");
  check("I7 basket price index: same 5 products Oct vs Sep, −0.7%, per-item table", (await text(p, "#insBasketChange")) === "-0.7%" && basket.includes("5 items") && basket.includes("Rice Jasmine 5kg") && basket.includes("-3.5%") && !!(await p.$("#insBasket svg")), basket);
  const sav = await insText(p, "#insSavings");
  check("I8 savings only from real before/after prices: saved ₱70, paid more ₱0, net ₱70", (await text(p, "#insSaved")) === "₱70" && (await text(p, "#insPaidMore")) === "₱0" && (await text(p, "#insNet")) === "₱70" && sav.includes("₱270 → ₱250") && sav.includes("+₱20"), sav);
  const perf = await insText(p, "#insStorePerf");
  check("I9 store performance table: spend, visits, avg basket, cheapest wins", perf.includes("Pampang Palengke") && perf.includes("₱17,830") && perf.includes("4/6") && perf.includes("+4% avg"), perf);
  check("I10 stock-outs counted from real stock changes (Cooking oil ran out once), no waste recorded yet", (await text(p, "#insStockouts")) === "1" && (await text(p, "#insWaste")) === "₱0" && (await insText(p, "#insUsage")).includes("Cooking oil"));
  const acc = await insText(p, "#insAccuracy");
  check("I11 accuracy: honest 'Not enough data' + first forecast check date", (await text(p, "#insCycleAcc")) === "Not enough data" && (await text(p, "#insPlanAcc")) === "Not enough data" && (await text(p, "#insFcAcc")) === "Not enough data" && acc.includes("first check on 2026-11-06"), acc);
  const flags = await p.$$eval("#insUnusual .flag-row", rs => rs.map(r => r.dataset.kind + ": " + r.innerText));
  check("I12 unusual spending: Sep groceries spike, ₱6,500 party food, possible duplicate ₱850 Vitamins", flags.some(f => f.startsWith("category_spike") && f.includes("Sep 2026")) && flags.some(f => f.startsWith("big_purchase") && f.includes("Party food for 30") && f.includes("₱6,500")) && flags.some(f => f.startsWith("possible_duplicate") && f.includes("Vitamins") && f.includes("₱850")), flags.join(" | "));
  await shot(p, "insights-mid");

  /* ================= S. AI SUMMARY (one call, only when tapped) ================= */
  const before = (await summaryCalls()).length;
  check("S1 opening Insights makes no AI call", before === 0, String(before));
  await p.evaluate(() => setInsightsMonth("2026-09"));
  await tap(p, "#insAIBtn");
  await waitFor(async () => (await insText(p, "#insAIBox")).includes("₱5,523"), 15000);
  const calls = await summaryCalls();
  check("S2 one tap = exactly one AI call; summary shown and saved under insights:2026-09", calls.length === 1 && (await stored(p)).reportSummaries["insights:2026-09"] && (await insText(p, "#insAIBox")).includes("₱5,523"), String(calls.length));
  check("S3 the AI is given the pre-calculated analytics facts (not raw receipts)", calls[0] && calls[0].input.includes("Analytics facts") && calls[0].input.includes("Party food for 30") && !calls[0].input.includes("data:image"), calls[0] && calls[0].input.slice(-600));
  check("S4 Report tab's summary storage untouched", !Object.keys((await stored(p)).reportSummaries).some(k => /^\d{4}-\d{2}$/.test(k) && !(v4.reportSummaries || {})[k]));

  /* ================= E. EXPORT (CSV / PDF with a date range) ================= */
  await tap(p, "#insExportBtn"); await sheetOpen(p);
  await setVal(p, "#exFrom", "2026-09-01"); await setVal(p, "#exTo", "2026-09-30");
  await tap(p, "#exCsvEntries"); await sleep(300);
  let ex = await p.evaluate(() => lastExport);
  check("E1 spending CSV for 1–30 Sep only: right name, has the party, no October rows", ex && ex.name === "jason-shop-spending-2026-09-01_to_2026-09-30.csv" && ex.text.includes("Party food for 30") && !ex.text.includes("2026-10-") && ex.text.includes("\r\n") && (await text(p, "#sheetMsg")).includes("Saved"), ex && ex.text.slice(0, 300));
  await tap(p, "#exCsvAnalytics"); await sleep(300);
  ex = await p.evaluate(() => lastExport);
  check("E2 analytics CSV has totals, stores, unusual flags and honest 'not enough data'", ex.name.startsWith("jason-shop-analytics-2026-09-01") && ex.text.includes("Total spent") && ex.text.includes("Store performance") && ex.text.includes("Unusual") && /not enough data/i.test(ex.text), ex.text.slice(0, 400));
  await tap(p, "#exCsvPrices"); await sleep(300);
  ex = await p.evaluate(() => lastExport);
  check("E3 prices CSV for the range", ex.name.startsWith("jason-shop-prices-") && ex.text.includes("Rice Jasmine 5kg") && ex.text.includes("Each (PHP)"));
  await tap(p, "#exPdf"); await sleep(500);
  ex = await p.evaluate(() => lastExport);
  check("E4 PDF report built on the phone (valid header, sections, PHP amounts, A4)", ex.mime === "application/pdf" && ex.text.startsWith("%PDF-1.4") && ex.text.includes("Savings achieved") && ex.text.includes("Unusual spending") && ex.text.includes("PHP 6,500") && ex.text.includes("/MediaBox [0 0 595") && ex.text.trim().endsWith("%%EOF"), ex.text && ex.text.slice(0, 120));
  await waitFor(() => fs.readdirSync(DL).some(f => f.endsWith(".pdf")), 4000);
  const pdfFile = fs.readdirSync(DL).find(f => f.endsWith(".pdf"));
  check("E5 the PDF file really downloads", !!pdfFile && fs.statSync(path.join(DL, pdfFile)).size > 1500, String(pdfFile));
  if (pdfFile) fs.copyFileSync(path.join(DL, pdfFile), path.join(OUT, "stage4-insights.pdf"));
  await closeSh(p);

  /* ================= F. SEARCH ================= */
  await tap(p, "#searchBtn"); await sheetOpen(p);
  await typeInto(p, "#searchInput", "rice"); await sleep(300);
  const groups = await p.$$eval(".search-hit", hs => [...new Set(hs.map(h => h.dataset.group))]);
  check("F1 universal search 'rice' finds products, inventory, receipts and trips", ["Products", "Inventory", "Receipts", "Trips"].every(g => groups.includes(g)), groups.join(","));
  await shot(p, "search");
  await typeInto(p, "#searchInput", "vitamns"); await sleep(300);
  check("F2 typo-tolerant: 'vitamns' still finds the Vitamins entries", (await text(p, "#searchResults")).includes("Vitamins"), await text(p, "#searchResults"));
  await typeInto(p, "#searchInput", "zzqx"); await sleep(300);
  check("F3 no match → clear empty state", (await text(p, "#searchResults")).includes("Nothing found"));
  await typeInto(p, "#searchInput", "Jasmine"); await sleep(300);
  await p.$$eval(".search-hit[data-group='Products']", hs => { const h = hs.find(h => h.querySelector("b").innerText === "Rice Jasmine 5kg"); if (h) h.id = "hitRice5"; });
  await tap(p, "#hitRice5"); await sleep(300);
  check("F4 tapping a product hit opens its product page", await visible(p, "#productPage") && (await text(p, "#productPage")).includes("Rice Jasmine 5kg"));

  /* ================= P. PRODUCT PAGE ================= */
  const pp = await p.evaluate(() => ({ chart: document.querySelectorAll("#productChart svg circle").length, bought: document.getElementById("productBought").innerText, inv: document.getElementById("productInv").innerText, hero: document.getElementById("productPage").innerText }));
  check("P1 product page: stats, price chart from real records, purchase history, inventory", pp.chart >= 3 && pp.hero.includes("Lowest") && pp.hero.includes("₱69/kg") && pp.bought.includes("₱345") && pp.inv.includes("Rice"), JSON.stringify(pp).slice(0, 400));
  await shot(p, "product");
  await tap(p, "#productAddList"); await sleep(250);
  check("P2 'Add to shopping list' from the product page", !!(await li(p, "Rice Jasmine 5kg")) || (await p.evaluate(() => openListItems().some(x => x.productId === s4State.productId))));
  await openProd(p, "Eggs tray");
  check("P3 product sheet links to the full page", await exists(p, "#productFullBtn"));
  await closeSh(p);

  /* ================= T. TRIP HISTORY ================= */
  await p.evaluate(() => showSub("shop", "trip")); await sleep(300);
  const th = await insText(p, "#tripHistory");
  check("T1 trip history lists the finished ₱775 trip with its stores", th.includes("₱775") && th.includes("1 trip") && /Landers|Puregold/.test(th), th);
  await tap(p, ".trip-hist"); await sheetOpen(p);
  check("T2 trip detail: per-store lines and total ₱775", (await text(p, "#tripDetailTotal")) === "₱775" && (await text(p, "#sheetBody")).includes("Cooking oil"), await text(p, "#sheetBody"));
  await closeSh(p);

  /* ================= R. PREFERENCES ================= */
  const riceStores = async () => p.evaluate(() => { const r = planInputs(); const row = r.rows.find(x => x.li.productId === (data.products.find(q => q.name === "Rice Jasmine 5kg") || {}).id); return row ? Object.keys(row.prices) : []; });
  const rs0 = await riceStores();
  const landers = await p.evaluate(() => (data.stores.find(s => /Landers/.test(s.name)) || {}).id);
  check("R0 before: the trip planner can price rice at Landers", rs0.includes(landers), JSON.stringify(rs0));
  await p.evaluate(() => goTo("preferences")); await sleep(300);
  check("R1 preferences card in Settings", await visible(p, "#prefsCard"));
  await setVal(p, `select[data-pfstore='${landers}']`, "avoid");
  const sm = await p.evaluate(() => (data.stores.find(s => /^SM/.test(s.name)) || {}).id);
  await setVal(p, `select[data-pfstore='${sm}']`, "prefer");
  await setVal(p, "#pfStart", "shop");
  await typeInto(p, "#pfAvoidBrands", "Generic Brand");
  await typeInto(p, "#pfNotes", "No peanuts");
  await tap(p, "#pfSave"); await sleep(200);
  s = await stored(p);
  check("R2 preferences saved (avoid Landers, prefer SM, open on Shop, notes)", (await text(p, "#prefsMsg")).includes("Saved") && s.settings.preferences.avoidStores.includes(landers) && s.settings.preferences.preferredStores.includes(sm) && s.settings.preferences.startView === "shop" && s.settings.preferences.notes === "No peanuts");
  const rs1 = await riceStores();
  check("R3 avoided store is left out of the trip planner", !rs1.includes(landers) && rs1.length >= 1, JSON.stringify(rs1));
  await p.evaluate(() => { s4State.insKey = null; }); await goInsights(p);
  check("R4 preferred store is starred in Store performance", (await insText(p, "#insStorePerf")).includes("⭐ SM Supermarket"));

  /* ================= H. PEOPLE, ROLES & HOUSEHOLD REQUESTS ================= */
  await p.evaluate(() => goTo("people")); await sleep(300);
  check("H1 people card: Jason is Owner; honest 'not security' note", (await insText(p, "#peopleCard")).includes("Jason") && (await insText(p, "#peopleCard")).includes("not security"));
  await tap(p, "#addPersonBtn"); await sheetOpen(p);
  await typeInto(p, "#psName", "Ate Maria"); await setVal(p, "#psRole", "staff");
  await tap(p, "#psSave"); await sleep(250);
  const maria = await p.evaluate(() => (data.people.find(x => x.name === "Ate Maria") || {}).id);
  check("H2 person added with a role", !!maria && (await D(p)).people.find(x => x.id === maria).role === "staff");
  await p.evaluate(() => goTo("people")); await sleep(200);
  await setVal(p, "#actingAs", maria); await sleep(200);
  await p.evaluate(() => goTo("requests")); await sleep(300);
  check("H3 acting as staff: can ask, can't approve (buttons gated)", (await text(p, "#requestsBody")).includes("Acting as Ate Maria") && !(await exists(p, "#addPersonBtn")));
  for (const [t, q, urg] of [["Dishwashing liquid", "2", "urgent"], ["Chocolate cereal", "1", "normal"]]) {
    await tap(p, "#hrNew"); await sheetOpen(p);
    await typeInto(p, "#hrTitle", t); await typeInto(p, "#hrQty", q); await setVal(p, "#hrUrgency", urg);
    await tap(p, "#hrSave"); await sleep(250);
  }
  s = await stored(p);
  check("H4 two requests saved as pending, from Ate Maria", s.householdRequests.length === 2 && s.householdRequests.every(r => r.status === "pending" && r.requestedByName === "Ate Maria"));
  check("H5 staff sees Cancel, not Approve/Decline", (await p.$$(".hreq-row [data-act='approve']")).length === 0 && (await p.$$(".hreq-row [data-act='cancel']")).length === 2);
  const blocked = await p.evaluate(() => { const r = data.householdRequests[0]; decideHouseholdRequest(r.id, true); return r.status; });
  check("H6 approving is refused while acting as staff", blocked === "pending");
  await p.evaluate(() => goTo("home")); await sleep(250);
  check("H7 home shows the waiting requests (urgent first-class)", (await insText(p, "#homeRequests")).includes("Household requests (2)") && (await insText(p, "#homeRequests")).includes("⚡"));
  await p.evaluate(() => showSub("shop", "list")); await sleep(250);
  check("H8 shopping list shows a 'waiting for approval' banner", (await insText(p, "#listReqBanner")).includes("2 household requests"));
  await p.evaluate(id => setActingPerson(id), await p.evaluate(() => data.people.find(x => x.role === "owner").id)); await sleep(150);
  await p.evaluate(() => goTo("requests")); await sleep(300);
  await shot(p, "requests");
  const dish = await p.evaluate(() => data.householdRequests.find(r => r.title === "Dishwashing liquid").id);
  const cereal = await p.evaluate(() => data.householdRequests.find(r => r.title === "Chocolate cereal").id);
  await tap(p, `.hreq-row[data-hreq='${dish}'] [data-act='approve']`); await sleep(250);
  const dli = await li(p, "Dishwashing liquid");
  check("H9 owner approves → item on the list, linked to the request and the requester", dli && dli.qty === 2 && dli.householdRequestId === dish && dli.requestedByName === "Ate Maria" && (await D(p)).householdRequests.find(r => r.id === dish).status === "approved");
  await tap(p, `.hreq-row[data-hreq='${cereal}'] [data-act='reject']`); await sheetOpen(p);
  await typeInto(p, "#hrReason", "too sugary"); await tap(p, "#hrRejectGo"); await sleep(250);
  const cr = (await D(p)).householdRequests.find(r => r.id === cereal);
  check("H10 decline with a reason → kept in 'Decided' with history; not on the list", cr.status === "rejected" && cr.decisionNote === "too sugary" && cr.history.length === 2 && !(await li(p, "Chocolate cereal")));
  check("H11 audit log records request, approve and decline", await p.evaluate(() => ["hreq.add", "hreq.approve", "hreq.reject"].every(a => data.auditLog.some(x => x.action === a))));

  /* ================= A. RECEIPT ARCHIVE ================= */
  await p.evaluate(() => showSub("shop", "receipts")); await sleep(250);
  check("A1 receipt manager links to the archive", await exists(p, "#openReceiptArchive"));
  await tap(p, "#openReceiptArchive"); await sleep(300);
  check("A2 archive lists all receipts with total", (await p.$$(".rc-tile")).length === 2 && (await text(p, "#rcSummary")).includes("2 receipts"));
  await typeInto(p, "#rcSearch", "fan"); await sleep(500);
  check("A3 search inside receipts by item name", (await p.$$(".rc-tile")).length >= 1);
  const spent0 = (await D(p)).spent, hist0 = await p.evaluate(() => recordedSpentTotal());
  await tap(p, ".rc-tile"); await sheetOpen(p);
  await tap(p, "#rcArchiveBtn"); await sleep(250);
  const d1 = await D(p);
  check("A4 archiving keeps the receipt and leaves Spent + history unchanged", d1.receipts.length === 2 && d1.receipts.filter(r => r.archived).length === 1 && d1.spent === spent0 && (await p.evaluate(() => recordedSpentTotal())) === hist0);
  await p.evaluate(() => showSub("shop", "receipts")); await sleep(250);
  check("A5 archived receipt hidden from the Receipt Manager, counted in the link", (await p.$$("#receiptList > *")).length === 1 && (await text(p, "#receiptArchiveLink")).includes("1 archived"), await text(p, "#receiptArchiveLink"));
  await shot(p, "receipts");

  /* ================= W. THROW OUT (waste with a reason) ================= */
  const eggs = await inv(p, "Eggs");
  await p.evaluate(id => { goTo("inventory"); openInvItem(id); }, eggs.id); await sheetOpen(p);
  await tap(p, "#ivThrow"); await sleep(200);
  await typeInto(p, "#toQty", "6"); await setVal(p, "#toReason", "spoiled");
  await tap(p, "#toSave"); await sleep(250);
  const e2 = await inv(p, "Eggs");
  const tx = (await D(p)).inventoryTransactions.pop();
  const uv = await p.evaluate(id => itemUnitValue(invById(id)), eggs.id);
  check("W1 throw-out lowers stock and records the reason", e2.quantity === eggs.quantity - 6 && tx.type === "discard" && tx.reason === "spoiled", JSON.stringify(tx));
  await goInsights(p);
  const wasteTxt = await text(p, "#insWaste");
  check("W2 Insights waste = 6 × last price paid per egg (no guessing)", uv > 0 && wasteTxt === money0(Math.round(uv * 6 * 100) / 100), wasteTxt + " uv=" + uv);

  /* ================= B. RESTORE → RECALCULATE ================= */
  const bk = await p.evaluate(() => backupPayload());
  await p.evaluate(() => goTo("backup")); await sleep(200);
  const ok = await p.evaluate(t => restoreFromText(t), bk); await sleep(400);
  const bmsg = await text(p, "#backupMsg");
  check("B1 restore recalculates derived data and says so (never changes money)", ok && bmsg.includes("Restored backup") && bmsg.includes("Recalculated") && bmsg.includes("data check: no problems") && (await D(p)).spent === spent0, bmsg);
  check("B2 restore keeps the v5 extras (people, requests, preferences)", (await D(p)).people.length === 2 && (await D(p)).householdRequests.length === 2 && (await D(p)).settings.preferences.notes === "No peanuts");

  /* ================= N. POLISH / SAFETY ================= */
  let clean = true;
  for (const f of [() => goTo("insights"), () => goTo("requests"), () => goTo("receiptArchive"), () => openProductPage(data.products[0].id), () => goTo("people"), () => goTo("home")]) {
    await p.evaluate(`(${f.toString()})()`); await sleep(300);
    const r = await noNegatives(p); if (r !== true) { clean = false; console.log("  ", f.toString(), r); }
  }
  check("N1 no NaN / undefined / negative peso text on any Stage 4 screen", clean);
  const fits = await p.evaluate(async () => { const w = []; for (const f of [() => goTo("insights"), () => goTo("requests"), () => goTo("receiptArchive"), () => openSearch("rice"), () => showSub("shop", "trip")]) { f(); await new Promise(r => setTimeout(r, 200)); w.push(document.documentElement.scrollWidth); closeSheet(); } return w.every(x => x <= 384) ? true : w; });
  check("N2 no sideways scrolling at 384px (insights, requests, archive, search, trip)", fits === true, JSON.stringify(fits));
  const hdr = await p.evaluate(() => { const a = document.getElementById("searchBtn").getBoundingClientRect(), b = document.getElementById("bellBtn").getBoundingClientRect(), h = document.querySelector(".app-head h1"); const c = h ? h.getBoundingClientRect() : null; return { overlap: !(a.right <= b.left || b.right <= a.left), titleClear: !c || c.right <= a.left + 1 || c.bottom <= a.top }; });
  check("N3 header: search and bell buttons don't overlap each other or the title", !hdr.overlap && hdr.titleClear, JSON.stringify(hdr));
  await p.evaluate(() => goTo("home")); await sleep(300);
  await shot(p, "home");
  check("N4 More menu lists Insights, Requests, Receipt archive, Search", await p.evaluate(() => { showView("more", "menu"); return ["more_insights", "more_requests", "more_receiptArchive", "more_search"].every(id => !!document.getElementById(id)); }));
  check("N5 total AI calls in this run: exactly 1 summary (only when tapped)", (await summaryCalls()).length === 1);
  check("N6 no JS errors in the whole Stage 4 run", p.errors.length === 0, p.errors.join(" | "));
  await p.close();

  /* ================= O. START VIEW preference applies on next open ================= */
  p = await mk(JSON.stringify(Object.assign({}, s, { settings: Object.assign({}, s.settings, { preferences: Object.assign({}, s.settings.preferences, { startView: "insights" }) }) })));
  await sleep(500);
  check("O1 'Open the app on' preference opens Insights on launch", await p.evaluate(() => ui.view === "budget" && ui.sub.budget === "insights") && await waitFor(() => exists(p, "#insTotals"), 3000));
  await p.close();

  /* ================= Z. FRESH INSTALL — empty states ================= */
  p = await mk(null);
  let zClean = true, empties = {};
  for (const [name, f] of [["insights", () => goTo("insights")], ["requests", () => goTo("requests")], ["archive", () => goTo("receiptArchive")], ["product", () => { s4State.productId = null; showSub("shop", "product"); }], ["trip", () => showSub("shop", "trip")]]) {
    await p.evaluate(`(${f.toString()})()`); await sleep(350);
    empties[name] = await p.evaluate(() => document.querySelector(".view:not(.hidden) .sub:not(.hidden), .view:not(.hidden)") ? document.body.innerText : "");
    const r = await noNegatives(p); if (r !== true) { zClean = false; console.log("  ", name, r); }
  }
  check("Z1 fresh install: every Stage 4 screen has a friendly empty state", zClean && await p.evaluate(() => !!document.getElementById("insightsBody").querySelector("#insEmpty")) && /No requests waiting/.test(empties.requests) && /No receipts yet/.test(empties.archive) && /Pick a product/.test(empties.product) && /Finished trips appear here/.test(empties.trip));
  await p.evaluate(() => openSearch("rice")); await sleep(250);
  const zr = await p.$$eval(".search-hit", hs => hs.map(h => h.dataset.group));
  await p.evaluate(() => runSearch("diapers")); await sleep(150);
  check("Z2 fresh install: search finds no products/prices and shows a clear empty state", !zr.includes("Products") && !zr.includes("Receipts") && (await text(p, "#searchResults")).includes("Nothing found"), zr.join(","));
  await p.evaluate(() => closeSheet());
  await p.evaluate(() => goTo("insights")); await sleep(300);
  check("Z3 fresh install: insights never invent numbers", !/₱[1-9]/.test(await text(p, "#insightsBody")));
  check("Z4 fresh install: viewing screens writes nothing", (await stored(p)) === null);
  check("Z5 no JS errors on fresh install", p.errors.length === 0, p.errors.join(" | "));
  await shot(p, "fresh-insights");
  await p.close();

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
