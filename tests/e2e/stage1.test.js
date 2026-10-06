/*
  Stage 1 end-to-end tests — headless mobile Chrome (384×854, touch), AI mocked.
  Starts from a REAL pre-upgrade snapshot (tests/fixtures/pre-upgrade-snapshot.json,
  produced by driving the production app b58c49a through its UI).
  Run with: bash tests/run-browser-tests.sh e2e
*/
const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const fs = require("fs");
const revealShim = require("../legacy/reveal-shim");
const FIX = path.join(__dirname, "..", "fixtures");
const OUT = process.env.TEST_OUT || path.join(os.tmpdir(), "jason-shop-tests");
const DL = path.join(OUT, "dl-stage1");
fs.mkdirSync(DL, { recursive: true });
const URL = "http://localhost:8080/index.html";
const SNAP = JSON.parse(fs.readFileSync(path.join(FIX, "pre-upgrade-snapshot.json"), "utf8"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ctl = q => fetch("http://localhost:3999/" + q).then(r => r.json());
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n, x); } };
async function waitFor(fn, ms = 10000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { } await sleep(150); } return false; }

(async () => {
  const b = await puppeteer.launch({ executablePath: revealShim.CHROME, headless: "new", args: ["--no-sandbox"] }); revealShim(b);
  const mk = async (seedText, voice) => {
    const p = await b.newPage();
    await p.setUserAgent("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36");
    await p.setViewport({ width: 384, height: 854, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const cdp = await p.target().createCDPSession(); await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
    p.errors = []; p.on("pageerror", e => p.errors.push(e.message));
    p.on("console", m => { if (m.type() === "error" && !/favicon|status of (4\d\d|5\d\d)|ERR_CONNECTION/.test(m.text())) p.errors.push(m.text()); });
    p.dialogs = []; p.prompts = []; p.confirmAnswer = true;
    p.on("dialog", d => { p.dialogs.push(d.message()); if (d.type() === "prompt") d.accept(p.prompts.shift() || ""); else if (d.type() === "confirm" && !p.confirmAnswer) d.dismiss(); else d.accept(); });
    await p.goto(URL);
    await p.evaluate(async (s, v) => {
      localStorage.clear();
      await new Promise(r => { const q = indexedDB.deleteDatabase("JasonShopVault"); q.onsuccess = q.onerror = q.onblocked = () => r(); });
      if (s !== null) localStorage.setItem("JasonShopData", s);
      if (v) localStorage.setItem("JasonShopVoice", JSON.stringify(v));
    }, seedText, voice || null);
    await p.reload();
    await sleep(600);
    return p;
  };
  const tap = async (p, sel) => { const el = await p.$(sel); if (!el) throw new Error("not found: " + sel); await el.evaluate(e => e.scrollIntoView({ block: "center" })); await sleep(120); const bb = await el.boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(250); };
  const typeInto = async (p, sel, v) => { await p.$eval(sel, e => e.value = ""); await tap(p, sel); const c = await p.target().createCDPSession(); await c.send("Input.insertText", { text: v }); await sleep(60); };
  const setVal = (p, sel, v) => p.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const text = (p, sel) => p.$eval(sel, e => e.innerText);
  const visible = (p, sel) => p.$eval(sel, e => !!e.getClientRects().length && getComputedStyle(e).visibility !== "hidden");
  const D = p => p.evaluate(() => JSON.parse(JSON.stringify(data)));
  const stored = p => p.evaluate(() => JSON.parse(localStorage.getItem("JasonShopData")));
  const shot = (p, name) => p.screenshot({ path: path.join(OUT, "stage1-" + name + ".png") });
  const noNegatives = async p => { const t = await p.evaluate(() => document.body.innerText); return !/[−-]\s?₱\s?\d|₱\s?[−-]\d|NaN|undefined|Infinity/.test(t) ? true : t.match(/.{0,30}([−-]\s?₱\s?\d|₱\s?[−-]\d|NaN|undefined|Infinity).{0,30}/)[0]; };

  /* ================= M. MIGRATION from the real pre-upgrade snapshot ================= */
  const v1 = SNAP.data;
  let p = await mk(JSON.stringify(v1), { lang: "fil", speak: false });
  await waitFor(async () => (await text(p, "#bootBanner")).includes("upgraded"));
  const banner = await text(p, "#bootBanner");
  check("M1 upgrade banner explains what was kept", banner.includes("2 receipts") && banner.includes("3 manual entries") && banner.includes("2 shopping requests") && banner.includes("₱12,197") && banner.includes("safety copy"), banner);
  let s = await stored(p);
  check("M2 saved data is schema v2", s.schemaVersion === 2);
  check("M3 every legacy record kept unchanged", JSON.stringify(s.requests) === JSON.stringify(v1.requests) && JSON.stringify(s.receipts) === JSON.stringify(v1.receipts) && JSON.stringify(s.manual) === JSON.stringify(v1.manual));
  check("M4 fund / stop / spent / lastBackup kept", s.fund === v1.fund && s.stop === v1.stop && s.spent === v1.spent && s.lastBackup === v1.lastBackup);
  check("M5 7 stores, categories, household seeded", s.stores.length === 7 && s.budgetCategories.length >= 10 && s.houses.length === 1 && s.memberGroups.length === 8);
  check("M6 price book learned from receipts (3 products, 6 prices, all 'receipt')", s.products.length === 3 && s.priceRecords.length === 6 && s.priceRecords.every(r => r.source === "receipt" && r.status === "confirmed"));
  check("M7 Landers receipt linked to the Landers store", s.priceRecords.filter(r => r.storeId === "store_landers").length === 3 && s.priceRecords.filter(r => r.storeName === "SM Supermarket" && !r.storeId).length === 3);
  const snaps = await p.evaluate(() => JasonStore.listSnapshots());
  check("M8 pre-migration safety copy in IndexedDB with v1 counts", snaps.length === 1 && snaps[0].reason === "before upgrade v1 → v2" && snaps[0].counts.receipts === 2);
  const snapJson = await p.evaluate(id => JasonStore.getSnapshot(id).then(x => x.json), snaps[0].id);
  check("M9 safety copy is the untouched original text", snapJson === JSON.stringify(v1));
  check("M10 backup log + audit record the upgrade", s.backupLog.some(l => l.action === "Migration backup created" && l.status === "success") && s.auditLog.some(a => a.action === "data.upgraded"));
  check("M11 voice settings untouched", (await p.evaluate(() => localStorage.getItem("JasonShopVoice"))).includes("fil"));
  await p.reload(); await sleep(600);
  s = await stored(p);
  check("M12 reload: no second migration, no second snapshot", s.meta.migrations.length === 1 && (await p.evaluate(() => JasonStore.listSnapshots())).length === 1 && (await text(p, "#bootBanner")) === "");
  check("M13 no JS errors after upgrade", p.errors.length === 0, p.errors.join(" | "));

  /* ================= H. HOME dashboard: real numbers ================= */
  check("H1 Safe to spend = min(60k−12,197, 50k−12,197) = ₱37,803", (await text(p, "#safe")) === "₱37,803", await text(p, "#safe"));
  check("H2 status SAFE with % used (text + icon)", (await text(p, "#status")).includes("✅ SAFE") && (await text(p, "#status")).includes("24% used"), await text(p, "#status"));
  check("H3 tiles: fund, spent, committed, reserve, available cash", (await text(p, "#fundDisplay")) === "₱60,000" && (await text(p, "#spentDisplay")) === "₱12,197" && (await text(p, "#committedDisplay")) === "₱0" && (await text(p, "#reserveDisplay")) === "₱0" && (await text(p, "#availableDisplay")) === "₱47,803");
  check("H4 usage bar visible with legend", await visible(p, "#usageWrap") && (await text(p, "#usageLegend")).includes("of ₱50,000 hard stop"));
  const home = await text(p, "#homeCards");
  check("H5 home cards: plan empty state, household setup, Price Book, recent spending", home.includes("No budget plan yet") && home.includes("Set up your household") && home.includes("3 products") && home.includes("Recent spending"), home);
  check("H6 this period spending tile (Oct 1 – Oct 31) = ₱6,273", (await text(p, "#monthLabelSmall")).includes("OCT 1") && (await text(p, "#monthDisplay")) === "₱6,273", await text(p, "#monthDisplay"));
  await shot(p, "home");

  /* ================= A. AI command bar (local answers, no paid call) ================= */
  await ctl("clear");
  await typeInto(p, "#cmdInput", "can I afford 5000"); await tap(p, ".cmd-send");
  check("A1 'can I afford 5000' answered on the phone: Yes", (await text(p, "#cmdAnswer")).includes("Yes.") && (await text(p, "#cmdAnswer")).includes("₱32,803"), await text(p, "#cmdAnswer"));
  await typeInto(p, "#cmdInput", "can I afford ₱40k?"); await tap(p, ".cmd-send");
  check("A2 'afford ₱40k' → No, over the limit by ₱2,197", (await text(p, "#cmdAnswer")).includes("No.") && (await text(p, "#cmdAnswer")).includes("over the limit by ₱2,197"), await text(p, "#cmdAnswer"));
  await typeInto(p, "#cmdInput", "how much is left?"); await tap(p, ".cmd-send");
  check("A3 'how much is left' → Safe to spend breakdown", (await text(p, "#cmdAnswer")).includes("Safe to spend: ₱37,803"));
  check("A4 no AI calls were made for these", (await ctl("seen")).length === 0);
  check("A5 camera + add shortcuts present in the command bar", !!(await p.$(".cmd-chips button[onclick='productCamera()']")) && !!(await p.$(".cmd-chips button[onclick='receiptCamera()']")));

  /* ================= C. COMMITTED purchases ================= */
  await p.evaluate(() => goTo("commitments")); await sleep(300);
  await tap(p, "button[onclick='openCommitment(null)']");
  await typeInto(p, "#cmTitle", "Landers monthly haul"); await typeInto(p, "#cmAmount", "5k");
  await p.select("#cmCat", "Groceries"); await p.select("#cmStore", "store_landers");
  await tap(p, "#sheetBody button.primary");
  check("C1 commitment lowers Safe to spend to ₱32,803", (await text(p, "#safe")) === "₱32,803" && (await text(p, "#committedDisplay")) === "₱5,000");
  check("C2 listed with store and Paid / Cancel", (await text(p, "#commitmentsCard")).includes("Landers monthly haul") && (await text(p, "#commitmentsCard")).includes("Landers") && !!(await p.$("button[onclick^='payCommitment']")));
  check("C3 breakdown shows − Committed ₱5,000", (await text(p, "#safeBreakdown")).includes("− Committed purchases\t₱5,000") || (await text(p, "#safeBreakdown")).replace(/\s+/g, " ").includes("− Committed purchases ₱5,000"));
  // hard-stop guard for commitments
  await tap(p, "button[onclick='openCommitment(null)']");
  await typeInto(p, "#cmTitle", "Big TV"); await typeInto(p, "#cmAmount", "40,000"); await tap(p, "#sheetBody button.primary");
  check("C4 commitment past the hard stop needs a second tap", (await text(p, "#sheetMsg")).includes("past your hard stop") && (await D(p)).commitments.length === 1, JSON.stringify([await p.evaluate(()=>document.getElementById("sheetMsg") && document.getElementById("sheetMsg").innerText), (await D(p)).commitments.map(c=>c.title+" "+c.amount), await p.evaluate(()=>document.getElementById("sheetModal").className)]));
  await tap(p, "button[onclick='closeSheet()']");
  await tap(p, "button[onclick^='payCommitment']");
  let d = await D(p);
  check("C5 Paid → moves to Spent (₱17,197) and History, committed ₱0", d.spent === 17197 && d.commitments[0].status === "paid" && d.manual[0].fromCommitment === d.commitments[0].id && (await text(p, "#committedDisplay")) === "₱0");
  check("C6 safe to spend unchanged by paying (₱32,803)", (await text(p, "#safe")) === "₱32,803");

  /* ================= R. PROTECTED reserve + OVER LIMIT ================= */
  await tap(p, "button[onclick='openReserve(null)']");
  await typeInto(p, "#rsName", "Emergency"); await typeInto(p, "#rsAmount", "20k"); await tap(p, "#sheetBody button.primary");
  check("R1 reserve: safe = 60k − 17,197 − 20k = ₱22,803", (await text(p, "#safe")) === "₱22,803" && (await text(p, "#reserveDisplay")) === "₱20,000");
  const rid = (await D(p)).reserves[0].id;
  await tap(p, `button[onclick="openReserve('${rid}')"]`); await typeInto(p, "#rsAmount", "50,000"); await tap(p, "#sheetBody button.primary");
  check("R2 over the limit: #safe shows ₱0, never negative", (await text(p, "#safe")) === "₱0");
  check("R3 'OVER LIMIT BY ₱7,197' shown", (await text(p, "#overLimit")).includes("OVER LIMIT BY ₱7,197") && (await text(p, "#safeBreakdown")).includes("OVER LIMIT BY ₱7,197"));
  check("R4 HARD STOP ACTIVE state", (await text(p, "#status")).includes("HARD STOP ACTIVE"));
  check("R5 no negative peso amounts anywhere", (await noNegatives(p)) === true, await noNegatives(p));
  await shot(p, "over-limit");
  await tap(p, `button[onclick="openReserve('${rid}')"]`); await typeInto(p, "#rsAmount", "20,000"); await tap(p, "#sheetBody button.primary");
  check("R6 back to ₱22,803 after lowering reserve", (await text(p, "#safe")) === "₱22,803");

  /* ================= T. Warning thresholds ================= */
  await typeInto(p, "#thWatch", "90"); await typeInto(p, "#thWarning", "80"); await tap(p, "button[onclick='saveThresholds()']");
  check("T1 invalid levels rejected with a clear message", (await text(p, "#thMsg")).includes("WATCH must be lower than WARNING") && (await D(p)).settings.thresholds.watch === 70);
  await typeInto(p, "#thWatch", "20"); await typeInto(p, "#thWarning", "30"); await typeInto(p, "#thHard", "100"); await tap(p, "button[onclick='saveThresholds()']");
  check("T2 custom levels → 43% used is WARNING", (await text(p, "#status")).includes("WARNING") && (await text(p, "#status")).includes("43% used"), await text(p, "#status"));
  await tap(p, "button[onclick='resetThresholds()']");
  check("T3 reset to 70/85/100 → SAFE", (await text(p, "#status")).includes("SAFE") && JSON.stringify((await D(p)).settings.thresholds) === JSON.stringify({ watch: 70, warning: 85, hardStop: 100 }));

  /* ================= P. BUDGET PLAN allocation ================= */
  await tap(p, "#navBudget"); await tap(p, "#view-budget [data-subtab='plan']");
  check("P1 plan base = fund − reserve = ₱40,000", (await text(p, "#planEditor")).includes("₱40,000"));
  await typeInto(p, "#al_cat_groceries", "20000"); await typeInto(p, "#al_cat_food_and_dining", "5,000");
  check("P2 unallocated message (₱15,000)", (await text(p, "#planTotals")).includes("UNALLOCATED: ₱15,000"), await text(p, "#planTotals"));
  await typeInto(p, "#al_cat_groceries", "40k");
  check("P3 over-allocated message (₱5,000)", (await text(p, "#planTotals")).includes("OVER-ALLOCATED by ₱5,000"));
  await tap(p, "#previewPlanBtn");
  check("P4 cannot preview/save while over-allocated", (await text(p, "#planPreview")).includes("Fix this first") && (await D(p)).budgetPlan.items.length === 0);
  await typeInto(p, "#al_cat_groceries", "25,000");
  await tap(p, "#previewPlanBtn");
  check("P5 preview table before saving (nothing saved yet)", (await text(p, "#planPreview")).includes("nothing is saved yet") && (await text(p, "#planPreview")).includes("₱30,000") && (await D(p)).budgetPlan.items.length === 0);
  await tap(p, "#confirmPlanBtn");
  d = await D(p);
  check("P6 saved after confirm: 2 categories, peso mode", d.budgetPlan.items.length === 2 && d.budgetPlan.mode === "peso" && d.budgetPlan.items.find(i => i.categoryId === "cat_groceries").value === 25000);
  const planTxt = await text(p, "#planBody");
  check("P7 period view shows Groceries spent vs plan (₱8,274 of ₱25,000)", planTxt.includes("₱8,274 spent") && planTxt.includes("of ₱25,000"), planTxt.slice(0, 600));
  await tap(p, "#modePct");
  check("P8 switching to % converts values (62.5%)", (await p.$eval("#al_cat_groceries", e => e.value)) === "62.5");
  await tap(p, "#modePeso");
  check("P9 home shows the plan snapshot", (await text(p, "#homeCards")).includes("Budget plan") && (await text(p, "#homeCards")).includes("Groceries"));
  await shot(p, "plan");

  /* ================= S. MY STORES ================= */
  await tap(p, "#navShop"); await tap(p, "#view-shop [data-subtab='stores']");
  let st = await text(p, "#storesBody");
  check("S1 7 seeded stores with tendencies labelled as tendencies", ["Newstar Shopping Mart", "Johnny's Supermarket", "Pampang Public Market", "Landers Superstore Angeles", "S&R Membership Shopping", "Puregold", "Puregold Duty Free Clark"].every(n => st.includes(n)) && st.includes("Usually good for (tendency)"));
  check("S2 stats computed from purchases (Landers 2 · ₱7,424 incl. paid commitment, Pampang 1 · ₱850)", /Landers Superstore Angeles[\s\S]*?2 purchases[\s\S]*?₱7,424/.test(st) && /Pampang Public Market[\s\S]*?1 purchase[\s\S]*?₱850/.test(st), st.slice(0, 900));
  check("S3 unknown stores listed, not auto-added", st.includes("Other stores in your history") && st.includes("SM Supermarket") && st.includes("Mercury Drug") && (await D(p)).stores.length === 7);
  await tap(p, "button[onclick*='SM Supermarket']");
  check("S4 add store form prefilled", (await p.$eval("#stName", e => e.value)) === "SM Supermarket");
  await tap(p, "#stT0"); await tap(p, "#sheetBody button.primary");
  st = await text(p, "#storesBody");
  d = await D(p);
  check("S5 custom store added and now has its stats", d.stores.length === 8 && d.stores[7].custom === true && /SM Supermarket[\s\S]*?1 purchase/.test(st) && !/Other stores[\s\S]*SM Supermarket/.test(st));
  await tap(p, ".store-card[onclick*='store_landers']");
  check("S6 store detail: products bought here", (await text(p, "#sheetBody")).includes("Products bought here (3)"));
  await tap(p, "#sheetBody button[onclick='closeSheet()']");

  /* ================= B. PRICE BOOK ================= */
  await tap(p, "#view-shop [data-subtab='prices']");
  check("B1 3 products listed", (await p.$$eval("#pbList .product-card", x => x.length)) === 3);
  await typeInto(p, "#pbSearch", "rice");
  check("B2 search narrows to 1", (await p.$$eval("#pbList .product-card", x => x.length)) === 1);
  await tap(p, "#pbList .product-card");
  let sh = await text(p, "#sheetBody");
  check("B3 per-kg price from size read off the name (₱69/kg)", sh.includes("₱69/kg") && sh.includes("Compared per kg"), sh.slice(0, 400));
  check("B4 every price shows its source", (sh.match(/From receipt/g) || []).length === 2);
  check("B5 'no change' trend with 2 equal prices; tie shown honestly", sh.includes("no change") && sh.includes("Same price at 2 stores"));
  await tap(p, "#sheetBody button[onclick^='openPrice']");
  await typeInto(p, "#prPrice", "360"); await p.select("#prStore", "store_puregold"); await p.select("#prSource", "shelf");
  await tap(p, "#sheetBody button.primary");
  sh = await text(p, "#sheetBody");
  check("B6 manual shelf price added → trend up 4.35%", sh.includes("up 4.35%") && sh.includes("Shelf price you saw") && sh.includes("₱72/kg"), sh.slice(0, 500));
  check("B7 cheapest store stays the lower one (not Puregold)", !/Cheapest store\s*Puregold/.test(sh));
  // duplicates / different products are never merged
  await tap(p, "#sheetBody button[onclick='closeSheet()']");
  await p.evaluate(() => { priceFilter = ""; renderPrices(); });
  await tap(p, "button[onclick='openProductEdit(null)']");
  await typeInto(p, "#pdName", "Rice Jasmine 5kg"); await typeInto(p, "#pdSize", "5"); await p.select("#pdUnit", "kg");
  await tap(p, "#sheetBody button.primary");
  check("B8 exact duplicate blocked", (await text(p, "#sheetMsg")).includes("already exists") && (await D(p)).products.length === 3);
  await typeInto(p, "#pdSize", "10"); await tap(p, "#sheetBody button.primary");
  check("B9 same name, different size → asks before keeping separately", (await text(p, "#sheetMsg")).includes("kept as separate products"));
  await tap(p, "#sheetBody button.primary");
  check("B10 saved as a separate product", (await D(p)).products.length === 4);
  await tap(p, "#sheetBody button[onclick='closeSheet()']");
  await shot(p, "pricebook");

  /* ================= F. HOUSEHOLD profile ================= */
  await p.evaluate(() => goTo("household")); await sleep(300);
  await tap(p, `button[onclick="stepGroup('grp_main_adults',1)"]`); await tap(p, `button[onclick="stepGroup('grp_main_adults',1)"]`);
  await setVal(p, "#gc_grp_main_children", "3");
  await tap(p, `button[onclick="stepGroup('grp_main_maids',1)"]`);
  await tap(p, `button[onclick="stepGroup('grp_main_pets',1)"]`);
  let hh = await text(p, "#householdBody");
  check("F1 counts editable: 6 people (2 adults, 3 children, 1 staff) + 1 pet", hh.includes("6 people · 2 adults · 3 children · 1 staff · 1 pets"), hh.slice(0, 200));
  await setVal(p, "#gc_grp_main_children", "-2");
  check("F2 invalid count refused", (await D(p)).memberGroups.find(g => g.id === "grp_main_children").count === 3);
  p.prompts.push("Clark house");
  await tap(p, "button[onclick='addHouse()']");
  d = await D(p);
  check("F3 second house with its own groups", d.houses.length === 2 && d.houses[1].name === "Clark house" && d.memberGroups.filter(g => g.houseId === d.houses[1].id).length === 8 && (await text(p, "#householdBody")).includes("Clark house"));
  p.prompts.push("Guests");
  await tap(p, `button[onclick="addGroup('house_main')"]`);
  check("F4 custom member group", (await D(p)).memberGroups.some(g => g.label === "Guests" && g.type === "custom"));
  check("F5 home shows household summary", (await p.evaluate(() => { renderHomeCards(); return document.getElementById("homeCards").innerText; })).includes("6 people"));
  await shot(p, "household");

  /* ================= D. DATA & BACKUP ================= */
  await tap(p, "#navMore"); await tap(p, "#more_data");
  await waitFor(async () => (await text(p, "#snapList")).includes("before upgrade"));
  check("D1 safety copies listed (pre-upgrade)", (await text(p, "#snapList")).includes("before upgrade v1 → v2"));
  check("D2 cloud backup honestly marked NEEDS SETUP", (await text(p, "#dataBody")).includes("NEEDS SETUP"));
  await tap(p, "button[onclick='runIntegrity()']");
  check("D3 integrity check: no problems", (await text(p, "#integrityOut")).includes("No problems found"), await text(p, "#integrityOut"));
  fs.readdirSync(DL).forEach(f => fs.unlinkSync(path.join(DL, f)));
  await tap(p, "#backupCard button[onclick='backupNow()']");
  await waitFor(async () => fs.readdirSync(DL).some(f => f.endsWith(".json")));
  const bfile = path.join(DL, fs.readdirSync(DL).find(f => f.endsWith(".json")));
  const btext = fs.readFileSync(bfile, "utf8");
  const bk = JSON.parse(btext);
  check("D4 backup: v1-compatible envelope + format 2 + counts + checksum", bk.app === "Jason Shop" && bk.version === 1 && bk.format === 2 && bk.schemaVersion === 2 && bk.counts.priceRecords === 7 && bk.counts.products === 4 && bk.checksum.value.length === 8 && Object.keys(bk).pop() === "data");
  const restoreFile = async file => { const [fc] = await Promise.all([p.waitForFileChooser(), tap(p, "button[onclick=\"document.getElementById('restoreFile').click()\"]")]); await fc.accept([file]); await sleep(900); };
  const before = await D(p);
  // change something, then restore the backup → change undone
  await p.evaluate(() => { data.fund = 1; save(); });
  p.dialogs = [];
  await restoreFile(bfile);
  d = await D(p);
  check("D5 restore preview lists counts incl. prices/products", p.dialogs.some(m => m.includes("2 shopping items, 2 receipts, 4 manual entries, Spent ₱17,197, 7 prices, 4 products")), p.dialogs.join(" || "));
  check("D6 restored: data back, counts match", d.fund === 60000 && d.priceRecords.length === before.priceRecords.length && d.products.length === 4 && (await text(p, "#backupMsg")).includes("Restored backup"));
  check("D7 safety copy before restore", !!(await p.evaluate(() => localStorage.getItem("JasonShopData.beforeRestore"))) && (await p.evaluate(() => JasonStore.listSnapshots())).some(x => x.reason === "before restore"));
  check("D8 backup history logged (started → completed)", d.backupLog.some(l => l.action === "Restore started") && d.backupLog.some(l => l.action === "Restore completed" && l.status === "success"));
  // tampered backup: a receipt removed but the header still says 2
  const cut = JSON.parse(btext); cut.data.receipts.pop(); fs.writeFileSync(path.join(OUT, "cut.json"), JSON.stringify(cut));
  await restoreFile(path.join(OUT, "cut.json"));
  check("D9 backup with missing records refused, nothing changed", (await text(p, "#backupMsg")).includes("failed its safety checks") && (await D(p)).receipts.length === 2);
  // edited backup (checksum mismatch) → asks; say no
  const edited = JSON.parse(btext); edited.data.fund = 999; fs.writeFileSync(path.join(OUT, "edited.json"), JSON.stringify(edited));
  p.confirmAnswer = false; p.dialogs = [];
  await restoreFile(path.join(OUT, "edited.json"));
  p.confirmAnswer = true;
  check("D10 edited backup: checksum warning, cancelled → unchanged", p.dialogs.some(m => m.includes("checksum")) && (await D(p)).fund === 60000);
  // old backup from the pre-upgrade app → upgraded on restore
  fs.writeFileSync(path.join(OUT, "old-v1.json"), JSON.stringify({ app: "Jason Shop", type: "backup", version: 1, exportedAt: "2026-10-06T04:00:00.000Z", data: v1 }));
  await restoreFile(path.join(OUT, "old-v1.json"));
  d = await D(p);
  check("D11 old-version backup restores and is upgraded (prices learned)", d.schemaVersion === 2 && d.receipts.length === 2 && d.manual.length === 3 && d.priceRecords.length === 6 && d.backupLog.some(l => (l.detail || "").includes("upgraded from data version 1")));
  // storage failure mid-restore → automatic rollback
  const keep = await p.evaluate(() => localStorage.getItem("JasonShopData"));
  await p.evaluate(() => { const orig = Storage.prototype.setItem; window.__origSet = orig; Storage.prototype.setItem = function (k, v) { if (k === "JasonShopData" && window.__failSave) throw new DOMException("full", "QuotaExceededError"); return orig.call(this, k, v); }; window.__failSave = true; });
  await restoreFile(bfile);
  await p.evaluate(() => { window.__failSave = false; Storage.prototype.setItem = window.__origSet; });
  check("D12 failed restore rolls back automatically", (await text(p, "#backupMsg")).includes("previous data was put back") && (await p.evaluate(() => localStorage.getItem("JasonShopData"))) === keep && (await D(p)).priceRecords.length === 6);
  check("D13 failure recorded in backup history", (await D(p)).backupLog.some(l => l.action === "Restore failed" && l.status === "rolled back"));
  await p.evaluate(() => renderDataBackup()); await sleep(400);
  check("D14 backup history visible", (await text(p, "#dataBody")).includes("Restore completed") && (await text(p, "#dataBody")).includes("Restore failed"));
  await shot(p, "data");

  /* ================= U. AUDIT trail ================= */
  await restoreFile(bfile);   // back to the full dataset
  await p.evaluate(() => goTo("audit")); await sleep(300);
  const au = await text(p, "#auditBody");
  check("U1 audit lists money + data changes", ["Committed ₱5,000", "Paid commitment", "Protected reserve added", "Budget plan saved", "upgraded", "Restored backup", "Price added", "House added"].every(x => au.includes(x)), au.slice(0, 800));
  await tap(p, "#auditBody .seg button:nth-child(2)");
  check("U2 money filter", (await text(p, "#auditBody")).includes("Paid commitment") && !(await text(p, "#auditBody")).includes("House added"));

  /* ================= N. NAVIGATION shell ================= */
  const navs = [["navHome", "home"], ["navShop", "shop"], ["navInventory", "inventory"], ["navBudget", "budget"], ["navAI", "ai"], ["navMore", "more"]];
  let navOk = true;
  for (const [id, v] of navs) {
    await tap(p, "#" + id); await sleep(200);
    const ok = await p.evaluate((id, v) => document.querySelector(`section.view[data-view="${v}"]`).classList.contains("active") && document.getElementById(id).classList.contains("active") && document.getElementById(id).getAttribute("aria-current") === "page" && document.querySelectorAll("section.view.active").length === 1, id, v);
    if (!ok) { navOk = false; console.log("  nav problem", id); }
    await shot(p, "tab-" + v);
  }
  check("N1 six tabs switch views and mark the active tab", navOk);
  check("N2 tabs fit a 384px screen", await p.evaluate(() => { const n = document.querySelector("nav"); return n.querySelectorAll("button").length === 6 && n.scrollWidth <= n.clientWidth + 1 && [...n.querySelectorAll("button")].every(b => b.getBoundingClientRect().width >= 50); }));
  const menuTxt = await text(p, "#moreMenu");
  check("N3 More menu lists all sections", ["Household profile", "My stores", "Price Book", "Budget plan", "Data & Backup", "Change history", "Settings"].every(x => menuTxt.includes(x)), menuTxt);
  await tap(p, "#more_settings");
  check("N4 settings screen", (await text(p, "#settingsBody")).includes("Warning levels"));
  await tap(p, "#navMore");
  check("N5 tapping More again returns to the menu", await visible(p, "#moreMenu"));
  await tap(p, "#navInventory");
  check("N6 Inventory placeholder has an honest empty state", (await text(p, "#inventoryBody")).includes("coming next"));
  for (const sec of ["shopping", "receipts", "budget", "history", "report", "backup"]) {
    await p.evaluate(s => goTo(s), sec); await sleep(250);
  }
  check("N7 old section names still work (goTo backup → Data & Backup)", await visible(p, "#backupCard"));
  check("N8 no negative / NaN text on any screen", (await noNegatives(p)) === true, await noNegatives(p));
  check("N9 no JS errors in the whole Stage 1 run", p.errors.length === 0, p.errors.join(" | "));
  await p.close();

  /* ================= E. FRESH INSTALL + damaged data ================= */
  p = await mk(null);
  check("E1 fresh install: no upgrade banner, setup state", (await text(p, "#bootBanner")) === "" && (await text(p, "#status")).includes("Ready for setup"));
  let emptyOk = true;
  for (const [v, sub] of [["home"], ["shop", "stores"], ["shop", "prices"], ["shop", "list"], ["inventory"], ["budget", "overview"], ["budget", "plan"], ["more", "household"], ["more", "data"], ["more", "audit"]]) {
    await p.evaluate((v, sub) => showView(v, sub || null), v, sub); await sleep(150);
    const r = await noNegatives(p); if (r !== true) { emptyOk = false; console.log("  ", v, sub, r); }
  }
  check("E2 every screen renders cleanly with no data (no NaN/negatives)", emptyOk);
  await p.evaluate(() => showView("shop", "prices"));
  check("E3 Price Book empty state explains where prices come from", (await text(p, "#pricesBody")).includes("never makes up prices"));
  check("E4 fresh data is v2 with seeds (saved on first change, like before)", (await D(p)).schemaVersion === 2 && (await D(p)).stores.length === 7 && (await stored(p)) === null);
  await p.evaluate(() => { data.fund = 1000; save(); });
  check("E4b first save writes v2", (await stored(p)).schemaVersion === 2 && (await stored(p)).fund === 1000);
  check("E5 no JS errors on fresh install", p.errors.length === 0, p.errors.join(" | "));
  await p.close();

  p = await mk("{this is not json");
  check("E6 damaged saved data: app starts, warns, keeps the damaged copy", (await text(p, "#bootBanner")).includes("couldn't be read") && await p.evaluate(() => Object.keys(localStorage).some(k => k.startsWith("JasonShopData.damaged.") && localStorage.getItem(k) === "{this is not json")));
  await p.close();

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
