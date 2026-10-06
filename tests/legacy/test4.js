const puppeteer = require("puppeteer-core");
const path = require("path");
const os = require("os");
const FIX = path.join(__dirname, "..", "fixtures");
const OUT = process.env.TEST_OUT || path.join(os.tmpdir(), "jason-shop-tests");
require("fs").mkdirSync(OUT, { recursive: true });
const revealShim = require("./reveal-shim");

const fs = require("fs");
const URL = "http://localhost:8080/index.html";
const DL = path.join(OUT, "dl");
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass=0, fail=0; const check=(n,c,x="")=>{ if(c){pass++;console.log("PASS",n);} else {fail++;console.log("FAIL",n,x);} };
const text=(p,s)=>p.$eval(s,e=>e.innerText);
const val=(p,s)=>p.$eval(s,e=>e.value);
const visible=(p,s)=>p.$eval(s,e=>!e.classList.contains("hidden") && getComputedStyle(e).display!=="none");
async function waitFor(fn, ms=15000){ const t0=Date.now(); while(Date.now()-t0<ms){ try{ if(await fn()) return true; }catch(e){} await sleep(150);} return false; }
const ctl = q => fetch("http://localhost:3999/"+q).then(r=>r.json());
const SEED = () => ({ fund:20000, stop:0, spent:9523,
 requests:[{id:"R1",text:"Hanabishi stand fan",date:"2026-10-01T09:00:00+08:00",status:"done",report:"x",category:"Electronics & Appliances",purchased:{amount:1899,date:"2026-10-03T10:00:00+08:00"}}],
 receipts:[{id:"RC1",date:"2026-10-05T12:00:00+08:00",receiptDate:"2026-10-05",store:"SM Supermarket",payment:"Cash",items:[{name:"Rice Jasmine 5kg",qty:1,price:345},{name:"Mineral Water 6x1L",qty:2,price:180},{name:"Hanabishi Stand Fan",qty:1,price:1899}],total:2424,addedToSpent:true,category:"Groceries"},
           {name:"old.jpg",date:"2026-09-20T12:00:00+08:00",amount:4000}],
 manual:[{id:"M1",date:"2026-10-02",store:"Jollibee",item:"Chickenjoy bucket",amount:1200,payment:"GCash",counted:true}] });
function latestDownload(prefix, after){ const f=fs.readdirSync(DL).filter(n=>n.startsWith(prefix) && !n.endsWith(".crdownload")).map(n=>({n,t:fs.statSync(DL+"/"+n).mtimeMs})).filter(x=>x.t>=after).sort((a,b)=>b.t-a.t)[0]; return f && DL+"/"+f.n; }
(async()=>{
 fs.rmSync(DL,{recursive:true,force:true}); fs.mkdirSync(DL);
 const b = await puppeteer.launch({executablePath:revealShim.CHROME,headless:"new",args:["--no-sandbox"]}); revealShim(b);
 const mk = async (seed)=>{
  const p=await b.newPage();
  await p.setUserAgent("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36");
  await p.setViewport({width:384,height:854,isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const cdp=await p.target().createCDPSession(); await cdp.send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:DL});
  p.errors=[]; p.on("pageerror",e=>p.errors.push(e.message)); p.on("console",m=>{ if(m.type()==="error" && !/favicon|status of (4\d\d|5\d\d)/.test(m.text())) p.errors.push(m.text()); });
  p.dialogs=[]; p.on("dialog",d=>{ p.dialogs.push(d.message()); d.accept(); });
  await p.goto(URL); await p.evaluate(s=>{localStorage.clear(); if(s) localStorage.JasonShopData=JSON.stringify(s);}, seed||null); await p.reload();
  return p;
 };
 const tap = async (p,sel)=>{ const el=await p.$(sel); await el.scrollIntoView(); await sleep(100); const bb=await el.boundingBox(); await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2); await sleep(200); };
 const typeInto = async (p,sel,v)=>{ await p.$eval(sel,e=>e.value=""); await tap(p,sel); const c=await p.target().createCDPSession(); await c.send("Input.insertText",{text:v}); };
 const select = (p,sel,v)=>p.select(sel,v).then(()=>sleep(150));

 // ---------- HISTORY ----------
 let p = await mk(SEED());
 check("H0 legacy receipt migrated (amount → total, counted)", await p.evaluate(()=>{ const r=data.receipts[1]; return r.total===4000 && r.addedToSpent===true && r.amount===undefined && !!r.id; }));
 check("H1 default month = this month: 3 entries, ₱5,523", (await text(p,"#hSummary"))==="3 entries · ₱5,523 spent", await text(p,"#hSummary"));
 const hl = await text(p,"#historyList");
 check("H1 shows purchase, receipt (with items), manual entry", hl.includes("🛍️ Hanabishi stand fan") && hl.includes("🧾 SM Supermarket") && hl.includes("3 items: Rice Jasmine 5kg") && hl.includes("✍️ Chickenjoy bucket") && hl.includes("2026-10-02 · Jollibee · GCash"));
 check("H1 newest first", hl.indexOf("SM Supermarket") < hl.indexOf("Hanabishi stand fan") && hl.indexOf("Hanabishi stand fan") < hl.indexOf("Chickenjoy"));
 check("H3 keyword fallback: Jollibee → Food & Dining", hl.includes("🍔 Food & Dining"));
 await select(p,"#hMonth","all");
 check("H2 All months: 4 entries, ₱9,523", (await text(p,"#hSummary"))==="4 entries · ₱9,523 spent");
 check("H3 legacy receipt with no info → Other", (await text(p,"#historyList")).includes("📦 Other"));
 await select(p,"#hCategory","Groceries");
 check("H2 category filter Groceries → 1", (await text(p,"#hSummary")).startsWith("1 entry"));
 await select(p,"#hCategory","all");
 await typeInto(p,"#hSearch","gcash"); await sleep(150);
 check("H2 search 'gcash' → Jollibee only", (await text(p,"#hSummary")).startsWith("1 entry") && (await text(p,"#historyList")).includes("Chickenjoy"));
 await typeInto(p,"#hSearch","rice"); await sleep(150);
 check("H2 search matches receipt line items ('rice')", (await text(p,"#historyList")).includes("SM Supermarket") && (await text(p,"#hSummary")).startsWith("1 entry"));
 await typeInto(p,"#hSearch",""); await p.$eval("#hSearch",e=>{e.value="";e.dispatchEvent(new Event("input"));}); await select(p,"#hMonth","2026-10");

 // H4 add manual entry
 await tap(p,"button[onclick='openEntry(null)']");
 check("H4 'Add spending' sheet opens with today's date", await visible(p,"#entryModal") && (await val(p,"#eDate"))==="2026-10-06" && !(await visible(p,"#entryDeleteBtn")));
 await tap(p,"button[onclick='saveEntry()']");
 check("H4 amount required", (await text(p,"#entryMsg")).includes("Please enter the amount"));
 await typeInto(p,"#eAmount","850"); await typeInto(p,"#eStore","Mercury Drug"); await typeInto(p,"#eItem","Vitamins"); await typeInto(p,"#ePay","Cash");
 await tap(p,"button[onclick='saveEntry()']");
 check("H4 saved: Spent 9,523 → 10,373; auto category Health", (await text(p,"#spentDisplay"))==="₱10,373" && (await text(p,"#historyList")).includes("💊 Health & Personal Care") && (await text(p,"#historyList")).includes("Vitamins"));

 // H5 edit manual amount + category
 const mKey = await p.evaluate(()=>historyEntries().find(e=>e.title==="Chickenjoy bucket").key);
 await p.evaluate(k=>openEntry(k), mKey); await sleep(150);
 check("H5 edit sheet prefilled", (await val(p,"#eAmount"))==="1,200" && (await val(p,"#eStore"))==="Jollibee" && (await val(p,"#eItem"))==="Chickenjoy bucket" && (await val(p,"#eCategory"))==="Food & Dining");
 await typeInto(p,"#eAmount","1,500"); await select(p,"#eCategory","Groceries"); await tap(p,"button[onclick='saveEntry()']");
 check("H5 amount edit adjusts Spent by +300 (₱10,673)", (await text(p,"#spentDisplay"))==="₱10,673");
 check("H5 category change saved", await p.evaluate(()=>data.manual.find(m=>m.id==="M1").category==="Groceries"));

 // H6 receipt: untick counted
 await p.evaluate(()=>openEntry("r:RC1")); await sleep(150);
 check("H6 receipt edit hides item field and shows item count", !(await visible(p,"#eItemWrap")) && (await text(p,"#eItemsNote")).includes("3 item(s)"));
 await tap(p,"#eCounted"); await tap(p,"button[onclick='saveEntry()']");
 check("H6 untick 'Counts in Spent' → Spent −2,424 (₱8,249) + tag", (await text(p,"#spentDisplay"))==="₱8,249" && (await text(p,"#historyList")).includes("not counted in Spent"));
 check("H6 receipt list reflects it too", await p.evaluate(()=>{ const rows=[...document.querySelectorAll("#receiptList > *")]; const sm=rows.find(r=>r.innerText.includes("SM Supermarket")); const old=rows.find(r=>r.innerText.includes("old.jpg")||r.innerText.includes("Receipt")&&!r.innerText.includes("SM Supermarket")); return sm && !sm.innerText.includes("added to Spent") && old && old.innerText.includes("added to Spent"); }));

 // H7 delete purchase from history
 await p.evaluate(()=>deleteEntry("p:R1")); await sleep(150);
 check("H7 delete asks confirmation and takes it off Spent (₱6,350)", p.dialogs.some(d=>d.includes("Hanabishi stand fan") && d.includes("taken off Spent")) && (await text(p,"#spentDisplay"))==="₱6,350");
 check("H7 shopping item is back to 'Mark purchased'", (await text(p,"#shoppingList")).includes("Mark purchased"));
 // H8 hard stop in editor
 await p.evaluate(()=>{ data.stop=7000; save(); });
 await tap(p,"button[onclick='openEntry(null)']"); await typeInto(p,"#eAmount","2000"); await typeInto(p,"#eItem","Mattress"); await tap(p,"button[onclick='saveEntry()']");
 check("H8 past hard stop needs a second tap", (await text(p,"#entryMsg")).includes("past your hard stop") && (await text(p,"#spentDisplay"))==="₱6,350");
 await tap(p,"button[onclick='saveEntry()']");
 check("H8 second tap saves; Home & Furniture guessed", (await text(p,"#spentDisplay"))==="₱8,350" && (await text(p,"#historyList")).includes("🛋️ Home & Furniture"));
 check("H no JS errors", p.errors.length===0, p.errors.join(" | "));
 await p.close();

 // ---------- REPORT ----------
 p = await mk(SEED());
 await p.evaluate(()=>goTo("report")); await sleep(700);
 const rb = await text(p,"#reportBody");
 check("R1 month picker = this month, total ₱5,523", (await val(p,"#reportMonth"))==="2026-10" && rb.includes("₱5,523"));
 check("R1 vs fund: 28% of ₱20,000", rb.includes("28% of your ₱20,000 shopping fund"));
 check("R1 vs last month: ▲ ₱1,523 more than last month (₱4,000, +38%)", rb.includes("▲ ₱1,523 more than last month (₱4,000, +38%)"), rb.slice(0,300));
 check("R1 daily average ₱920.5 over 6 days, 3 purchases", rb.includes("₱920.5") && rb.includes("over 6 days") && rb.match(/PURCHASES\s*3/));
 check("R1 categories with amounts (Groceries ₱2,424, Electronics ₱1,899, Food ₱1,200)", rb.includes("Groceries\t₱2,424") || (rb.includes("Groceries") && rb.includes("₱2,424") && rb.includes("Electronics & Appliances") && rb.includes("₱1,899") && rb.includes("Food & Dining") && rb.includes("₱1,200")));
 check("R1 donut chart drawn (conic-gradient)", await p.$eval(".donut",e=>e.style.background.includes("conic-gradient")));
 check("R1 top stores + biggest purchases", rb.includes("Top stores") && rb.includes("🏬 SM Supermarket") && rb.indexOf("Biggest purchases") < rb.lastIndexOf("SM Supermarket"));
 await (await p.$("#reportCard")).screenshot({path:path.join(OUT,"report.png")});
 await tap(p,"button[onclick='shiftReportMonth(-1)']");
 check("R2 ◀ September: ₱4,000, no last-month data", (await val(p,"#reportMonth"))==="2026-09" && (await text(p,"#reportBody")).includes("₱4,000") && (await text(p,"#reportBody")).includes("No spending recorded last month"));
 await tap(p,"button[onclick='shiftReportMonth(1)']"); await tap(p,"button[onclick='shiftReportMonth(1)']");
 check("R2 November: empty state, no AI button", (await text(p,"#reportBody")).includes("No spending recorded for November 2026") && !(await visible(p,"#summaryBtn")));
 await p.evaluate(()=>setReportMonth("2026-10")); await sleep(100);
 await ctl("clear");
 await tap(p,"#summaryBtn");
 check("R3 AI summary appears (one call)", await waitFor(async()=>(await text(p,"#summaryBox")).includes("You spent ₱5,523")));
 const sm = (await ctl("seen")).filter(x=>x.kind==="summary");
 check("R3 exactly 1 summary call, no web search, real numbers sent", sm.length===1 && !sm[0].tools && sm[0].input.includes("total spent ₱5,523 across 3 purchases") && sm[0].input.includes("last month ₱4,000") && sm[0].input.includes("Groceries ₱2,424"), JSON.stringify(sm).slice(0,400));
 check("R3 markdown stripped, summary saved for the month", !(await text(p,"#summaryBox")).includes("**") && await p.evaluate(()=>!!data.reportSummaries["2026-10"]));
 await p.reload(); await sleep(300);
 check("R3 summary still there after reload (no new call)", (await text(p,"#summaryBox")).includes("You spent") && (await ctl("seen")).filter(x=>x.kind==="summary").length===1);
 check("R no JS errors", p.errors.length===0, p.errors.join(" | "));
 await p.close();

 // ---------- BACKUP / CSV / RESTORE ----------
 p = await mk(SEED());
 check("B2 never backed up + has data → reminder banner", await visible(p,"#backupBanner") && (await text(p,"#backupBannerText")).includes("only on this phone"));
 let t0=Date.now();
 await tap(p,"#backupBanner button[onclick='backupNow()']");
 let file; await waitFor(async()=>!!(file=latestDownload("jason-shop-backup-",t0-1000)),8000);
 check("B1 'Back up now' downloads jason-shop-backup-2026-10-06.json", !!file && file.endsWith("jason-shop-backup-2026-10-06.json"), String(file));
 const backup = JSON.parse(fs.readFileSync(file,"utf8"));
 check("B1 backup contains all data", backup.app==="Jason Shop" && backup.version===1 && backup.data.requests.length===1 && backup.data.receipts.length===2 && backup.data.manual.length===1 && backup.data.spent===9523 && backup.voiceSettings);
 check("B1 banner gone + 'Last backup: today'", !(await visible(p,"#backupBanner")) && (await text(p,"#lastBackupText")).startsWith("Last backup: today"));
 // CSV this month
 t0=Date.now(); await p.evaluate(()=>goTo("history")); await sleep(500); await tap(p,"#csvBtn");
 await waitFor(async()=>!!(file=latestDownload("jason-shop-purchases-2026-10",t0-1000)),8000);
 let csv = fs.readFileSync(file,"utf8");
 let lines = csv.replace(/^\uFEFF/,"").trim().split("\r\n");
 check("B4 CSV for October: BOM, header + 3 rows", csv.startsWith("\uFEFF") && lines.length===4 && lines[0].startsWith('"Date","Store","Items","Category"'), lines.join("\n"));
 check("B4 CSV receipt row has line items and amount", lines.some(l=>l.includes('"SM Supermarket"') && l.includes("Mineral Water 6x1L x2 (180.00)") && l.includes('"2424.00"') && l.includes('"Groceries"') && l.includes('"Cash"')));
 await select(p,"#hMonth","all"); t0=Date.now(); await tap(p,"#csvBtn");
 await waitFor(async()=>!!(file=latestDownload("jason-shop-purchases-all-time",t0-1000)),8000);
 check("B4 CSV all time: 4 rows", fs.readFileSync(file,"utf8").trim().split("\r\n").length===5);
 // formula-injection guard
 await p.evaluate(()=>{ data.manual.push({id:"MX",date:"2026-10-04",store:"=HYPERLINK(\"x\")",item:"test",amount:1,counted:false}); save(); });
 t0=Date.now(); await tap(p,"#csvBtn"); await waitFor(async()=>!!(file=latestDownload("jason-shop-purchases-all-time",t0-500)),8000);
 check("B4 CSV neutralises formulas (=…)", fs.readFileSync(file,"utf8").includes(`"'=HYPERLINK(""x"")"`));
 // Restore
 await p.evaluate(()=>{ data.manual=[]; data.spent=1; save(); });
 const [fc] = await Promise.all([p.waitForFileChooser(), tap(p,"button[onclick=\"document.getElementById('restoreFile').click()\"]")]);
 await fc.accept([DL+"/jason-shop-backup-2026-10-06.json"]); await sleep(500);
 const conf = p.dialogs.find(d=>d.startsWith("Restore the backup"));
 check("B3 restore asks for confirmation with a summary", !!conf && conf.includes("1 shopping items, 2 receipts, 1 manual entries, Spent ₱9,523"), String(conf));
 check("B3 data restored (manual entry back, Spent ₱9,523)", (await text(p,"#spentDisplay"))==="₱9,523" && (await text(p,"#historyList")).includes("Chickenjoy") && (await text(p,"#backupMsg")).includes("Restored"));
 check("B3 safety copy of previous data kept", await p.evaluate(()=>JSON.parse(localStorage["JasonShopData.beforeRestore"]).spent===1));
 // invalid file
 fs.writeFileSync(path.join(OUT,"notbackup.json"),JSON.stringify({hello:1}));
 const [fc2] = await Promise.all([p.waitForFileChooser(), tap(p,"button[onclick=\"document.getElementById('restoreFile').click()\"]")]);
 await fc2.accept([path.join(OUT,"notbackup.json")]); await sleep(400);
 check("B3 non-backup file rejected", (await text(p,"#backupMsg")).includes("isn't a Jason Shop backup") && (await text(p,"#spentDisplay"))==="₱9,523");
 check("B no JS errors", p.errors.length===0, p.errors.join(" | "));
 await p.close();
 // banner timing
 p = await mk(Object.assign(SEED(),{lastBackup:new Date(Date.now()-10*86400000).toISOString()}));
 check("B2 last backup 10 days ago → banner says so", await visible(p,"#backupBanner") && (await text(p,"#backupBannerText")).includes("10 days ago"));
 await tap(p,"button[onclick='snoozeBackup()']");
 check("B2 'Later' hides it for a day", !(await visible(p,"#backupBanner")) && await p.evaluate(()=>!!data.backupSnoozeUntil));
 await p.reload();
 check("B2 still snoozed after reload", !(await visible(p,"#backupBanner")));
 await p.close();
 p = await mk(Object.assign(SEED(),{lastBackup:new Date(Date.now()-3*86400000).toISOString()}));
 check("B2 backup 3 days ago → no banner", !(await visible(p,"#backupBanner")));
 await p.close();
 p = await mk();
 check("B2 empty app → no banner", !(await visible(p,"#backupBanner")));

 // ---------- AI CATEGORIES in existing flows ----------
 await ctl("set?product=photo&receipt=clear");
 const [rf] = await Promise.all([p.waitForFileChooser(), tap(p,"button[onclick='receiptCamera()']")]);
 await rf.accept([path.join(FIX,"imgs","receipt.jpg")]);
 check("C1 receipt card: AI category preselected (Groceries)", await waitFor(async()=>(await val(p,"#rCategory"))==="Groceries"));
 await tap(p,"button[onclick='confirmReceipt()']");
 check("C1 saved receipt has category, appears in history", await p.evaluate(()=>data.receipts[0].category==="Groceries") && (await text(p,"#historyList")).includes("🛒 Groceries"));
 await p.evaluate(()=>{ document.getElementById("requestText").value="best air fryer"; saveRequest(); });
 check("C2 research returns AI category, stored on item", await waitFor(async()=>await p.evaluate(()=>data.requests[0].category==="Electronics & Appliances")));
 check("C2 'CATEGORY:' line hidden from the report text", !(await text(p,"#shoppingList")).includes("CATEGORY:"));
 await tap(p,"button.mini.buy"); await typeInto(p,"#amountInput","3,499"); await tap(p,"button[onclick='confirmAmount()']");
 check("C2 marked purchased → history entry 'Electronics & Appliances' ₱3,499", (await text(p,"#historyList")).includes("🔌 Electronics & Appliances") && (await text(p,"#historyList")).includes("₱3,499"));
 const [pf] = await Promise.all([p.waitForFileChooser(), tap(p,"button[onclick='productCamera()']")]);
 await pf.accept([path.join(FIX,"imgs","product.jpg")]);
 await waitFor(async()=>(await val(p,"#pName")).includes("Hanabishi")); await tap(p,"button[onclick='researchFromPhoto()']");
 check("C3 photo product keeps AI category", await p.evaluate(()=>data.requests[0].source==="photo" && data.requests[0].category==="Electronics & Appliances"));
 // nav
 const navOk = await p.evaluate(()=>{ const bs=[...document.querySelectorAll("nav button")]; return bs.length===6 && bs.every(x=>x.getBoundingClientRect().width>=50) && document.querySelector("nav").scrollWidth<=document.querySelector("nav").clientWidth+1; });
 check("N 6 nav tabs fit on a 384px screen", navOk);
 // Stage 1 nav: History and Report moved from their own nav tabs into Budget → History / Report.
 for (const [sub,target] of [["history","historyTitle"],["report","reportTitle"]]) { await p.evaluate(()=>window.scrollTo(0,0)); await sleep(200); await tap(p,"#navBudget"); await sleep(500); await tap(p,"#view-budget [data-subtab='"+sub+"']"); await sleep(800);
  const top=await p.$eval("#"+target,e=>Math.round(e.getBoundingClientRect().top)); check(`N Budget → ${sub} shows its section near the top (top=${top})`, top>=0 && top<300 && await p.$eval("#navBudget",e=>e.classList.contains("active"))); }
 for (const [sec,target] of [["history","historyTitle"],["report","reportTitle"]]) { await p.evaluate(s=>goTo(s),sec); await sleep(800);
  const top=await p.$eval("#"+target,e=>Math.round(e.getBoundingClientRect().top)); check(`N goTo('${sec}') still scrolls to its section (top=${top})`, top>=0 && top<80); }
 check("C/N no JS errors", p.errors.length===0, p.errors.join(" | "));
 await p.screenshot({path:path.join(OUT,"history.png")});
 await p.close();

 await b.close();
 console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
