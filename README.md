# Jason-Shop

Jason Shop is a personal AI shopping manager: ask for a product by **voice** or text, and the backend researches it across Philippine and international stores, compares price, specs, reviews and value, and gives a BUY / WAIT / WATCH / SKIP recommendation. The app also tracks the shopping fund, spending and a hard-stop limit.

## Files

| File | What it is |
|---|---|
| `index.html` | The app shell and screens (static frontend, Render service `jason-shop`). |
| `css/app.css` | All styles (mobile-first). |
| `js/calc.js` | **The one place for money & household math** (pure, unit-tested): unit prices and conversions, safe to spend, available cash, category / cycle remaining, variance, allocation, warning states, price statistics, household size; Stage 2: shopping cycles, daily use (learned / per person / manual, scaled to the household), days of supply, stock status, smart reorder, forecasts, expiry, list totals, fit-to-budget, duplicate warnings, trip totals, planned vs actual. |
| `js/model.js` | Data model: schema version, migrations, seeds (stores, categories, household), product/price matching (High / Review / Unknown confidence), duplicate-receipt detection, integrity check, backup file format. Pure, unit-tested. |
| `js/storage.js` | On-phone safety vault (IndexedDB) for safety copies, storage estimate. |
| `js/features.js` | Stage 1 screens: navigation, home dashboard, AI command bar, household, stores, price book, budget plan, commitments, reserve, warning levels, audit trail, Data & Backup. |
| `js/features2.js` | Stage 2 screens: inventory, smart shopping list, Shopping Trip Mode, shopping cycle (planned vs actual), receipt-match review, Home stock/cycle cards, stock answers in the command bar. |
| `js/app.js` | The original app logic (voice, research, photos, receipts, history, report, backup/restore), now using `calc.js`/`model.js`. |
| `server.js` | The API (Node/Express, Render service `jason-shop-api`). |
| `package.json` | Backend dependencies (`express`, `cors`, `multer`). |
| `tests/` | Unit tests (no dependencies) and headless mobile-Chrome tests (own `package.json`, so Render's backend install is unaffected). |

The frontend is still plain static files (no build step), so the Render static site keeps working as before. Scripts load in this order: `calc.js`, `model.js`, `storage.js`, `features.js`, `features2.js`, `app.js`.

## API

| Endpoint | Purpose |
|---|---|
| `GET /` and `GET /api/health` | Status checks |
| `POST /api/research/start` | `{ "query": "...", "budget": { "fund", "spent", "stop", "committed", "reserve" } }` → `{ jobId }` straight away (research runs in the background). Committed purchases and the protected reserve are treated as not spendable. |
| `GET /api/research/status/:jobId` | `researching` → `complete` (with `report`, a short `summary` for reading aloud and a shopping `category`) or `error` |
| `POST /api/research` | Same research in one long request (kept for compatibility) |
| `POST /api/photo/start` | multipart: `image` (JPG/PNG/WebP, max 8 MB) + `kind` = `product` or `receipt` → `{ jobId }` |
| `GET /api/jobs/:jobId` | Result of any background job: `product` (name, brand, model, specs, shop listing price/seller) or `receipt` (store, date, items, subtotal, VAT, total, payment, warnings); both include a shopping `category` |
| `POST /api/report/summary` | `{ "stats": { monthLabel, total, count, fund, lastMonthTotal, dailyAverage, byCategory, topStores, biggest } }` → `{ jobId }`; the job returns `{ text }`, a 2–3 sentence summary. Only called when Jason taps the button |
| `POST /api/transcribe` | multipart form with an `audio` file (webm/mp4/ogg/wav/mp3, max 10 MB) and optional `language` (`en`/`fil`) → `{ "text": "..." }` |
| `POST /api/budget/check` | Budget status (SAFE / WARNING / HARD_STOP) |
| `POST /api/receipt` | Placeholder |

## Voice

- Tap the big mic, speak, then tap again (or just stop talking). The words appear live.
- After 3 seconds the request is sent automatically, the same as a typed request. Tap **✏️ Edit** to fix the words first, or **✕** to cancel.
- **English** or **Filipino / Taglish** can be chosen under the mic.
- **🔊 Read answers aloud** (on by default) reads a short summary of the recommendation when research finishes.
- Chrome on Android uses the phone's built-in speech recognition (free). If a browser doesn't support it (for example Samsung Internet), the app records the audio and the backend transcribes it with OpenAI (`/api/transcribe`).
- To test the recording fallback in Chrome, open the app with `?voice=record` at the end of the address.

## Environment variables (backend)

| Name | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Used for research and for voice transcription. Never commit it. |
| `OPENAI_MODEL` | No | Research model. Defaults to `gpt-5.6`. |
| `OPENAI_FALLBACK_MODEL` | No | Used only if OpenAI rejects `OPENAI_MODEL`. Defaults to `gpt-5-mini`. |
| `OPENAI_MAX_OUTPUT_TOKENS` | No | Defaults to `10000` (reasoning + web search need room; the report is retried once with double if the AI runs out). |
| `OPENAI_REASONING_EFFORT` | No | Defaults to `low` (faster, cheaper). |
| `OPENAI_VISION_MAX_OUTPUT_TOKENS` | No | Photo/receipt reading. Defaults to `6000`. |
| `OPENAI_TRANSCRIBE_MODEL` | No | Defaults to `gpt-4o-mini-transcribe`. `whisper-1` also works. |
| `PORT` | No | Set automatically by Render. |

## Run locally

```bash
npm install
OPENAI_API_KEY=sk-... npm start          # API on http://localhost:3000
python3 -m http.server 8080              # app on http://localhost:8080 (talks to localhost:3000 automatically)
```

## Photos

- **📷 Product**: take a photo or pick a screenshot. The AI names the product (brand, model, type, key specs). For Shopee/Lazada screenshots it also reads the listed price and seller. Check or fix the details, then **Research this** runs the normal research (within the budget) and compares the listing price with other stores.
- **🧾 Receipt**: snap a receipt. The AI reads the store, date, items, subtotal, VAT, total and payment method into an editable card. **Save** adds the total to Spent (untick to skip) and keeps the receipt with a thumbnail in Receipt Manager. Deleting a receipt takes its amount off Spent. Blurry or non-receipt photos get a Retake / Enter manually option.
- Photos are shrunk on the phone to max 1600 px JPEG before upload. The server keeps them only in memory for the AI call and never logs or stores them. Small thumbnails are saved on the phone only.

## Navigation

Bottom tabs: **🏠 Home · 🛍️ Shop · 📦 Inventory · 💰 Budget · 🤖 AI · ☰ More**.

| Tab | What's there |
|---|---|
| Home | Safe to Spend with a usage bar (WATCH / WARNING ticks), fund / spent / committed / reserve / available cash / this period, the **Ask Jason Shop** command bar (type, mic, 📷 product, 🧾 receipt), trip in progress, home stock alerts, cycle + list summary, receipt lines to check, budget plan snapshot, commitments, household, Price Book highlights, recent spending. Only real numbers; empty states otherwise. |
| Shop | **Stores**, **Price Book**, **Receipts** (Receipt Manager + match review), **List** (smart shopping list), **🛒 Trip** (Shopping Trip Mode). |
| Inventory | Home stock with status, days of supply, expiry, forecasts and smart reorder. |
| Budget | **Overview** (budget form, how Safe to Spend is worked out, committed purchases, protected reserve, warning levels), **Plan** (category allocation, categories, budget period), **Cycle** (shopping cycle, planned vs actual, cycle + stock-alert settings), **History**, **Report**. |
| AI | The shopping inbox: research requests, photo items, Mark purchased. |
| More | Household profile, My stores, Price Book, Budget plan, Shopping cycle, **Data & Backup**, Change history (audit), Settings. |

Old section names still work in code (`goTo("history")`, `goTo("backup")`…).

## Budget

- Amounts can be typed as `500000`, `500,000`, `₱500,000`, `500k` or `1.5m`.
- **Safe to spend = fund − spent − committed − reserve**, and never more than **hard stop − spent − committed** (the lower one applies). It never shows a negative number: when over, it shows **₱0** plus **"OVER LIMIT BY ₱X"**.
- **Available cash** = fund − spent (money still in the fund, including committed and reserved money).
- **Warning levels** (percent of the limit used by spent + committed) are editable. Defaults: 0–69 ✅ SAFE, 70–84 👀 WATCH, 85–99 ⚠️ WARNING, 100 ⛔ HARD STOP. Every state shows an icon and words, not only a colour. Recording a purchase or commitment past the hard stop needs a second tap.
- **Committed purchases**: money promised but not paid (orders, deposits, a planned haul). Taken off Safe to Spend straight away. **✅ Paid** moves it into Spent and Purchase History; **Cancel** releases it.
- **Protected reserve**: money in the fund that is never counted as spendable.
- **Budget plan**: split *fund − reserve* across categories in pesos or percent. It shows unallocated / over-allocated amounts live, and saves only after a **preview**. The plan repeats each period (monthly, configurable start day, e.g. payday). Each category shows spent + committed vs plan, the remaining amount, its state, and whether you're under or over plan. Categories can be renamed (history follows), added or hidden.
- **AI command bar**: "can I afford 5000?" and "how much is left?" are answered on the phone (no AI call). Anything else becomes a research request, and the research AI is told about committed money and the reserve.

## Household, stores and prices

- **Household profile**: one or more houses, each with editable counts of adults, children, nannies, maids, security, drivers, other staff and pets, plus custom groups and optional forecast weights.
- **My stores**: Newstar, Johnny's, Pampang Palengke, Landers (Angeles), S&R, Puregold and Puregold Duty Free Clark are pre-filled; custom stores can be added. "Usually good for" is labelled as a **tendency** (editable), not a fact. Store numbers (purchases, total, average basket, last visit) are computed only from recorded purchases. Store names in history that aren't in My Stores are listed with an **Add** button and are never added automatically.
- **Price Book**: products (name, brand, variant, size, unit, pack, aliases, who it's for) and price records. Prices come only from **receipts** (each item line, automatically) and **prices Jason enters** (paid / shelf / online listing). Every price shows its source. Shown per product: latest, lowest, highest, average, cheapest store (or "same price at N stores"), and the trend vs the previous price. Prices are compared per kg / litre / piece when the size is known, otherwise per item. Different products (e.g. 1.5 L vs 330 ml) are never merged; an exact duplicate is blocked.

## Stage 2: inventory, lists, trips, cycles

- **Inventory** (📦 tab): items kept in the pantry, fridge, freezer, storeroom… with quantity, unit, "one purchase adds" (pack size), an optional warning level, and an optional link to a Price Book product. Every change (− used, + added, counted, bought on a trip, bought on a receipt, thrown out) is a stock transaction.
  - **Status**: ⛔ OUT · 🔴 URGENT (under 3 days left) · 🟠 LOW (under 7 days, or at/below the warning level) · ✅ OK. The thresholds can be changed in Budget → Cycle.
  - **Daily use**: automatic (learned from the last 60 days of "used" taps, scaled when the household size changes), per person / per pet per day (scales with the Household profile), or a fixed number. Nothing is guessed: without data it says "No daily use set".
  - **Forecast**: days of supply, run-out date, amount needed per cycle, whether it lasts the current cycle, and a **smart reorder** amount (enough for cycle length + 3 buffer days, rounded up to whole packs) priced from the Price Book.
  - **Perishables**: expiry date and shelf life; ⏰ EXPIRES SOON / TODAY and 🗑️ EXPIRED badges; restocking sets a new date from the shelf life but keeps the older date while old stock remains.
- **Shopping list** (Shop → List): each item is a ✅ **need** or 💭 **want** with High / Normal / Low priority. Estimated prices come only from the Price Book ("no price yet" otherwise, and those items aren't added to the total). The list is compared with Safe to Spend.
  - **Fit to budget** (optional-item protection): needs always stay; wants are moved to the next cycle, lowest priority (then most expensive) first, until the list fits. A 📌 pinned want is never moved; if needs + pinned items alone don't fit, the shortfall is shown.
  - **Duplicate-purchase prevention**: adding something already on the list, already in the cart, with 15+ days' supply at home, or bought in the last 7 days shows a warning and needs a second tap.
  - "Add low-stock" adds every low/urgent/out item with its smart reorder amount.
- **Shopping Trip Mode** (Shop → 🛒 Trip): the list grouped by store (the item's store, else the cheapest latest price). Tick items into the cart; prices are prefilled from the Price Book and can be changed to the shelf price. A sticky bar shows the cart total and **Safe to Spend after** live, turns red past the hard stop, and FINISH needs a second tap past the hard stop. Unpriced cart items must be priced first. Finishing records one spending entry per store (with line items) in History, adds to Spent, saves "What you paid" prices in the Price Book, restocks linked inventory and ticks the items off. Cancelling records nothing.
- **Shopping cycles** (Budget → Cycle): every 15 days from the 1st by default, or any length from 3–62 days, or twice a month (1–15, 16–end). Shows planned (estimated cost of what was put on the list this cycle) vs actually spent (all counted spending dated in the cycle), split into planned / not-planned, with past cycles. When a cycle ends its numbers are saved and unfinished items carry over.
- **Receipts → products**: each receipt line is matched to the Price Book with a confidence: ✅ **High** (exact name or a name Jason confirmed before), 🔎 **Review** (similar words or a different size; linked as a suggestion, kept out of price comparisons and stock until checked), ❔ **Unknown** (new product created). The review card (Shop → Receipts, and a Home card) offers Same product (the name is remembered), Other product, New product, Not a product. Matched lines restock inventory and tick list items off. **Duplicate receipts** (same receipt number at the store, or same store + date + total) are flagged before saving.
- The command bar answers "what's low?" and "do I need eggs?" on the phone, without an AI call.

## History, report and backup

- **Purchase history** (Budget → History) lists everything that was spent in one place: items marked purchased, saved receipts and manual entries ("➕ Add spending"). You can filter by month and category, search, edit (amount, date, store, category, payment, "counts in Spent") and delete. Spent changes to match automatically.
- **Categories**: Groceries, Household, Electronics & Appliances, Baby & Kids, Pet, Health & Personal Care, Clothing, Home & Furniture, Food & Dining, Other. The AI picks one inside the receipt, photo and research calls it already makes, so there are no extra calls. Manual entries and older data use a keyword guess (English/Filipino/PH stores). Jason can always change it.
- **Monthly report** (Budget → Report) shows the month total vs the shopping fund, a breakdown by category (a CSS donut chart, no libraries), top stores, biggest purchases, the change vs last month and the daily average. There is a month picker. "AI summary" makes one AI call only when tapped, and the result is saved for that month.
- **Backup** (More → Data & Backup):
  - "Backup now" downloads `jason-shop-backup-YYYY-MM-DD.json`. "Share backup" opens the Android share sheet so the file can be sent to Google Drive, Gmail and so on.
  - "Restore from backup" checks the file first (is it a Jason Shop backup, from a newer version, do the record counts match, is the checksum intact), shows what's inside (items, receipts, entries, Spent, prices, products) and asks before replacing anything. A safety copy of the current data is saved first (`JasonShopData.beforeRestore` + the safety vault). After restoring, the saved data is read back and counted; if anything doesn't match, the previous data is put back automatically.
  - Backups from older versions still restore (they're upgraded on the way in), and older app versions can still read new backups.
  - "Export CSV" exports the chosen month or all time and opens in Google Sheets/Excel.
  - A reminder banner appears if there has been no backup for 7+ days ("Later" snoozes it for a day).
  - **Data check** looks for missing ids, duplicates, invalid amounts and broken links. It never changes anything.
  - **Safety copies** are listed with download / restore buttons. **Backup history** logs every backup, restore, failure, safety copy and data check.
  - **Automatic cloud backup** is marked **⚙️ NEEDS SETUP**. It needs a cloud storage connection that hasn't been configured, so it is off.
- **Change history** (More): every change to money, budget and data (purchases, receipts, entries, budget, plan, commitments, reserve, warning levels, stores, products, prices, household, restores, upgrades), with before/after values.

## Data model and upgrades

- Everything stays on the phone in `localStorage["JasonShopData"]` (same key as before; there is no login). Safety copies live in a separate IndexedDB store, `JasonShopVault`.
- The data has a `schemaVersion` (now **3**). Data without one is version 1, i.e. the app up to PR #4; version 2 is Stage 1.
- **Upgrade 1 → 2** is additive. All old fields and records are kept exactly as they were. It adds `houses`, `memberGroups`, `stores`, `products`, `priceRecords`, `budgetCategories`, `budgetPlan`, `commitments`, `reserves`, `auditLog`, `backupLog`, `settings`, and `meta.migrations`. Lists for Stage 2 (`inventoryItems`, `inventoryTransactions`, `shoppingLists`, `shoppingCycles`, `trips`) are created empty. It seeds the stores, categories and a "Main house", adds categories found in the history, and learns price records from existing receipt lines.
- **Upgrade 2 → 3** (Stage 2) is additive: it adds `settings.cycle` (15 days, anchored on the 1st of the month of the upgrade) and `settings.inventory` (alert thresholds), creates the active shopping list, and marks existing price records as High-confidence matches. Every Stage 1 list (stores, products, prices, plan, commitments, reserves, household) is counted before and after as well as the legacy totals.
- **Safety first**: before the upgraded data is saved, the untouched original is copied to the safety vault (or `JasonShopData.preMigration.v1` if the vault isn't available). Nothing is written until that copy exists. The upgrade compares record counts and peso totals (requests, purchases, receipts, receipt items, manual entries, fund, stop, spent and each total) before and after. If anything differs, the upgrade is paused and the app runs on the original data.
- Damaged saved data is never overwritten silently: it's kept under `JasonShopData.damaged.<time>`.
- Every record has a stable id. The model is laid out so a cloud database and multi-user roles can be added later without reshaping the data.

## Tests

```bash
npm run test:unit                      # calc + model unit tests (Node, no dependencies)
cd tests && npm install                # puppeteer-core (needs Google Chrome installed)
bash run-browser-tests.sh all          # legacy suites 1–4 + Stage 1 + Stage 2 end-to-end, headless mobile Chrome
bash run-browser-tests.sh stage2       # only the Stage 2 suite
```

The AI is always mocked in tests (a fake `api.openai.com` inside the test server), so no key and no paid calls are needed. `tests/fixtures/pre-upgrade-snapshot.json` is real data produced by driving the pre-Stage-1 production app through its UI (`tests/fixtures/generate-pre-upgrade-snapshot.js`); the Stage 1 suite upgrades it and checks nothing was lost. `tests/fixtures/stage1-snapshot.json` is real Stage 1 (v2) data made the same way (`generate-stage1-snapshot.js`); the Stage 2 suite upgrades it to v3 and then drives inventory, list, trip, cycle and receipt matching through the UI with the page clock pinned to 2026-10-06.
