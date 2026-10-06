const realFetch = globalThis.fetch;
const calls = [];
globalThis.__calls = calls;
const msg = (t) => ({ type: "message", role: "assistant", content: [{ type: "output_text", annotations: [], text: t }] });
const REPORT = "## Best Overall\n**Hanabishi 16\" Stand Fan** – about ₱1,899 at Lazada https://www.lazada.com.ph/x.\nFits your ₱5,000 budget.\nRecommendation: BUY\n\nVOICE SUMMARY: Get the Hanabishi 16 inch stand fan for about 1,899 pesos. My call is BUY.";
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith("https://api.openai.com/v1/audio/transcriptions")) {
    return new Response(JSON.stringify({text: "Find me the best air fryer under 5,000 pesos"}), {status: 200, headers: {"Content-Type":"application/json"}});
  }
  if (String(url).startsWith("https://api.openai.com/v1/responses")) {
    const b = JSON.parse(opts.body);
    const scen = (b.input.match(/SCEN_(\w+)/) || [])[1] || "real";
    calls.push({ scen, model: b.model, max: b.max_output_tokens, reasoning: b.reasoning, hasBudget: b.input.includes("shopping budget"), budgetText: (b.input.match(/Jason's shopping budget:[^.]*\.[^.]*\./)||[""])[0] });
    console.log("MOCK", JSON.stringify(calls[calls.length-1]));
    await new Promise(r => setTimeout(r, scen === "slow" ? 3000 : 300));
    const J = (o, s=200) => new Response(JSON.stringify(o), { status: s, headers: {"Content-Type":"application/json"} });
    // real REST shape: NO output_text field
    const good = { id: "resp_1", object: "response", status: "completed", model: b.model, output: [ {type:"reasoning", id:"rs_1", summary:[]}, {type:"web_search_call", id:"ws_1", status:"completed"}, msg(REPORT) ], usage: {output_tokens: 2100} };
    if (scen === "real" || scen === "slow") return J(good);
    if (scen === "incomplete") {
      if (b.max_output_tokens <= 10000) return J({ status: "incomplete", incomplete_details: {reason:"max_output_tokens"}, model: b.model, output: [ {type:"reasoning"}, {type:"web_search_call"}, {type:"web_search_call"} ], usage:{output_tokens:b.max_output_tokens} });
      return J(good);
    }
    if (scen === "alwaysempty") return J({ status: "incomplete", incomplete_details: {reason:"max_output_tokens"}, output: [ {type:"reasoning"} ] });
    if (scen === "badmodel") {
      if (b.model === "gpt-5.6") return J({ error: { message: "The model `gpt-5.6` does not exist", type: "invalid_request_error", param: null, code: "model_not_found" } }, 404);
      return J(good);
    }
    if (scen === "noreasoning") {
      if (b.reasoning) return J({ error: { message: "Unsupported parameter: 'reasoning.effort' is not supported with this model.", param: "reasoning.effort", code: "unsupported_parameter" } }, 400);
      return J(good);
    }
    if (scen === "servererror") return J({ error: { message: "boom" } }, 500);
  }
  return realFetch(url, opts);
};
require(require("path").join(__dirname, "..", "..", "server.js"));
