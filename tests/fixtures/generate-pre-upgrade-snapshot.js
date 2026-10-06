/*
  Builds tests/fixtures/pre-upgrade-snapshot.json by driving the PRODUCTION app
  from before Stage 1 (commit b58c49a) through its real UI in headless mobile
  Chrome, with the AI mocked (tests/legacy/mock4.js — no paid calls).

  usage (from the repo root):
    git worktree add /tmp/jason-shop-pre b58c49a
    (cd /tmp/jason-shop-pre && python3 -m http.server 8080 &)
    (cd tests/legacy && OPENAI_API_KEY=sk-test node mock4.js &)
    node tests/fixtures/generate-pre-upgrade-snapshot.js
*/
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const FIX = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ctl = q => fetch("http://localhost:3999/" + q).then(r => r.json());

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 384, height: 854, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("dialog", d => d.accept());
  await p.goto("http://localhost:8080/index.html");
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  const tap = async sel => { const el = await p.$(sel); await el.evaluate(e => e.scrollIntoView({ block: "center" })); await sleep(150); const bb = await el.boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(250); };
  const typeInto = async (sel, v) => { await p.$eval(sel, e => e.value = ""); await tap(sel); const c = await p.target().createCDPSession(); await c.send("Input.insertText", { text: v }); };
  const setVal = (sel, v) => p.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { } await sleep(200); } return false; };
  const listText = () => p.$eval("#shoppingList", e => e.innerText);

  // 1. Budget: ₱60,000 fund, ₱50,000 hard stop
  await typeInto("#fundInput", "60,000"); await typeInto("#stopInput", "50k"); await tap("button[onclick='saveBudget()']");

  // 2. Two researched requests; one bought on Lazada
  for (const q of ["Hanabishi stand fan", "air fryer under 5000 pesos"]) {
    await p.$eval("button.primary[onclick='openAdd()']", e => e.click()); await sleep(150);
    await p.type("#requestText", q); await p.$eval("button[onclick='saveRequest()']", e => e.click());
    await waitFor(async () => (await listText()).split("AI Research ready").length > (q.startsWith("Hana") ? 1 : 2) - 0);
    await sleep(500);
  }
  await waitFor(async () => (await listText()).split("AI Research ready").length >= 3, 20000);
  await tap("#shoppingList button.mini.buy");
  await typeInto("#amountInput", "1,799"); await tap("button[onclick='confirmAmount()']");

  // 3. Receipt read by the (mocked) AI and saved as read: SM Supermarket
  await ctl("set?receipt=clear&product=photo");
  let [fc] = await Promise.all([p.waitForFileChooser(), tap("button[onclick='receiptCamera()']")]);
  await fc.accept([path.join(FIX, "imgs", "receipt.png")]);
  await waitFor(async () => (await p.$eval("#rTotal", e => e.value)) === "2,424");
  await tap("button[onclick='confirmReceipt()']");

  // 4. Second receipt: Jason corrects store + date (Landers, a month earlier)
  await p.$eval("#rTotal", e => e.value = "");
  [fc] = await Promise.all([p.waitForFileChooser(), tap("button[onclick='receiptCamera()']")]);
  await fc.accept([path.join(FIX, "imgs", "receipt.jpg")]);
  await waitFor(async () => (await p.$eval("#rTotal", e => e.value)) === "2,424" && await p.$eval("#receiptModal", e => !e.classList.contains("hidden")));
  await sleep(500);
  await typeInto("#rStore", "Landers Superstore");
  await setVal("#rDate", "2026-09-12");
  await tap("button[onclick='confirmReceipt()']");

  // 5. Manual entries (one in a custom category name typed by Jason later)
  const entry = async (date, amount, store, item, pay) => {
    await tap("button[onclick='openEntry(null)']");
    await setVal("#eDate", date); await typeInto("#eAmount", amount); await typeInto("#eStore", store); await typeInto("#eItem", item); await typeInto("#ePay", pay);
    await tap("button[onclick='saveEntry()']");
  };
  await entry("2026-10-03", "1,200", "Jollibee", "Chickenjoy bucket", "GCash");
  await entry("2026-10-01", "850", "Pampang Palengke", "Pork and vegetables", "Cash");
  await entry("2026-09-20", "3,500", "Mercury Drug", "Vitamins and medicine", "Card");

  // 6. Monthly report AI summary (mocked) and a backup download
  await p.evaluate(() => goTo("report")); await sleep(300);
  await p.evaluate(() => setReportMonth("2026-10")); await sleep(200);
  await tap("#summaryBtn");
  await waitFor(async () => (await p.$eval("#summaryBox", e => e.innerText)).length > 20);
  const cdp = await p.target().createCDPSession(); await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" });
  await p.evaluate(() => backupNow()); await sleep(300);

  const raw = await p.evaluate(() => localStorage.getItem("JasonShopData"));
  const voice = await p.evaluate(() => localStorage.getItem("JasonShopVoice"));
  const d = JSON.parse(raw);
  // thumbnails are real but large; keep one so the size path is exercised
  d.receipts.forEach((r, i) => { if (i > 0) delete r.thumb; });
  d.requests.forEach(r => { delete r.thumb; });
  const out = { generatedFrom: "b58c49a (production app before Stage 1)", generatedAt: new Date().toISOString(), voice: voice ? JSON.parse(voice) : null, data: d };
  fs.writeFileSync(path.join(FIX, "pre-upgrade-snapshot.json"), JSON.stringify(out, null, 1));
  console.log("requests", d.requests.length, "receipts", d.receipts.length, "manual", d.manual.length, "spent", d.spent, "schemaVersion" in d ? "HAS schemaVersion?!" : "v1 (no schemaVersion)");
  console.log("errors", errors);
  await b.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
