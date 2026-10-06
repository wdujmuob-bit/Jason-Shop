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

/* Spending categories (same list in the app). */
const CATEGORIES = ["Groceries", "Household", "Electronics & Appliances", "Baby & Kids", "Pet",
  "Health & Personal Care", "Clothing", "Home & Furniture", "Food & Dining", "Other"];

function cleanCategory(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  return CATEGORIES.find(c => c.toLowerCase() === v) ||
    CATEGORIES.find(c => v && c.toLowerCase().split(/[ &]+/).includes(v.split(/[ &]+/)[0])) || null;
}

function extractCategory(report) {
  const match = String(report || "").match(/CATEGORY:\s*\**\s*([^\n*]+)/i);
  return match ? cleanCategory(match[1]) : null;
}

function pesoText(value) {
  return "₱" + Math.round(Number(value) || 0).toLocaleString("en-PH");
}

function budgetSentence(budget) {

  if (!budget || typeof budget !== "object") return "";

  const fund = Number(budget.fund) || 0;
  const spent = Number(budget.spent) || 0;
  const stop = Number(budget.stop) || 0;
  // Stage 1: money already promised (committed purchases) and the protected
  // reserve are not spendable either.
  const committed = Math.max(0, Number(budget.committed) || 0);
  const reserve = Math.max(0, Number(budget.reserve) || 0);

  if (fund <= 0 && stop <= 0) return "";

  let safe = fund > 0 ? fund - spent - committed - reserve : Infinity;
  if (stop > 0) safe = Math.min(safe, stop - spent - committed);
  safe = Math.max(0, safe);

  return " Jason's shopping budget: fund " + pesoText(fund) +
    ", already spent " + pesoText(spent) +
    (committed > 0 ? ", already committed to planned purchases " + pesoText(committed) : "") +
    (reserve > 0 ? ", protected reserve (not spendable) " + pesoText(reserve) : "") +
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
    "Just before the end, add one line that starts exactly with 'CATEGORY:' followed by the single best " +
    "shopping category for this request from this list: " + CATEGORIES.join(", ") + ". " +
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

async function callResponsesAPI({ model, input, maxTokens, effort, tools, textFormat }) {

  const body = {
    model,
    max_output_tokens: maxTokens,
    text: { format: textFormat || { type: "text" } },
    input
  };

  if (tools && tools.length) {
    body.tools = tools;
  }

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

function isTextFormatProblem(result) {
  const err = (result.data && result.data.error) || {};
  return result.status === 400 && (/^text/.test(String(err.param || "")) ||
    /json_schema|text\.format|response_format|structured output/i.test(String(err.message || "")));
}

function isImageProblem(result) {
  const err = (result.data && result.data.error) || {};
  return result.status === 400 && (/image/i.test(String(err.code || "")) ||
    /image/i.test(String(err.param || "")) || /image/i.test(String(err.message || "")));
}

class ResearchError extends Error {
  constructor(message, publicMessage) {
    super(message);
    this.publicMessage = publicMessage;
  }
}

/* One OpenAI call with automatic recovery from known problems:
   model name rejected → fallback model; reasoning setting rejected →
   drop it; structured output rejected → plain text; ran out of space →
   retry once with double room. Never logs the input (it can hold images). */
async function askOpenAI({ input, tools, textFormat, maxTokens, label, failMessage, emptyMessage }) {

  if (!process.env.OPENAI_API_KEY) {
    throw new ResearchError("OPENAI_API_KEY is not set",
      "AI is not set up on the server yet (missing OpenAI key).");
  }

  let model = RESEARCH_MODEL;
  let effort = REASONING_EFFORT;
  let format = textFormat || null;
  let tokens = maxTokens || MAX_OUTPUT_TOKENS;
  let retriedForSpace = false;

  for (let attempt = 1; attempt <= 4; attempt++) {

    const result = await callResponsesAPI({ model, input, maxTokens: tokens, effort, tools, textFormat: format });

    if (!result.ok) {

      console.error("OpenAI " + label + " error (" + model + "):", result.status, JSON.stringify(result.data && result.data.error));

      if (isReasoningParamProblem(result) && effort) {
        effort = null;              // model doesn't accept reasoning settings
        continue;
      }

      if (isModelProblem(result) && model !== FALLBACK_MODEL) {
        console.error("Model '" + model + "' rejected; falling back to '" + FALLBACK_MODEL + "'.");
        model = FALLBACK_MODEL;
        continue;
      }

      if (format && isTextFormatProblem(result)) {
        format = null;              // fall back to plain text (prompt asks for JSON)
        continue;
      }

      if (isImageProblem(result)) {
        throw new ResearchError("OpenAI rejected the image",
          "The AI couldn't open that picture. Please try another photo or a screenshot.");
      }

      throw new ResearchError("OpenAI " + label + " failed: " + result.status,
        failMessage || "The AI service returned an error. Please tap Retry in a minute.");

    }

    const text = extractOutputText(result.data);

    if (text) {
      return { text, model, complete: result.data.status !== "incomplete", structured: !!format };
    }

    console.error("OpenAI " + label + " returned no readable text. Shape:", describeShape(result.data));

    const ranOut = result.data && result.data.status === "incomplete" &&
      result.data.incomplete_details && result.data.incomplete_details.reason === "max_output_tokens";

    if (ranOut && !retriedForSpace) {
      retriedForSpace = true;
      tokens = tokens * 2;          // give the model more room, once
      continue;
    }

    break;

  }

  throw new ResearchError("No readable output from OpenAI (" + label + ")",
    emptyMessage || "The AI finished without an answer. Please tap Retry.");

}

async function runResearch(query, budget) {

  const answer = await askOpenAI({
    input: buildResearchPrompt(query, budget),
    tools: [{ type: "web_search" }],
    maxTokens: MAX_OUTPUT_TOKENS,
    label: "research",
    failMessage: "The AI research service returned an error. Please tap Retry in a minute.",
    emptyMessage: "The AI finished without writing a report. Please tap Retry."
  });

  return {
    report: answer.text,
    summary: extractVoiceSummary(answer.text),
    category: extractCategory(answer.text),
    model: answer.model,
    complete: answer.complete
  };

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
      summary: result.summary,
      category: result.category || null
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

// Generic background job: worker() resolves to the result fields.
// Only the result is kept on the job (never the uploaded image).
function startJob(kind, worker) {

  cleanupJobs();

  const id = "JS-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);

  const job = { id, kind, status: "researching", createdAt: Date.now() };

  researchJobs.set(id, job);

  Promise.resolve()
    .then(worker)
    .then(result => {
      job.status = "complete";
      job.result = result;
    })
    .catch(error => {
      console.error(kind + " job " + id + " failed:", error.message);
      job.status = "error";
      job.error = error.publicMessage || "Something went wrong. Please tap Retry.";
    })
    .finally(() => {
      job.finishedAt = Date.now();
    });

  return job;

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
      job.category = result.category;
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

app.get(["/api/research/status/:id", "/api/jobs/:id"], (req, res) => {

  const job = researchJobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      success: false,
      status: "missing",
      error: "This research was lost because the server restarted. Please tap Retry."
    });
  }

  if (job.status === "complete") {
    if (job.result) {
      return res.json(Object.assign({ success: true, status: "complete", kind: job.kind }, job.result));
    }
    return res.json({
      success: true,
      status: "complete",
      query: job.query,
      report: job.report,
      summary: job.summary,
      category: job.category || null
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
   PHOTO READING (OpenAI vision)
   POST /api/photo/start  (multipart: image, kind=product|receipt)
     → { jobId }   then poll GET /api/jobs/:id
   The app shrinks photos to ~1600px JPEG before upload.
   Image bytes are only held in memory for the OpenAI call and are
   never logged or stored.
========================================= */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB hard limit
const VISION_MAX_TOKENS = Number(process.env.OPENAI_VISION_MAX_OUTPUT_TOKENS) || 6000;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5 }
});

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

const PRODUCT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_product", "image_kind", "product_name", "brand", "model", "product_type",
    "key_specs", "search_query", "listing", "confidence", "notes", "category"],
  properties: {
    is_product: { type: "boolean" },
    image_kind: { type: "string", enum: ["product_photo", "shop_screenshot", "other"] },
    product_name: { type: "string" },
    brand: nullableString,
    model: nullableString,
    product_type: nullableString,
    key_specs: { type: "array", items: { type: "string" } },
    search_query: { type: "string" },
    listing: {
      type: "object",
      additionalProperties: false,
      required: ["found", "platform", "title", "price_php", "original_price_php", "seller", "rating", "sold", "shipping"],
      properties: {
        found: { type: "boolean" },
        platform: nullableString,
        title: nullableString,
        price_php: nullableNumber,
        original_price_php: nullableNumber,
        seller: nullableString,
        rating: nullableString,
        sold: nullableString,
        shipping: nullableString
      }
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string" },
    category: { type: "string", enum: CATEGORIES }
  }
};

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_receipt", "readability", "store", "branch", "date", "time", "items", "subtotal",
    "vat", "discount", "service_charge", "total", "currency", "payment_method", "receipt_number", "problems", "category"],
  properties: {
    is_receipt: { type: "boolean" },
    readability: { type: "string", enum: ["clear", "partly_readable", "unreadable"] },
    store: nullableString,
    branch: nullableString,
    date: nullableString,
    time: nullableString,
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "qty", "unit_price", "line_total"],
        properties: {
          name: { type: "string" },
          qty: nullableNumber,
          unit_price: nullableNumber,
          line_total: nullableNumber
        }
      }
    },
    subtotal: nullableNumber,
    vat: nullableNumber,
    discount: nullableNumber,
    service_charge: nullableNumber,
    total: nullableNumber,
    currency: nullableString,
    payment_method: nullableString,
    receipt_number: nullableString,
    problems: { type: "string" },
    category: { type: "string", enum: CATEGORIES }
  }
};

const PRODUCT_PROMPT =
  "You are Jason Shop's product spotter for a shopper in the Philippines. Look at the image and identify the product. " +
  "If it is a screenshot of a shopping app or website (Shopee, Lazada, TikTok Shop, Amazon, Zalora, etc.), set image_kind to " +
  "'shop_screenshot' and fill listing with what is visibly shown: platform, listing title, current price in PHP as a plain number, " +
  "original/crossed-out price, seller or shop name, rating, number sold, and shipping info; set listing.found true. " +
  "Otherwise set listing.found false and the listing fields to null. " +
  "product_name: brand + model + product type in one short line. key_specs: up to 6 short specs that are visible or certain " +
  "from the exact model (e.g. size, capacity, wattage, colour). search_query: a concise search phrase to find this exact product. " +
  "Never invent a model number you cannot read — use null and lower the confidence instead. " +
  "If there is no identifiable product, set is_product false, product_name to '', and explain in notes. " +
  "category: the best shopping category from: " + CATEGORIES.join(", ") + ". " +
  "Reply with JSON only, matching the requested schema.";

const RECEIPT_PROMPT =
  "You read shopping receipts for Jason Shop (Philippines, amounts usually in PHP). Extract: store name, branch/address line, " +
  "date as YYYY-MM-DD, time, every line item (name, qty, unit price, line total), subtotal, VAT amount (the VAT itself, not " +
  "'VATable sales'), discount, service charge, the final total paid, currency code, and payment method (e.g. Cash, GCash, Maya, " +
  "Credit card, Debit card). For cards give only the card type — never copy card numbers. Amounts are plain numbers without " +
  "commas or currency signs. Use null for anything you cannot read; never guess. " +
  "If the image is not a receipt or invoice, set is_receipt false. If it is too blurry, dark or cut off to read, set readability " +
  "'unreadable' (or 'partly_readable') and explain what is wrong in problems, e.g. 'Total is cut off'. " +
  "category: the best shopping category from: " + CATEGORIES.join(", ") + ". " +
  "Reply with JSON only, matching the requested schema.";

function parseJSONLoose(text) {
  try { return JSON.parse(text); } catch (e) { /* try to find a JSON object */ }
  const match = String(text).match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (e) { /* fall through */ }
  }
  return null;
}

function cleanString(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max || 200) : null;
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function normalizeProduct(raw) {

  const r = raw && typeof raw === "object" ? raw : {};
  const l = r.listing && typeof r.listing === "object" ? r.listing : {};

  const brand = cleanString(r.brand, 80);
  const model = cleanString(r.model, 80);
  const type = cleanString(r.product_type, 80);

  let name = cleanString(r.product_name, 160) ||
    [brand, model, type].filter(Boolean).join(" ") || "";

  const listingFound = !!l.found && !!(cleanNumber(l.price_php) || cleanString(l.seller) || cleanString(l.title));

  return {
    is_product: r.is_product !== false && !!name,
    image_kind: ["product_photo", "shop_screenshot", "other"].includes(r.image_kind) ? r.image_kind : "other",
    product_name: name,
    brand,
    model,
    product_type: type,
    key_specs: (Array.isArray(r.key_specs) ? r.key_specs : []).map(x => cleanString(x, 80)).filter(Boolean).slice(0, 6),
    search_query: cleanString(r.search_query, 200) || name,
    listing: {
      found: listingFound,
      platform: listingFound ? cleanString(l.platform, 40) : null,
      title: listingFound ? cleanString(l.title, 200) : null,
      price_php: listingFound ? cleanNumber(l.price_php) : null,
      original_price_php: listingFound ? cleanNumber(l.original_price_php) : null,
      seller: listingFound ? cleanString(l.seller, 80) : null,
      rating: listingFound ? cleanString(l.rating, 40) : null,
      sold: listingFound ? cleanString(l.sold, 40) : null,
      shipping: listingFound ? cleanString(l.shipping, 80) : null
    },
    confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "low",
    notes: cleanString(r.notes, 300) || "",
    category: cleanCategory(r.category)
  };

}

function normalizeReceipt(raw) {

  const r = raw && typeof raw === "object" ? raw : {};

  const items = (Array.isArray(r.items) ? r.items : [])
    .map(it => ({
      name: cleanString(it && it.name, 120) || "",
      qty: cleanNumber(it && it.qty),
      unit_price: cleanNumber(it && it.unit_price),
      line_total: cleanNumber(it && it.line_total)
    }))
    .filter(it => it.name || it.line_total !== null)
    .slice(0, 80);

  let date = cleanString(r.date, 20);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const d = new Date(date);
    date = isNaN(d) ? null : d.toISOString().slice(0, 10);
  }

  const out = {
    is_receipt: r.is_receipt !== false,
    readability: ["clear", "partly_readable", "unreadable"].includes(r.readability) ? r.readability : "partly_readable",
    store: cleanString(r.store, 100),
    branch: cleanString(r.branch, 160),
    date,
    time: cleanString(r.time, 20),
    items,
    subtotal: cleanNumber(r.subtotal),
    vat: cleanNumber(r.vat),
    discount: cleanNumber(r.discount),
    service_charge: cleanNumber(r.service_charge),
    total: cleanNumber(r.total),
    currency: cleanString(r.currency, 8) || "PHP",
    payment_method: cleanString(r.payment_method, 40),
    receipt_number: cleanString(r.receipt_number, 40),
    problems: cleanString(r.problems, 300) || "",
    category: cleanCategory(r.category),
    warnings: []
  };

  // Sanity checks the user should see before confirming.
  const itemsSum = items.reduce((sum, it) =>
    sum + (it.line_total !== null ? it.line_total : (it.qty || 1) * (it.unit_price || 0)), 0);

  if (out.is_receipt && out.total === null) {
    out.warnings.push("The total couldn't be read — please type it in.");
  }

  if (out.total !== null && itemsSum > 0) {
    const expected = out.subtotal !== null ? out.subtotal : out.total;
    if (Math.abs(itemsSum - expected) > Math.max(1, expected * 0.02) &&
        Math.abs(itemsSum - out.total) > Math.max(1, out.total * 0.02)) {
      out.warnings.push("The items add up to ₱" + itemsSum.toLocaleString("en-PH") +
        ", which doesn't match the receipt. Please check the amounts.");
    }
  }

  return out;

}

async function readImage(kind, file) {

  const dataUrl = "data:" + file.mimetype + ";base64," + file.buffer.toString("base64");

  const isReceipt = kind === "receipt";

  const answer = await askOpenAI({
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: isReceipt ? RECEIPT_PROMPT : PRODUCT_PROMPT },
        { type: "input_image", image_url: dataUrl, detail: "high" }
      ]
    }],
    textFormat: {
      type: "json_schema",
      name: isReceipt ? "receipt" : "product",
      strict: true,
      schema: isReceipt ? RECEIPT_SCHEMA : PRODUCT_SCHEMA
    },
    maxTokens: VISION_MAX_TOKENS,
    label: isReceipt ? "receipt" : "product photo",
    failMessage: "The AI couldn't read the photo right now. Please tap Retry in a minute.",
    emptyMessage: "The AI couldn't read this photo. Please try again with a clearer picture."
  });

  const parsed = parseJSONLoose(answer.text);

  if (!parsed) {
    console.error("Photo (" + kind + "): AI reply was not JSON (" + answer.text.length + " chars).");
    throw new ResearchError("AI reply was not JSON",
      "The AI couldn't read this photo. Please try again with a clearer picture.");
  }

  return isReceipt
    ? { receipt: normalizeReceipt(parsed) }
    : { product: normalizeProduct(parsed) };

}

app.post("/api/photo/start", (req, res) => {

  imageUpload.single("image")(req, res, (uploadError) => {

    if (uploadError) {
      const tooBig = uploadError.code === "LIMIT_FILE_SIZE";
      return res.status(tooBig ? 413 : 400).json({
        success: false,
        error: tooBig
          ? "That photo is too large (max 8 MB). Please try again."
          : "Could not read the photo upload. Please try again."
      });
    }

    const file = req.file;
    const kind = req.body && req.body.kind;

    if (kind !== "product" && kind !== "receipt") {
      return res.status(400).json({ success: false, error: "Unknown photo type." });
    }

    if (!file || !file.buffer || file.size < 100) {
      return res.status(400).json({ success: false, error: "No photo was received. Please try again." });
    }

    if (!IMAGE_TYPES.includes(String(file.mimetype).toLowerCase())) {
      return res.status(415).json({
        success: false,
        error: "Please use a JPG, PNG or WebP photo or screenshot."
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        success: false,
        error: "Photo reading is not set up on the server yet (missing OpenAI key)."
      });
    }

    const job = startJob(kind, () => readImage(kind, file));

    return res.status(202).json({ success: true, jobId: job.id, status: "researching" });

  });

});


/* =========================================
   MONTHLY SUMMARY (only when Jason taps the button)
   POST /api/report/summary { stats } → { jobId }
   Gets totals only (no photos), returns 2–3 sentences.
========================================= */

function buildSummaryPrompt(stats) {

  const st = stats && typeof stats === "object" ? stats : {};
  const list = (arr, fn) => (Array.isArray(arr) ? arr : []).slice(0, 6).map(fn).join("; ");

  return "You are Jason Shop, Jason's personal shopping manager in the Philippines. " +
    "Write a 2-3 sentence summary of his spending for " + cleanString(st.monthLabel, 30) + ". " +
    "Use plain, friendly English, peso amounts with the ₱ sign and commas, no markdown, no lists. " +
    "Mention the total and how it compares with his shopping fund and with last month, the biggest category, " +
    "and one practical observation or tip if useful. Do not invent numbers. Data: " +
    "total spent " + pesoText(st.total) + " across " + (Number(st.count) || 0) + " purchases; " +
    "shopping fund " + (Number(st.fund) > 0 ? pesoText(st.fund) : "not set") + "; " +
    "hard stop " + (Number(st.stop) > 0 ? pesoText(st.stop) : "not set") + "; " +
    "last month " + pesoText(st.lastMonthTotal) + "; daily average " + pesoText(st.dailyAverage) + "; " +
    "by category: " + list(st.byCategory, c => cleanString(c.name, 40) + " " + pesoText(c.amount)) + "; " +
    "top stores: " + list(st.topStores, c => cleanString(c.name, 60) + " " + pesoText(c.amount)) + "; " +
    "biggest purchases: " + list(st.biggest, c => cleanString(c.name, 80) + " " + pesoText(c.amount)) + ".";

}

app.post("/api/report/summary", (req, res) => {

  const stats = req.body && req.body.stats;

  if (!stats || typeof stats !== "object" || !stats.monthLabel) {
    return res.status(400).json({ success: false, error: "Monthly numbers are required." });
  }

  if (!(Number(stats.count) > 0)) {
    return res.status(400).json({ success: false, error: "There's no spending recorded for this month yet." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ success: false, error: "AI is not set up on the server yet (missing OpenAI key)." });
  }

  const job = startJob("summary", async () => {
    const answer = await askOpenAI({
      input: buildSummaryPrompt(stats),
      maxTokens: 2500,
      label: "summary",
      failMessage: "The AI couldn't write the summary right now. Please try again in a minute.",
      emptyMessage: "The AI didn't return a summary. Please try again."
    });
    return { text: answer.text.replace(/[*#_`]/g, "").trim().slice(0, 1200) };
  });

  return res.status(202).json({ success: true, jobId: job.id, status: "researching" });

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
        "Receipt reading has moved to POST /api/photo/start with kind=receipt."

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