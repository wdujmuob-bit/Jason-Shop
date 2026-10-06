const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const FIX = path.join(__dirname, "..", "fixtures");
const OUT = process.env.TEST_OUT || path.join(os.tmpdir(), "jason-shop-tests");
require("fs").mkdirSync(OUT, { recursive: true });
const revealShim = require("./reveal-shim");

const URL = "http://localhost:8080/index.html";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra="") { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name, extra); } }

const fakeSR = `
  window.__spoken = [];
  const realSpeak = window.speechSynthesis && window.speechSynthesis.speak.bind(window.speechSynthesis);
  if (window.speechSynthesis) window.speechSynthesis.speak = u => { window.__spoken.push(u.text); };
  class FakeSR {
    constructor(){ this.lang=""; window.__sr = this; }
    start(){
      const mode = window.__srMode || "ok";
      setTimeout(()=>this.onstart && this.onstart(), 50);
      if (mode === "ok") {
        setTimeout(()=>this.onresult && this.onresult({results:[ Object.assign([{transcript:"best air fryer"}],{isFinal:false}) ]}), 200);
        setTimeout(()=>{ window.__interimSeen = document.getElementById("voiceTranscript").innerText; }, 300);
        setTimeout(()=>this.onresult && this.onresult({results:[ Object.assign([{transcript:"best air fryer under 5000 pesos"}],{isFinal:true}) ]}), 500);
        setTimeout(()=>this.onend && this.onend(), 600);
      } else if (mode === "hang") { } else if (mode === "nospeech") {
        setTimeout(()=>{ this.onerror && this.onerror({error:"no-speech"}); this.onend && this.onend(); }, 200);
      } else if (mode === "notallowed") {
        setTimeout(()=>{ this.onerror && this.onerror({error:"not-allowed"}); this.onend && this.onend(); }, 200);
      }
    }
    stop(){ setTimeout(()=>this.onend && this.onend(), 10); }
    abort(){}
  }
  if (!window.__noSR) { window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR; } else { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; }
`;

async function newPage(browser, { noSR=false, srMode="ok", denyMic=false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true }); // Galaxy-ish
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type()==="error" && !m.location().url.includes("favicon")) errors.push("console: " + m.text()); });
  await page.evaluateOnNewDocument(`window.__noSR=${noSR}; window.__srMode=${JSON.stringify(srMode)};` + fakeSR +
    (denyMic ? `navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("denied"),{name:"NotAllowedError"}));` : ""));
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  page.__errors = errors;
  return page;
}
const text = (p, sel) => p.$eval(sel, e => e.innerText);
async function waitText(p, sel, needle, ms=12000){ const t0=Date.now(); while(Date.now()-t0<ms){ if((await text(p,sel)).includes(needle)) return true; await sleep(200);} return false; }

(async () => {
  const browser = await puppeteer.launch({
    executablePath: revealShim.CHROME, headless: "new",
    args: ["--no-sandbox","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--use-file-for-fake-audio-capture="+FIX+"/speech.wav%noloop","--autoplay-policy=no-user-gesture-required"]
  });
  revealShim(browser);

  // A. typed flow still works
  let p = await newPage(browser);
  check("A page loads, mic button present", !!(await p.$("#micBtn")));
  check("A speak toggle defaults ON", await p.$eval("#speakToggle", e=>e.checked));
  check("A English chip selected by default", await p.$eval("#langEn", e=>e.classList.contains("on")));
  await p.click("button.primary[onclick='openAdd()']");
  await p.type("#requestText", "85 inch TV under 150000");
  await p.click("button[onclick='saveRequest()']");
  await sleep(200);
  let list = await text(p, "#shoppingList");
  check("A typed request added", list.includes("85 inch TV under 150000"));
  await waitText(p,"#shoppingList","AI Research ready");
  list = await text(p, "#shoppingList");
  check("A typed request shows AI research ready", list.includes("AI Research ready"), list);
  check("A report rendered with link", await p.$eval("#shoppingList .report a", a=>a.href).then(h=>h.startsWith("https://www.lazada.com.ph"), ()=>false));
  check("A typed request does NOT speak", (await p.evaluate(()=>window.__spoken.length)) === 0);
  check("A no JS errors", p.__errors.length===0, p.__errors.join(" | "));
  // budget still works
  await p.type("#fundInput","500000"); await p.type("#stopInput","450000");
  await p.$eval("button[onclick='saveBudget()']", b=>b.click()); await sleep(200);
  check("A budget save still works", (await text(p,"#safe")).includes("450,000"));
  await p.close();

  // B. Web Speech flow -> auto send -> spoken reply
  p = await newPage(browser);
  await p.click("#micBtn");
  await sleep(120);
  check("B listening state shown", (await text(p,"#voiceLabel")).includes("Listening"));
  check("B mic has listening class", await p.$eval("#micBtn", e=>e.classList.contains("listening")));
  await sleep(300);
  check("B interim transcript shown live", (await p.evaluate(()=>window.__interimSeen||"")).includes("best air fryer"));
  await sleep(400);
  check("B final transcript shown", (await text(p,"#voiceTranscript")).includes("best air fryer under 5000 pesos"));
  check("B Send/Edit/Cancel buttons visible", !(await p.$eval("#voiceActions", e=>e.classList.contains("hidden"))));
  check("B countdown shown", (await text(p,"#voiceLabel")).includes("Sending in"));
  check("B lang sent to recognizer = en-PH", (await p.evaluate(()=>window.__sr.lang))==="en-PH");
  await sleep(3500);
  list = await text(p, "#shoppingList");
  check("B voice request auto-sent into inbox with mic icon", list.includes("🎙️ best air fryer under 5000 pesos"), list);
  await waitText(p,"#shoppingList","AI Research ready");
  await sleep(300);
  list = await text(p, "#shoppingList");
  check("B research ready", list.includes("AI Research ready"));
  const spoken = await p.evaluate(()=>window.__spoken);
  check("B spoken summary read aloud", spoken.length===1 && spoken[0].includes("Hanabishi") && !spoken[0].includes("**"), JSON.stringify(spoken));
  check("B no JS errors", p.__errors.length===0, p.__errors.join(" | "));
  // Read summary button works even manually
  await p.$eval("#shoppingList details .mini", b=>b.click()); await sleep(100);
  check("B 'Read summary' button speaks", (await p.evaluate(()=>window.__spoken.length))===2);
  await p.close();

  // C. Edit path + Filipino + speak OFF
  p = await newPage(browser);
  await p.click("#langFil"); await p.click("#speakToggle");
  await p.click("#micBtn"); await sleep(800);
  check("C Filipino uses fil-PH", (await p.evaluate(()=>window.__sr.lang))==="fil-PH");
  await p.click("button[onclick='editVoice()']"); await sleep(100);
  check("C edit opens modal prefilled", (await p.$eval("#requestText", e=>e.value)).includes("best air fryer under 5000 pesos") && !(await p.$eval("#addModal", e=>e.classList.contains("hidden"))));
  await sleep(3500);
  check("C edit cancels auto-send", (await text(p,"#shoppingList")).includes("No shopping requests yet"));
  await p.click("button[onclick='saveRequest()']"); await waitText(p,"#shoppingList","AI Research ready");
  list = await text(p, "#shoppingList");
  check("C edited voice request researched", list.includes("🎙️") && list.includes("AI Research ready"), list);
  check("C speak OFF => nothing spoken", (await p.evaluate(()=>window.__spoken.length))===0);
  await p.reload();
  check("C settings persist after reload", await p.$eval("#langFil", e=>e.classList.contains("on")) && !(await p.$eval("#speakToggle", e=>e.checked)));
  // cancel path
  await p.click("#micBtn"); await sleep(800);
  await p.click("button[onclick='cancelVoice()']"); await sleep(3500);
  check("C cancel => no new request", (await p.evaluate(()=>JSON.parse(localStorage.JasonShopData).requests.length))===1);
  await p.close();

  // D. no-speech error
  p = await newPage(browser, { srMode: "nospeech" });
  await p.click("#micBtn"); await sleep(500);
  check("D no-speech friendly message", (await text(p,"#voiceHint")).includes("didn't hear"), await text(p,"#voiceHint"));
  check("D back to idle", (await text(p,"#voiceLabel"))==="Tap to talk");
  await p.close();

  // E. No Web Speech + mic denied
  p = await newPage(browser, { noSR: true, denyMic: true });
  await p.click("#micBtn"); await sleep(500);
  const hint = await text(p,"#voiceHint");
  check("E mic denied friendly message", hint.includes("Microphone access is blocked"), hint);
  check("E no JS errors", p.__errors.length===0, p.__errors.join(" | "));
  await p.close();

  // F. No Web Speech -> MediaRecorder fallback with fake mic, stop on silence, server transcribes
  p = await newPage(browser, { noSR: true });
  await p.click("#micBtn"); await sleep(700);
  check("F recording state shown", (await text(p,"#voiceLabel")).includes("Listening"), await text(p,"#voiceLabel"));
  let ok=false; for (let i=0;i<80;i++){ await sleep(100); const t=await text(p,"#voiceTranscript"); if (t.includes("air fryer under 5,000")) { ok=true; break; } }
  check("F auto-stopped on silence and transcript came back from /api/transcribe", ok, await text(p,"#voiceHint"));
  await sleep(3600);
  check("F transcript auto-sent", (await text(p,"#shoppingList")).includes("🎙️ Find me the best air fryer under 5,000 pesos"));
  check("F no JS errors", p.__errors.length===0, p.__errors.join(" | "));
  await p.close();

  // G. Web Speech blocked (not-allowed, like Samsung Internet) -> falls back to recorder
  p = await newPage(browser, { srMode: "notallowed" });
  await p.click("#micBtn");
  ok=false; for (let i=0;i<90;i++){ await sleep(100); const t=await text(p,"#voiceTranscript").catch(()=>""); if (t.includes("air fryer under 5,000")) { ok=true; break; } }
  check("G speech API blocked -> recorder fallback transcribed", ok, await text(p,"#voiceHint"));
  await p.close();

  // H. Fallback with server lacking key -> friendly message (route mock)
  p = await newPage(browser, { noSR: true });
  await p.setRequestInterception(true);
  p.on("request", r => r.url().includes("/api/transcribe") ? r.respond({status:503, contentType:"application/json", headers:{"Access-Control-Allow-Origin":"*"}, body: JSON.stringify({success:false,error:"Voice transcription is not set up on the server yet. Please type your request for now."})}) : r.continue());
  await p.click("#micBtn");
  ok=false; for (let i=0;i<80;i++){ await sleep(100); if ((await text(p,"#voiceHint")).includes("not set up")) { ok=true; break; } }
  check("H server error shown as friendly message", ok, await text(p,"#voiceHint"));
  await p.close();

  // I. Server unreachable during research -> retry button
  p = await newPage(browser);
  await p.setRequestInterception(true);
  p.on("request", r => r.url().includes("/api/research") ? r.abort() : r.continue());
  await p.click("button.primary[onclick='openAdd()']"); await p.type("#requestText","phone case"); await p.click("button[onclick='saveRequest()']"); await sleep(500);
  list = await text(p, "#shoppingList");
  check("I network failure shows Retry", list.includes("Could not reach") && list.includes("Retry"), list);
  await p.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e => { console.error(e); process.exit(1); });
