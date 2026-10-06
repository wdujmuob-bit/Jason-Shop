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
   SHOPPING RESEARCH REQUEST
========================================= */

app.post("/api/research", async (req, res) => {

  try {

    const { query, budget, mode } = req.body;

    if (!query || !query.trim()) {

      return res.status(400).json({
        success: false,
        error: "Shopping request is required."
      });

    }

    /*
      NEXT PHASE:
      This endpoint will call the AI/web
      research engine.

      For now it verifies that:

      Samsung
          ↓
      Jason Shop
          ↓
      Backend
          ↓
      API

      communication is working.
    */

    

      const aiResponse = await fetch(
  "https://api.openai.com/v1/responses",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + process.env.OPENAI_API_KEY
    },
    body: JSON.stringify({
      model: "gpt-5.6",
      max_output_tokens: 1500,
      tools: [
        {
          type: "web_search"
        }
      ],
      input:
        "Act as Jason Shop, my personal shopping research assistant. " +
        "Research this product request using current online information: " +
        query +
        ". Search relevant Philippine and international shopping sources. " +
        "Do not purchase anything. Compare useful products, current prices when available, " +
        "quality, specifications, reviews, seller/store reliability, shipping considerations, " +
        "and value for money. Give Best Overall, Cheapest Good Option, Best Quality, " +
        "and a clear BUY, WAIT, WATCH, or SKIP recommendation. " +
        "Use Philippine pesos where practical. " +
        "Finish with one final line that starts exactly with 'VOICE SUMMARY:' " +
        "followed by one or two short, plain sentences (no markdown, no links) " +
        "that say which product you recommend, its approximate price, and BUY, WAIT, WATCH, or SKIP. " +
        "This line will be read aloud to Jason."
    })
  }
);

const aiData = await aiResponse.json();

if (!aiResponse.ok) {
  console.error("OpenAI error:", aiData);
  throw new Error("OpenAI research failed");
}

const aiText =
  aiData.output_text ||
  aiData.output
    ?.flatMap(item => item.content || [])
    ?.find(item => item.type === "output_text")
    ?.text ||
  "Research completed, but no readable report was returned.";

return res.json({
  success: true,
  query: query.trim(),
  status: "complete",
  report: aiText,
  summary: extractVoiceSummary(aiText)
});

const researchTask = {

      id:
        "JS-" +
        Date.now(),

      query:
        query.trim(),

      budget:
        Number(budget) || null,

      mode:
        mode || "AI_DECIDE",

      status:
        "researching",

      createdAt:
        new Date().toISOString()

    };

    res.json({

      success: true,

      message:
        "Jason Shop received your research request.",

      task:
        researchTask

    });

  }

  catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      error: "Research request failed."
    });

  }

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