# Jason-Shop

Jason Shop is a personal AI shopping manager: ask for a product by **voice** or text, and the backend researches it across Philippine and international stores, compares price, specs, reviews and value, and gives a BUY / WAIT / WATCH / SKIP recommendation. The app also tracks the shopping fund, spending and a hard-stop limit.

## Files

| File | What it is |
|---|---|
| `index.html` | The app (static frontend, Render service `jason-shop`). Saves budget and requests in the phone's browser storage. |
| `server.js` | The API (Node/Express, Render service `jason-shop-api`). |
| `package.json` | Backend dependencies (`express`, `cors`, `multer`). |

## API

| Endpoint | Purpose |
|---|---|
| `GET /` and `GET /api/health` | Status checks |
| `POST /api/research/start` | `{ "query": "...", "budget": { "fund", "spent", "stop" } }` → `{ jobId }` straight away (research runs in the background) |
| `GET /api/research/status/:jobId` | `researching` → `complete` (with `report` and a short `summary` for reading aloud) or `error` |
| `POST /api/research` | Same research in one long request (kept for compatibility) |
| `POST /api/photo/start` | multipart: `image` (JPG/PNG/WebP, max 8 MB) + `kind` = `product` or `receipt` → `{ jobId }` |
| `GET /api/jobs/:jobId` | Result of any background job: `product` (name, brand, model, specs, shop listing price/seller) or `receipt` (store, date, items, subtotal, VAT, total, payment, warnings) |
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

## Budget

- Tap **Safe to Spend**, **Shopping Fund** or **Spent** (or the 💰 Budget tab) to set the budget. Amounts can be typed as `500000`, `500,000`, `₱500,000`, `500k` or `1.5m`.
- **🛒 Mark purchased** on a shopping item asks what you paid and adds it to Spent (with **Undo**). Adding a receipt also asks for its total.
- The status turns orange at 85% of the Hard Stop Limit and red at 100%; recording a purchase past the hard stop needs a second tap.
- The budget is sent with each research request so the AI says whether options fit.

## Deploying

Render auto-deploy is **off**. After merging to `main`, manually deploy **both** services on Render: `jason-shop-api` (backend) and `jason-shop` (frontend).
