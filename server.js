const express = require("express");
const cors = require("cors");

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