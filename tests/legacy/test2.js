const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const FIX = path.join(__dirname, "..", "fixtures");
const OUT = process.env.TEST_OUT || path.join(os.tmpdir(), "jason-shop-tests");
require("fs").mkdirSync(OUT, { recursive: true });
const revealShim = require("./reveal-shim");

const URL = "http://localhost:8080/index.html";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass=0, fail=0; const check=(n,c,x="")=>{ if(c){pass++;console.log("PASS",n);} else {fail++;console.log("FAIL",n,x);} };
const text=(p,s)=>p.$eval(s,e=>e.innerText);
async function waitFor(fn, ms=15000){ const t0=Date.now(); while(Date.now()-t0<ms){ try{ if(await fn()) return true; }catch(e){} await sleep(200);} return false; }
(async()=>{
 const b = await puppeteer.launch({executablePath:revealShim.CHROME,headless:"new",args:["--no-sandbox"]}); revealShim(b);
 const mk = async ({seed, intercept}={})=>{
  const p=await b.newPage();
  await p.setUserAgent("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36");
  await p.setViewport({width:384,height:854,isMobile:true,hasTouch:true,deviceScaleFactor:2});
  p.errors=[]; p.on("pageerror",e=>p.errors.push(e.message)); p.on("console",m=>{ if(m.type()==="error" && !/favicon|status of (404|500|502)/.test(m.text())) p.errors.push(m.text()); });
  p.dialogs=[]; p.on("dialog",d=>{p.dialogs.push(d.message()); d.accept();});
  p.bodies=[];
  await p.setRequestInterception(true);
  p.on("request", r=>{ if(r.method()==="POST" && r.url().includes("/api/research")) p.bodies.push(r.postData()); if(intercept && intercept(r)) return; r.continue(); });
  await p.goto(URL); await p.evaluate(s=>{localStorage.clear(); if(s) localStorage.JasonShopData=JSON.stringify(s);}, seed||null); await p.reload();
  return p;
 };
 const tap = async (p,sel)=>{ const el=await p.$(sel); await el.scrollIntoView(); await sleep(120); const bb=await el.boundingBox(); await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2); await sleep(250); };
 const typeInto = async (p,sel,v)=>{ await p.$eval(sel,e=>e.value=""); await tap(p,sel); const c=await p.target().createCDPSession(); await c.send("Input.insertText",{text:v}); };

if(process.env.ONLY9){}
 // 1. Every control reachable (no overlay), every nav tab works
 let p = await mk();
 const blocked = await p.evaluate(async()=>{const out=[];for(const el of document.querySelectorAll("nav button, main button, main input, main label, .tap")){ if(!el.getClientRects().length||el.classList.contains("hidden")) continue; el.scrollIntoView({block:"center"}); await new Promise(r=>setTimeout(r,20)); const r=el.getBoundingClientRect(); const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); if(!(t===el||el.contains(t)||t.contains(el))) out.push((el.id||el.getAttribute("onclick")||el.innerText.slice(0,20))+" covered by "+t.tagName+"#"+t.id);} return out;});
 check("1 no control is covered by an overlay", blocked.length===0, JSON.stringify(blocked));
 // Stage 1 nav: Home · Shop · Inventory · Budget · AI · More (receipts live in Shop → Receipts)
 for (const [tab,target,subtab] of [["navAI","shoppingTitle"],["navShop","receiptCard","[data-subtab='receipts']"],["navBudget","budgetCard"]]) {
  await p.evaluate(()=>window.scrollTo(0,0)); await sleep(300);
  await tap(p,"#"+tab); await sleep(900);
  if (subtab) { await tap(p,"#view-shop "+subtab); await sleep(600); }
  const [top,bottom] = await p.$eval("#"+target, e=>{const r=e.getBoundingClientRect(); return [Math.round(r.top),Math.round(r.bottom)];});
  check(`1 nav ${tab} brings its section fully into view (top=${top}) and highlights tab`, top>=0 && bottom<=854-60 && await p.$eval("#"+tab,e=>e.classList.contains("active")));
 }
 await tap(p,"#navHome"); await sleep(900);
 check("1 nav Home returns to top", (await p.evaluate(()=>scrollY))<5);
 // tappable money card -> budget + focus
 await tap(p,".card.tap"); await sleep(900);
 check("1 tapping SAFE TO SPEND card opens budget and focuses fund input", await p.evaluate(()=>document.activeElement.id==="fundInput"));

 // 2. Budget amounts in phone-style formats
 for (const [v,expect] of [["50k","₱50,000"],["₱20,000","₱20,000"],["500000","₱500,000"],["1.5m","₱1,500,000"]]) {
  await typeInto(p,"#fundInput",v); await p.$eval("#stopInput",e=>e.value=""); await tap(p,"button[onclick='saveBudget()']"); await sleep(150);
  check(`2 fund "${v}" -> ${expect}`, (await text(p,"#fundDisplay"))===expect, await text(p,"#fundDisplay"));
 }
 await typeInto(p,"#fundInput","abc"); await tap(p,"button[onclick='saveBudget()']"); await sleep(150);
 check("2 invalid amount shows message and keeps old fund", (await text(p,"#budgetMsg")).includes("Please check Shopping Fund") && (await text(p,"#fundDisplay"))==="₱1,500,000");
 await typeInto(p,"#fundInput","20,000"); await typeInto(p,"#stopInput","15k"); await typeInto(p,"#spentInput","0"); await tap(p,"button[onclick='saveBudget()']"); await sleep(150);
 check("2 fund+stop saved, safe = ₱15,000, success message, no alert popup", (await text(p,"#safe"))==="₱15,000" && (await text(p,"#budgetMsg")).includes("Budget saved") && p.dialogs.length===0);
 await p.reload();
 check("2 budget persists and form is prefilled after reload", (await p.$eval("#fundInput",e=>e.value))==="20,000" && (await p.$eval("#stopInput",e=>e.value))==="15,000");

 // 3. Research sends budget, job flow, then mark purchased updates Spent and stop-limit warning
 await p.$eval("button.primary[onclick='openAdd()']",e=>e.click()); await sleep(100);
 await p.type("#requestText","table fan under 5,000 php"); await p.$eval("button[onclick='saveRequest()']",e=>e.click());
 await sleep(200);
 check("3 shows 'Researching' while job runs", (await text(p,"#shoppingList")).includes("Researching"));
 const ok3 = await waitFor(async()=>(await text(p,"#shoppingList")).includes("AI Research ready"));
 check("3 research result shows in UI (job + polling, real REST shape without output_text)", ok3);
 const body = JSON.parse(p.bodies[0]||"{}");
 check("3 budget sent to AI", body.budget && body.budget.fund===20000 && body.budget.stop===15000, p.bodies[0]);
 await tap(p,"button.mini.buy"); await sleep(200);
 check("3 Mark purchased opens amount sheet", !(await p.$eval("#amountModal",e=>e.classList.contains("hidden"))));
 await typeInto(p,"#amountInput","13,000"); await tap(p,"button[onclick='confirmAmount()']"); await sleep(200);
 check("3 Spent = ₱13,000, safe = ₱2,000", (await text(p,"#spentDisplay"))==="₱13,000" && (await text(p,"#safe"))==="₱2,000");
 check("3 stop-limit WARNING (85%) shows", (await text(p,"#status")).includes("Approaching hard stop"));
 check("3 item shows purchased + undo", (await text(p,"#shoppingList")).includes("Purchased for ₱13,000"));
 await tap(p,"button[onclick^='undoPurchase']"); await sleep(150);
 check("3 Undo purchase restores Spent", (await text(p,"#spentDisplay"))==="₱0" && (await text(p,"#status")).includes("Safe to shop"));
 // over the hard stop needs a second confirm
 await tap(p,"button.mini.buy"); await typeInto(p,"#amountInput","16k"); await tap(p,"button[onclick='confirmAmount()']"); await sleep(150);
 check("3 going past hard stop asks for confirmation first", (await text(p,"#amountMsg")).includes("past your hard stop") && (await text(p,"#spentDisplay"))==="₱0");
 await tap(p,"button[onclick='confirmAmount()']"); await sleep(150);
 check("3 confirmed -> HARD STOP ACTIVE", (await text(p,"#status")).includes("HARD STOP ACTIVE") && (await text(p,"#safe"))==="₱0");
 await tap(p,"button[onclick^='undoPurchase']"); await sleep(150);
 // bad amount
 await tap(p,"button.mini.buy"); await typeInto(p,"#amountInput","lots"); await tap(p,"button[onclick='confirmAmount()']"); await sleep(150);
 check("3 invalid purchase amount -> friendly message", (await text(p,"#amountMsg")).includes("Please enter an amount"));
 await tap(p,"button[onclick='closeAmount()']"); await sleep(150);
 check("3 Skip closes amount sheet", await p.$eval("#amountModal",e=>e.classList.contains("hidden")));

 // 4. (receipt/photo flows are covered by test3.js) Spent stays in sync with the budget form
 await tap(p,"button.mini.buy"); await typeInto(p,"#amountInput","1,250"); await tap(p,"button[onclick='confirmAmount()']"); await sleep(150);
 check("4 purchase total added to Spent", (await text(p,"#spentDisplay"))==="₱1,250");
 check("4 budget form 'Already Spent' follows (1,250)", (await p.$eval("#spentInput",e=>e.value))==="1,250");
 await typeInto(p,"#fundInput","25k"); await tap(p,"button[onclick='saveBudget()']"); await sleep(150);
 check("4 editing fund later keeps Spent at ₱1,250", (await text(p,"#spentDisplay"))==="₱1,250" && (await text(p,"#fundDisplay"))==="₱25,000");
 check("4 no JS errors", p.errors.length===0, p.errors.join(" | "));
 await p.screenshot({path:path.join(OUT,"new-top.png")});
 await p.evaluate(()=>goTo("budget")); await sleep(800); await p.screenshot({path:path.join(OUT,"new-budget.png")});
 await p.close();

 // 5. Old data from previous versions
 p = await mk({seed:{fund:"0",stop:0,spent:0,requests:[{text:"old request",date:new Date().toISOString()},{text:"stuck one",date:new Date().toISOString(),status:"researching"}],receipts:[]}});
 const l5 = await text(p,"#shoppingList");
 check("5 old item gets 'Research now'; stuck item gets Retry", l5.includes("Research now") && l5.includes("Retry"));
 await tap(p,"button[onclick^='retryRequest']");
 check("5 'Research now' works on old item", await waitFor(async()=>(await text(p,"#shoppingList")).includes("AI Research ready")));
 check("5 no JS errors", p.errors.length===0, p.errors.join(" | "));
 await p.close();

 // 6. Resume after app closed mid-research
 p = await mk();
 await p.evaluate(()=>{ document.getElementById("requestText").value="SCEN_slow fan"; saveRequest(); });
 await waitFor(async()=>await p.evaluate(()=>!!JSON.parse(localStorage.JasonShopData).requests[0].jobId), 5000);
 await p.reload();
 check("6 after reload, item still researching (job id kept)", (await text(p,"#shoppingList")).includes("Researching"));
 check("6 resumed and finished after reload", await waitFor(async()=>(await text(p,"#shoppingList")).includes("AI Research ready")));
 await p.close();

 // 7. Phone loses connection during polling (first 3 status checks fail) -> still finishes
 let drops=0;
 p = await mk({intercept: r=>{ if(r.url().includes("/api/research/status/") && drops<3){ drops++; r.abort("internetdisconnected"); return true; } }});
 await p.evaluate(()=>{ document.getElementById("requestText").value="fan"; saveRequest(); });
 check("7 survives 3 dropped status checks and shows result", await waitFor(async()=>(await text(p,"#shoppingList")).includes("AI Research ready"), 30000), await text(p,"#shoppingList"));
 await p.close();

 // 8. Backend not yet deployed (no /start) -> falls back to old endpoint
 p = await mk({intercept: r=>{ if(r.method()==="POST" && r.url().endsWith("/api/research/start")){ r.respond({status:404,contentType:"application/json",headers:{"Access-Control-Allow-Origin":"*"},body:JSON.stringify({success:false,error:"Jason Shop API endpoint not found."})}); return true; } }});
 await p.evaluate(()=>{ document.getElementById("requestText").value="fan"; saveRequest(); });
 check("8 old backend: falls back to /api/research and shows result", await waitFor(async()=>(await text(p,"#shoppingList")).includes("AI Research ready")));
 await p.close();

 // 9. Server returns HTML error page (proxy timeout) -> friendly busy message
 p = await mk({intercept: r=>{ if(r.method()==="POST" && r.url().endsWith("/api/research/start")){ r.respond({status:502,contentType:"text/html",headers:{"Access-Control-Allow-Origin":"*"},body:"<html>timeout</html>"}); return true; } }});
 await p.evaluate(()=>{ document.getElementById("requestText").value="fan"; saveRequest(); });
 { const ok9=await waitFor(async()=>(await text(p,"#shoppingList")).includes("busy or restarting")); check("9 HTML/timeout reply -> server is busy message with Retry", ok9, await text(p,"#shoppingList")); }
 await p.close();

 // 10. Research job error -> shown with Retry
 p = await mk();
 await p.evaluate(()=>{ document.getElementById("requestText").value="SCEN_alwaysempty"; saveRequest(); });
 check("10 AI-empty error shown with Retry", await waitFor(async()=>(await text(p,"#shoppingList")).includes("without writing a report")));
 await p.close();

 await b.close();
 console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
