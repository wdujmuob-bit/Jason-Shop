const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

/* =========================================
   JASON SHOP API
   Management + Research Only
   NO payments
   NO automatic purchases
   NO marketplace account access
========================================= */

app.get("/", (req, res) => {
  res.json({
    app: "Jason Shop",
    status: "online",
    version: "1.0.0",
    message: "Jason Shop AI backend is running."
  });
});


/* =========================================
   HEALTH CHECK
========================================= */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "Jason Shop AI",
    status: "healthy",
    time: new Date().toISOString()
  });
});


/* =========================================
   SHOPPING RESEARCH
   - OPENAI_MODEL            (default "gpt-5.6")
   - OPENAI_FALLBACK_MODEL   (default "gpt-5-mini", used only if the
                              main model name is rejected by OpenAI)
   - OPENAI_MAX_OUTPUT_TOKENS (default 10000 — reasoning + web search
                              need room, 1500 was too small)
   - OPENAI_REASONING_EFFORT (default "low" — faster and cheaper)
========================================= */

const RESEARCH_MODEL = process.env.OPENAI_MODEL || "gpt-5.6";
const FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || "gpt-5-mini";
const MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 10000;
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "low";
const OPENAI_TIMEOUT_MS = 240000;

function pesoText(value) {
  return "₱" + Math.round(Number(value) || 0).toLocaleString("en-PH");
}

function budgetSentence(budget) {

  if (!budget || typeof budget !== "object") return "";

  const fund = Number(budget.fund) || 0;
  const spent = Number(budget.spent) || 0;
  const stop = Number(budget.stop) || 0;

  if (fund <= 0 && stop <= 0) return "";

  let safe = fund > 0 ? fund - spent : Infinity;
  if (stop > 0) safe = Math.min(safe, stop - spent);
  safe = Math.max(0, safe);

  return " Jason's shopping budget: fund " + pesoText(fund) +
    ", already spent " + pesoText(spent) +
    (stop > 0 ? ", hard stop limit " + pesoText(stop) : "") +
    ", so the most he can safely spend right now is " + pesoText(safe) + ". " +
    "Say clearly whether each recommended option fits within that amount, and " +
    "warn him if the request itself would go over it.";

}

function buildResearchPrompt(query, budget) {

  return "Act as Jason Shop, my personal shopping research assistant. " +
    "Research this product request using current online information: " +
    query +
    ". Search relevant Philippine and international shopping sources. " +
    "Do not purchase anything. Compare useful products, current prices when available, " +
    "quality, specifications, reviews, seller/store reliability, shipping considerations, " +
    "and value for money. Give Best Overall, Cheapest Good Option, Best Quality, " +
    "and a clear BUY, WAIT, WATCH, or SKIP recommendation. " +
    "Use Philippine pesos where practical." +
    budgetSentence(budget) + " " +
    "Keep the report concise and easy to read on a phone. " +
    "Finish with one final line that starts exactly with 'VOICE SUMMARY:' " +
    "followed by one or two short, plain sentences (no markdown, no links) " +
    "that say which product you recommend, its approximate price, and BUY, WAIT, WATCH, or SKIP. " +
    "This line will be read aloud to Jason.";

}

// The REST API does not always include the SDK's `output_text` helper,
// so walk output[] → message items → output_text parts as well.
function extractOutputText(aiData) {

  if (!aiData || typeof aiData !== "object") return "";

  if (typeof aiData.output_text === "string" && aiData.output_text.trim()) {
    return aiData.output_text.trim();
  }

  const parts = [];

  for (const item of Array.isArray(aiData.output) ? aiData.output : []) {

    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;

    for (const part of item.content) {
      if (part && (part.type === "output_text" || part.type === "text") && typeof part.text === "string") {
        parts.push(part.text);
      }
    }

  }

  return parts.join("\n\n").trim();

}

function describeShape(aiData) {

  return JSON.stringify({
    model: aiData && aiData.model,
    status: aiData && aiData.status,
    incomplete_details: aiData && aiData.incomplete_details,
    error: aiData && aiData.error,
    has_output_text: !!(aiData && aiData.output_text),
    output_types: Array.isArray(aiData && aiData.output)
      ? aiData.output.map(o => o && o.type + (Array.isArray(o.content) ? "[" + o.content.map(c => c && c.type).join(",") + "]" : ""))
      : null,
    usage: aiData && aiData.usage
  });

}

function supportsReasoning(model) {
  return /^(gpt-5|o\d)/i.test(model);
}

async function callResponsesAPI({ model, input, maxTokens, effort }) {

  const body = {
    model,
    max_output_tokens: maxTokens,
    tools: [{ type: "web_search" }],
    text: { format: { type: "text" } },
    input
  };

  if (effort && supportsReasoning(model)) {
    body.reasoning = { effort };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.OPENAI_API_KEY
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    return { ok: response.ok, status: response.status, data };

  } finally {
    clearTimeout(timer);
  }

}

function isModelProblem(result) {
  const err = (result.data && result.data.error) || {};
  return result.status === 404 ||
    err.code === "model_not_found" ||
    (err.param === "model");
}

function isReasoningParamProblem(result) {
  const err = (result.data && result.data.error) || {};
  return result.status === 400 && (err.param === "reasoning" || err.param === "reasoning.effort" ||
    /reasoning/i.test(String(err.message || "")));
}

class ResearchError extends Error {
  constructor(message, publicMessage) {
    super(message);
    this.publicMessage = publicMessage;
  }
}

async function runResearch(query, budget) {

  if (!process.env.OPENAI_API_KEY) {
    throw new ResearchError("OPENAI_API_KEY is not set",
      "AI research is not set up on the server yet (missing OpenAI key).");
  }

  const input = buildResearchPrompt(query, budget);

  let model = RESEARCH_MODEL;
  let effort = REASONING_EFFORT;
  let maxTokens = MAX_OUTPUT_TOKENS;
  let retriedForSpace = false;

  // Up to 3 attempts, each fixing a specific, known problem.
  for (let attempt = 1; attempt <= 3; attempt++) {

    const result = await callResponsesAPI({ model, input, maxTokens, effort });

    if (!result.ok) {

      console.error("OpenAI research error (" + model + "):", result.status, JSON.stringify(result.data && result.data.error));

      if (isReasoningParamProblem(result) && effort) {
        effort = null;              // model doesn't accept reasoning settings
        continue;
      }

      if (isModelProblem(result) && model !== FALLBACK_MODEL) {
        console.error("Model '" + model + "' rejected; falling back to '" + FALLBACK_MODEL + "'.");
        model = FALLBACK_MODEL;
        continue;
      }

      throw new ResearchError("OpenAI research failed: " + result.status,
        "The AI research service returned an error. Please tap Retry in a minute.");

    }

    const text = extractOutputText(result.data);

    if (text) {
      return {
        report: text,
        summary: extractVoiceSummary(text),
        model,
        complete: result.data.status !== "incomplete"
      };
    }

    console.error("OpenAI returned no readable text. Shape:", describeShape(result.data));

    const ranOut = result.data && result.data.status === "incomplete" &&
      result.data.incomplete_details && result.data.incomplete_details.reason === "max_output_tokens";

    if (ranOut && !retriedForSpace && attempt < 3) {
      retriedForSpace = true;
      maxTokens = maxTokens * 2;     // give the model more room, once
      continue;
    }

    break;

  }

  throw new ResearchError("No readable report from OpenAI",
    "The AI finished without writing a report. Please tap Retry.");

}

/* ---------- Synchronous research (kept for compatibility) ---------- */

app.post("/api/research", async (req, res) => {

  const { query, budget } = req.body || {};

  if (!query || !String(query).trim()) {
    return res.status(400).json({
      success: false,
      error: "Shopping request is required."
    });
  }

  try {

    const result = await runResearch(String(query).trim(), budget);

    return res.json({
      success: true,
      query: String(query).trim(),
      status: "complete",
      report: result.report,
      summary: result.summary
    });

  } catch (error) {

    console.error(error);

    return res.status(error.publicMessage ? 502 : 500).json({
      success: false,
      error: error.publicMessage || "Research request failed."
    });

  }

});

/* ---------- Background research jobs ----------
   Research with web search can take 1–3 minutes. Phones drop long
   requests (screen off, app switch, proxy timeouts), so the app starts
   a job, gets an id straight away, and checks back every few seconds. */

const researchJobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;

function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of researchJobs) {
    if (now - job.createdAt > JOB_TTL_MS) researchJobs.delete(id);
  }
}

app.post("/api/research/start", (req, res) => {

  const { query, budget } = req.body || {};

  if (!query || !String(query).trim()) {
    return res.status(400).json({
      success: false,
      error: "Shopping request is required."
    });
  }

  cleanupJobs();

  const id = "JS-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);

  const job = {
    id,
    query: String(query).trim(),
    status: "researching",
    createdAt: Date.now()
  };

  researchJobs.set(id, job);

  runResearch(job.query, budget)
    .then(result => {
      job.status = "complete";
      job.report = result.report;
      job.summary = result.summary;
    })
    .catch(error => {
      console.error("Research job " + id + " failed:", error.message);
      job.status = "error";
      job.error = error.publicMessage || "Research failed. Please tap Retry.";
    })
    .finally(() => {
      job.finishedAt = Date.now();
    });

  return res.status(202).json({
    success: true,
    jobId: id,
    status: "researching"
  });

});

app.get("/api/research/status/:id", (req, res) => {

  const job = researchJobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      success: false,
      status: "missing",
      error: "This research was lost because the server restarted. Please tap Retry."
    });
  }

  if (job.status === "complete") {
    return res.json({
      success: true,
      status: "complete",
      query: job.query,
      report: job.report,
      summary: job.summary
    });
  }

  if (job.status === "error") {
    return res.json({
      success: false,
      status: "error",
      error: job.error
    });
  }

  return res.json({
    success: true,
    status: "researching",
    seconds: Math.round((Date.now() - job.createdAt) / 1000)
  });

});


/* =========================================
   VOICE SUMMARY HELPER
   Pulls the short "VOICE SUMMARY:" line out of
   the AI report so the app can read it aloud.
========================================= */

function extractVoiceSummary(report) {

  if (!report) return "";

  const match = String(report).match(/VOICE SUMMARY:\s*\**\s*(.+)/i);

  if (!match) return "";

  return match[1]
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

}


/* =========================================
   VOICE TRANSCRIPTION
   Fallback for phones/browsers without the
   built-in speech recognition. The app records
   audio and sends it here; OpenAI turns it
   into text using the same OPENAI_API_KEY.
========================================= */

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB (~10 minutes of voice)

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 }
});

const AUDIO_EXTENSIONS = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "video/webm": "webm",
  "video/mp4": "mp4"
};

app.post("/api/transcribe", (req, res) => {

  audioUpload.single("audio")(req, res, async (uploadError) => {

    if (uploadError) {

      const tooBig = uploadError.code === "LIMIT_FILE_SIZE";

      return res.status(tooBig ? 413 : 400).json({
        success: false,
        error: tooBig
          ? "That recording is too long. Please keep voice requests short."
          : "Could not read the voice recording. Please try again."
      });

    }

    try {

      const file = req.file;

      if (!file || !file.buffer || file.size < 1000) {

        return res.status(400).json({
          success: false,
          error: "No voice recording was received. Please tap the mic and speak again."
        });

      }

      const baseType = String(file.mimetype || "").split(";")[0].trim().toLowerCase();
      const extension = AUDIO_EXTENSIONS[baseType];

      if (!extension) {

        return res.status(415).json({
          success: false,
          error: "This audio format is not supported. Please try again or type your request."
        });

      }

      if (!process.env.OPENAI_API_KEY) {

        console.error("Transcription skipped: OPENAI_API_KEY is not set.");

        return res.status(503).json({
          success: false,
          error: "Voice transcription is not set up on the server yet. Please type your request for now."
        });

      }

      const form = new FormData();

      form.append(
        "file",
        new Blob([file.buffer], { type: baseType }),
        "voice." + extension
      );

      form.append(
        "model",
        process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe"
      );

      form.append(
        "prompt",
        "A shopping request for Jason Shop in the Philippines. It may mix English and Filipino (Taglish) " +
        "and mention brands, product models, peso amounts, Shopee, Lazada, Amazon, S&R, or Landers."
      );

      // English is passed as a hint; Filipino/Taglish is left on auto-detect
      // so mixed-language requests are not forced into one language.
      if (req.body && req.body.language === "en") {
        form.append("language", "en");
      }

      const aiResponse = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + process.env.OPENAI_API_KEY
          },
          body: form
        }
      );

      const aiData = await aiResponse.json().catch(() => ({}));

      if (!aiResponse.ok) {
        console.error("OpenAI transcription error:", aiData);
        throw new Error("OpenAI transcription failed");
      }

      const text = String(aiData.text || "").trim();

      if (!text) {

        return res.status(422).json({
          success: false,
          error: "I couldn't hear any words in that recording. Please try again."
        });

      }

      return res.json({
        success: true,
        text
      });

    }

    catch (error) {

      console.error(error);

      return res.status(500).json({
        success: false,
        error: "Voice transcription failed. Please try again or type your request."
      });

    }

  });

});


/* =========================================
   RECEIPT ANALYSIS PLACEHOLDER
========================================= */

app.post("/api/receipt", async (req, res) => {

  try {

    res.json({

      success: true,

      status: "received",

      message:
        "Receipt received by Jason Shop. AI receipt extraction will be connected in the next phase."

    });

  }

  catch (error) {

    res.status(500).json({
      success: false,
      error: "Receipt processing failed."
    });

  }

});


/* =========================================
   BUDGET CHECK
========================================= */

app.post("/api/budget/check", (req, res) => {

  const {
    fund = 0,
    spent = 0,
    planned = 0,
    hardStop = 0,
    productPrice = 0
  } = req.body;

  const available =
    Number(fund) -
    Number(spent);

  const projected =
    Number(spent) +
    Number(planned) +
    Number(productPrice);

  let status = "SAFE";

  if (
    hardStop > 0 &&
    projected >= hardStop
  ) {

    status = "HARD_STOP";

  }

  else if (
    hardStop > 0 &&
    projected >= hardStop * 0.85
  ) {

    status = "WARNING";

  }

  res.json({

    success: true,

    fund:
      Number(fund),

    spent:
      Number(spent),

    planned:
      Number(planned),

    productPrice:
      Number(productPrice),

    available,

    projected,

    hardStop:
      Number(hardStop),

    status

  });

});


/* =========================================
   SECURITY — UNKNOWN ENDPOINT
========================================= */

app.use((req, res) => {

  res.status(404).json({
    success: false,
    error: "Jason Shop API endpoint not found."
  });

});


/* =========================================
   START SERVER
========================================= */

app.listen(PORT, () => {

  console.log(
    `Jason Shop backend running on port ${PORT}`
  );

});