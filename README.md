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
| `POST /api/research` | `{ "query": "..." }` → AI research report (`report`) plus a short `summary` for reading aloud |
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
| `OPENAI_TRANSCRIBE_MODEL` | No | Defaults to `gpt-4o-mini-transcribe`. `whisper-1` also works. |
| `PORT` | No | Set automatically by Render. |

## Run locally

```bash
npm install
OPENAI_API_KEY=sk-... npm start          # API on http://localhost:3000
python3 -m http.server 8080              # app on http://localhost:8080 (talks to localhost:3000 automatically)
```
