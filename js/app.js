
/* =========================================
   SETTINGS
========================================= */

const API_URL =
 (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:3000"
  : "https://jason-shop-api.onrender.com";

/* =========================================
   DATA: load + safe schema migration (js/model.js)
   The saved object keeps every original field (fund, stop, spent,
   requests, receipts, manual…) and adds the new entities beside them.
   Before an upgrade, the untouched data is copied to a safety snapshot
   (IndexedDB, or localStorage if that fails) BEFORE anything is saved.
========================================= */

const STORAGE_KEY="JasonShopData";

let bootInfo={ migrated:false };
let persistReady=true;     // false while the pre-migration safety copy is being written
let persistQueued=false;
let bootRawText=null;

let data=(function boot(){

 try{ bootRawText=localStorage.getItem(STORAGE_KEY); }catch(e){ bootRawText=null; }

 let parsed=null;

 if(bootRawText){
  try{ parsed=JSON.parse(bootRawText); }catch(e){ parsed=undefined; }
 }

 if(parsed===undefined || (bootRawText && (!parsed || typeof parsed!=="object"))){
  // Damaged saved data: never overwrite it silently. Keep a copy, start clean.
  let key=STORAGE_KEY+".damaged."+Date.now();
  try{ localStorage.setItem(key,bootRawText); }catch(e){}
  if(window.JasonStore) JasonStore.putSnapshot({ reason:"damaged data found at start-up", json:bootRawText }).catch(()=>{});
  bootInfo.damaged=key;
  parsed=null;
 }

 if(!parsed) return JasonModel.createEmpty();

 let result=JasonModel.migrate(parsed);

 Object.assign(bootInfo,{
  migrated:result.migrated, fromVersion:result.fromVersion, toVersion:result.toVersion,
  valid:result.valid, problems:result.problems, futureVersion:!!result.futureVersion,
  before:result.before, after:result.after, steps:result.steps
 });

 if(!result.migrated) return result.data;

 persistReady=false;   // wait for the safety snapshot (see finishBootSafety)

 if(!result.valid){
  // Counts didn't match after the upgrade: keep running on the original data
  // (only empty new lists added) and try again next time.
  let d=JasonModel.ensureShape(JasonModel.clone(parsed));
  delete d.schemaVersion;
  return d;
 }

 return result.data;

})();

let voiceSettings = Object.assign(
 { lang: "en", speak: true },
 (function(){ try{ return JSON.parse(localStorage.getItem("JasonShopVoice") || "{}") || {}; }catch(e){ return {}; } })()
);

// Kept for older code paths (restore, tests): legacy normalisation + new lists.
function normalizeData(d){
 return JasonModel.ensureShape(JasonModel.normalizeLegacy(d));
}

/* Amounts: accept 500000, 500,000, ₱500,000, 500k, 1.5m */
function parseAmount(text){

 let raw=String(text==null ? "" : text).trim().toLowerCase();

 if(!raw) return null;

 let multiplier=1;

 if(/k$/.test(raw)){ multiplier=1000; raw=raw.slice(0,-1); }
 else if(/m$/.test(raw)){ multiplier=1000000; raw=raw.slice(0,-1); }

 raw=raw.replace(/php|₱|p|,|\s/g,"");

 if(!/^\d*\.?\d+$/.test(raw)) return NaN;

 return Math.round(parseFloat(raw)*multiplier*100)/100;

}

function amountForInput(value){
 return value ? Number(value).toLocaleString("en-PH") : "";
}

function peso(number){
 return "₱" + Number(number || 0).toLocaleString("en-PH");
}

function save(){
 storeData();
 render();
}

// Photos make the saved data bigger. If the phone's storage for this
// site is full, drop the oldest thumbnails (the data itself is kept).
function storeData(){

 if(!persistReady){ persistQueued=true; return; }

 try{
  localStorage.setItem("JasonShopData",JSON.stringify(data));
  storageFull=false;
  return;
 }catch(error){ /* storage full — trim below */ }

 storageFull=true;

 let withThumbs=[...data.receipts,...data.requests].filter(x=>x.thumb);

 withThumbs.slice(Math.floor(withThumbs.length/2)).forEach(x=>{ delete x.thumb; });

 try{
  localStorage.setItem("JasonShopData",JSON.stringify(data));
 }catch(error){
  withThumbs.forEach(x=>{ delete x.thumb; });
  try{ localStorage.setItem("JasonShopData",JSON.stringify(data)); }catch(e){ console.warn("Storage full"); }
 }

}

let storageFull=false;

function safeThumb(src){
 return typeof src==="string" && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(src) ? src : "";
}

function render(){

 document.getElementById("fundDisplay").innerText=peso(data.fund);
 document.getElementById("spentDisplay").innerText=peso(data.spent);

 // Keep the form's "Already Spent" in step with purchases/receipts
 // (unless Jason is typing in it right now).
 let spentInput=document.getElementById("spentInput");
 if(spentInput && document.activeElement!==spentInput){
  spentInput.value=amountForInput(data.spent);
 }

 renderBudgetHero();

 let list=document.getElementById("shoppingList");

 if(!data.requests.length){

  list.innerHTML=
  '<div class="card">No shopping requests yet.</div>';

 }else{

  list.innerHTML=data.requests.map((r,i)=>`
   <div class="item">

    <button class="delete" onclick="deleteRequest(${i})">✕</button>

    ${safeThumb(r.thumb) ? `<img class="thumb" src="${safeThumb(r.thumb)}" alt="">` : ""}

    <b>${r.source==="voice" ? "🎙️ " : (r.source==="photo" ? "📷 " : "")}${escapeHTML(r.text)}</b>

    ${r.listing && (r.listing.price || r.listing.seller) ? `<small class="listing">🏷️ Seen on ${escapeHTML(r.listing.platform || "a shop")}${r.listing.price ? " for "+peso(r.listing.price) : ""}${r.listing.seller ? " · "+escapeHTML(r.listing.seller) : ""}</small>` : ""}

    ${researchStatusHTML(r)}

    <small>
    Added ${new Date(r.date).toLocaleString()}
    </small>

   </div>
  `).join("");

 }

 renderReceipts();
 renderHistory();
 renderReport();
 renderBackupState();
 renderStage1();

}

/* Safe to spend, warning state and usage bar — numbers from js/calc.js */
function budgetNow(){
 return JasonCalc.budgetSummary({
  fund:data.fund, spent:data.spent, stop:data.stop,
  committed:committedTotal(), reserve:reserveTotal(),
  thresholds:data.settings && data.settings.thresholds
 });
}

const STATE_CLASS={SETUP:"green",SAFE:"green",WATCH:"watch",WARNING:"orange",HARD_STOP:"red"};

function statusText(b){
 let info=b.stateInfo;
 let used=b.usedPct===null ? "" : " · "+Math.round(b.usedPct)+"% used";
 if(b.state==="SETUP") return info.icon+" Ready for setup — set your shopping fund";
 if(b.state==="SAFE") return info.icon+" SAFE · Safe to shop"+used;
 if(b.state==="WATCH") return info.icon+" WATCH · Keep an eye on spending"+used;
 if(b.state==="WARNING") return info.icon+" WARNING · "+(b.stop>0 ? "Approaching hard stop" : "Approaching your fund limit")+used;
 return info.icon+" HARD STOP ACTIVE"+used;
}

function renderBudgetHero(){

 let b=budgetNow();

 document.getElementById("safe").innerText=peso(b.safeToSpend);

 let over=document.getElementById("overLimit");
 over.classList.toggle("hidden",!(b.overBy>0));
 over.innerText=b.overBy>0 ? "⛔ OVER LIMIT BY "+peso(b.overBy) : "";

 let status=document.getElementById("status");
 status.innerText=statusText(b);
 status.className=STATE_CLASS[b.state]||"green";

 let wrap=document.getElementById("usageWrap");
 wrap.classList.toggle("hidden",b.usedPct===null);
 if(b.usedPct!==null){
  let t=JasonCalc.thresholdsOrDefault(data.settings.thresholds);
  let fill=document.getElementById("usageFill");
  fill.style.width=Math.min(100,Math.max(0,b.usedPct))+"%";
  fill.className="u-"+b.state.toLowerCase();
  document.getElementById("tickWatch").style.left=(t.watch/t.hardStop*100)+"%";
  document.getElementById("tickWarning").style.left=(t.warning/t.hardStop*100)+"%";
  document.getElementById("usageLegend").innerText=
   peso(b.used)+" used"+(b.committed>0 ? " (incl. "+peso(b.committed)+" committed)" : "")+" of "+peso(b.limit)+" "+(b.limitedBy==="hardStop" || (b.stop>0 && b.stop<=b.fund-b.reserve) ? "hard stop" : "limit");
 }

 document.getElementById("committedDisplay").innerText=peso(b.committed);
 document.getElementById("reserveDisplay").innerText=peso(b.reserve);
 document.getElementById("availableDisplay").innerText=b.availableCash===null ? "—" : JasonCalc.limitText(b.availableCash,"OVER BY");

}

function renderReceipts(){

 let list=document.getElementById("receiptList");
 let status=document.getElementById("receiptStatus");

 if(!data.receipts.length){
  list.innerHTML="";
  let link=document.getElementById("receiptArchiveLink"); if(link) link.innerHTML="";
  status.innerText="No receipts yet. Snap one and the AI reads the store, items and total for you.";
  return;
 }

 // Archived receipts (Stage 4) stay in the data and in history, but leave this list.
 let archivedCount=data.receipts.filter(r=>r.archived).length;
 let archiveBtn=`<button class="action wide" id="openReceiptArchive" onclick="goTo('receiptArchive')">🗂️ Receipt archive${archivedCount ? " ("+archivedCount+" archived)" : ""} · search all</button>`;

 let month=new Date().toISOString().slice(0,7);
 let monthTotal=data.receipts
  .filter(r=>(r.receiptDate || r.date || "").slice(0,7)===month)
  .reduce((sum,r)=>sum+(Number(r.total ?? r.amount)||0),0);

 status.innerText=data.receipts.length+" receipt"+(data.receipts.length===1?"":"s")+" saved · "+peso(monthTotal)+" this month";

 let link=document.getElementById("receiptArchiveLink");
 if(link) link.innerHTML=archiveBtn;

 list.innerHTML=data.receipts.map((r,i)=>{

  if(r.archived) return "";

  let total=r.total ?? r.amount;
  let items=Array.isArray(r.items) ? r.items : [];

  return `
   <div class="item">
    <button class="delete" onclick="deleteReceipt(${i})">✕</button>
    ${safeThumb(r.thumb) ? `<img class="thumb" src="${safeThumb(r.thumb)}" alt="">` : ""}
    <b>🧾 ${escapeHTML(r.store || r.name || "Receipt")}</b>
    <small>${escapeHTML(r.receiptDate || new Date(r.date).toLocaleDateString())}${r.payment ? " · "+escapeHTML(r.payment) : ""}</small>
    <small><b>${total ? peso(total) : "No total"}</b>${r.addedToSpent || r.amount ? ' <span class="tag">added to Spent</span>' : ""}${r.receiptNumber ? ' <span class="muted">#'+escapeHTML(r.receiptNumber)+'</span>' : ""}</small>
    ${typeof receiptMatchSummary==="function" ? receiptMatchSummary(r) : ""}
    ${items.length ? `
     <details>
      <summary>${items.length} item${items.length===1?"":"s"}</summary>
      <table class="receipt-items">
       ${items.map(it=>`<tr><td>${escapeHTML(it.name||"")}</td><td class="num">${it.qty ? "×"+it.qty : ""}</td><td class="num">${it.price!=null ? peso(it.price) : ""}</td></tr>`).join("")}
       ${r.vat!=null ? `<tr><td>VAT</td><td></td><td class="num">${peso(r.vat)}</td></tr>` : ""}
      </table>
     </details>` : ""}
   </div>`;

 }).join("");

}

function deleteReceipt(index){

 let r=data.receipts[index];

 if(!r)return;

 let amount=Number(r.total ?? r.amount)||0;
 let counted=(r.addedToSpent || r.amount) && amount>0;

 if(!confirm("Delete this receipt?"+(counted ? " "+peso(amount)+" will be taken off Spent." : "")))return;

 let before=data.spent;
 if(counted) data.spent=Math.max(0,data.spent-amount);

 archivePriceRecordsFor(r.id,"receipt deleted");
 audit("receipt.delete","Deleted receipt "+(r.store||r.name||"")+" ("+peso(amount)+")",{entity:"receipts",id:r.id,delta:-(before-data.spent),before:{receipt:r,spent:before},after:{spent:data.spent}});

 data.receipts.splice(index,1);

 save();

}

function purchaseHTML(r){

 if(r.purchased){
  return `<small class="purchased">🛒 Purchased for ${peso(r.purchased.amount)}</small>
   <button class="mini" onclick="undoPurchase('${r.id}')">↩ Undo purchase</button>`;
 }

 if(r.photo) return "";

 return `<button class="mini buy" onclick="markPurchased('${r.id}')">🛒 Mark purchased</button>`;

}

function researchStatusHTML(r){

 return researchPartHTML(r) + purchaseHTML(r);

}

function researchPartHTML(r){

 if(r.photo){
  return `<small>📷 Saved before photo reading existed. Tap 📷 Product to scan it again.</small>`;
 }

 if(r.status==="researching"){
  return `<small>🤖 AI Research: Researching… usually 1–2 minutes. You can leave the app; it will continue.</small>`;
 }

 if(r.status==="done"){
  return `
   <details ${r.id===lastFinishedId ? "open" : ""}>
    <summary>✅ AI Research ready — tap to view</summary>
    ${typeof researchIntelHTML==="function" ? researchIntelHTML(r) : ""}
    <div class="report">${formatReport(r.report)}</div>
    <button class="mini" onclick="readAloud('${r.id}')">🔊 Read summary</button>
   </details>`;
 }

 if(r.status==="error"){
  return `
   <small class="orange">⚠️ ${escapeHTML(r.error || "Research failed.")}</small>
   <button class="mini" onclick="retryRequest('${r.id}')">↻ Retry</button>`;
 }

 return `<small>🤖 AI Research: not started</small>
  <button class="mini" onclick="retryRequest('${r.id}')">🔎 Research now</button>`;

}

function escapeHTML(text){

 let div=document.createElement("div");
 div.innerText=text;
 return div.innerHTML;

}

// Light formatting for the AI report: safe (escaped first),
// bold text, headings and clickable links.
function formatReport(text){

 let raw=String(text || "").replace(/^[ \t]*\**CATEGORY:.*$\n?/gim,"");
 if(window.JasonModel && JasonModel.stripOfferLines) raw=JasonModel.stripOfferLines(raw);
 let html=escapeHTML(raw);

 html=html
  .replace(/\*\*(.+?)\*\*/g,"<b>$1</b>")
  .replace(/(^|<br>)\s*#{1,6}\s*([^<]+)/g,"$1<b>$2</b>")
  .replace(/https?:\/\/[^\s<]+/g,url=>{
   let clean=url.replace(/[).,\]]+$/,"");
   let rest=url.slice(clean.length);
   return `<a href="${clean}" target="_blank" rel="noopener">${clean}</a>${rest}`;
  });

 return html;

}

function openAdd(){

 document.getElementById("addModal").classList.remove("hidden");

}

function closeAdd(){

 document.getElementById("addModal").classList.add("hidden");

 voice.editing=false;

}

/* Typed requests (unchanged behaviour). A spoken request that
   Jason fixed with ✏️ Edit still counts as voice (for read-aloud). */
function saveRequest(){

 let text=document.getElementById("requestText").value.trim();

 if(!text)return;

 let source=voice.editing ? "voice" : "text";

 document.getElementById("requestText").value="";

 closeAdd();

 submitRequest(text,source);

}

/* =========================================
   ONE SHARED REQUEST FLOW
   Typed and spoken requests both come here,
   so research works exactly the same.
========================================= */

let lastFinishedId=null;

function submitRequest(text,source,extra){

 let request=Object.assign({
  id:"R"+Date.now()+Math.floor(Math.random()*1000),
  text:text,
  date:new Date().toISOString(),
  source:source,
  status:"researching"
 },extra||{});

 data.requests.unshift(request);

 save();

 runResearch(request.id,source);

}

async function runResearch(id,source){

 let request=findRequest(id);

 if(!request)return;

 let result;

 try{
  result=await researchWithJob(request);
 }catch(error){
  result={ success:false, error:friendlyError(error) };
 }

 request=findRequest(id);

 if(!request)return; // deleted while researching

 delete request.jobId;

 if(result && result.success && result.report){
  request.status="done";
  request.report=result.report;
  request.summary=result.summary || "";
  if(result.category) request.category=result.category;
  // Stage 3: keep where the answer came from, so prices get honest labels.
  request.sources=Array.isArray(result.sources) ? result.sources : [];
  // when the search ran; if the server clock is ahead of this phone, use the time it arrived here
  let foundAt=Date.parse(result.researchedAt||"");
  request.researchedAt=isFinite(foundAt) && foundAt<=Date.now() ? new Date(foundAt).toISOString() : new Date().toISOString();
  if(window.JasonModel && JasonModel.parseOffers) request.offers=JasonModel.parseOffers(result.report);
  delete request.error;
  lastFinishedId=id;
 }else{
  request.status="error";
  request.error=(result && result.error) || "Research failed. Tap Retry.";
 }

 save();

 if(source==="voice" && voiceSettings.speak){
  if(request.status==="done"){
   speak("Here's what I found. "+spokenSummary(request));
  }else{
   speak("Sorry, the research didn't finish. Please try again.");
  }
 }

}

function findRequest(id){
 return data.requests.find(r=>r.id===id);
}

/* ---------- Talking to the server ---------- */

class ServerError extends Error {}

async function fetchJSON(path,options,timeoutMs){

 let controller=new AbortController();
 let timer=setTimeout(()=>controller.abort(),timeoutMs||70000);

 try{

  let response=await fetch(API_URL+path,Object.assign({signal:controller.signal},options||{}));

  let body=null;
  try{ body=await response.json(); }catch(e){ body=null; }

  if(!body){
   throw new ServerError(response.status>=500
    ? "The server is busy or restarting. Please tap Retry in a minute."
    : "Unexpected reply from the server ("+response.status+").");
  }

  body.httpStatus=response.status;
  return body;

 }finally{
  clearTimeout(timer);
 }

}

function friendlyError(error){

 if(error instanceof ServerError) return error.message;
 if(error && error.name==="AbortError") return "The server took too long to answer. Please tap Retry.";
 return "Could not reach the Jason Shop server. Check your internet and tap Retry.";

}

function budgetForAI(){
 let b=budgetNow();
 return { fund:data.fund, spent:data.spent, stop:data.stop, committed:b.committed, reserve:b.reserve, safeToSpend:b.safeToSpend };
}

// Start a research job, then check on it every few seconds.
async function researchWithJob(request){

 if(!request.jobId){

  let started=await fetchJSON("/api/research/start",{
   method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({ query:request.query || request.text, budget:budgetForAI(), mode:"AI_DECIDE" })
  },75000); // allows for the free server waking up (~1 min)

  if(started.httpStatus===404){
   // Backend not updated yet: use the old one-shot endpoint.
   return await sendToJasonAI(request.query || request.text);
  }

  if(!started.success || !started.jobId){
   return started;
  }

  let live=findRequest(request.id);
  if(!live) return {success:false};
  live.jobId=started.jobId;
  storeData();
  request=live;

 }

 return await pollJob(request.jobId);

}

const POLL_MS=4000;
const POLL_LIMIT_MS=6*60*1000;
let pollWaiters=[];

async function pollJob(jobId,path,limitMs){

 let started=Date.now();
 path=path || "/api/research/status/";
 limitMs=limitMs || POLL_LIMIT_MS;
 let networkFailures=0;

 while(Date.now()-started<limitMs){

  await waitForNextPoll();

  let status;

  try{
   status=await fetchJSON(path+encodeURIComponent(jobId),{},30000);
   networkFailures=0;
  }catch(error){
   // Phones lose connection briefly (screen off, switching apps). Keep trying.
   networkFailures++;
   if(networkFailures>=8) throw error;
   continue;
  }

  if(status.status==="complete") return status;
  if(status.status==="error" || status.status==="missing") return status;

 }

 return { success:false, error:"Research is taking unusually long. Please tap Retry." };

}

// Wait POLL_MS, or less if the app comes back to the screen.
function waitForNextPoll(){
 return new Promise(resolve=>{
  let timer=setTimeout(done,POLL_MS);
  function done(){ clearTimeout(timer); pollWaiters=pollWaiters.filter(w=>w!==done); resolve(); }
  pollWaiters.push(done);
 });
}

document.addEventListener("visibilitychange",()=>{
 if(document.visibilityState==="visible") pollWaiters.slice().forEach(w=>w());
});

function resumeResearch(){
 data.requests
  .filter(r=>r.status==="researching" && r.jobId)
  .forEach(r=>runResearch(r.id,r.source));
}

// Wake the free Render server early so the first request is faster.
function wakeServer(){
 fetch(API_URL+"/api/health").catch(()=>{});
}

/* ---------- Purchases and budget ---------- */

let amountTarget=null;

function openAmount(target,title,sub,prefill){

 amountTarget=target;

 document.getElementById("amountTitle").innerText=title;
 document.getElementById("amountSub").innerText=sub||"";
 document.getElementById("amountInput").value=prefill||"";
 document.getElementById("amountMsg").innerText="";
 document.getElementById("amountMsg").className="form-msg";
 document.getElementById("amountModal").classList.remove("hidden");

 setTimeout(()=>document.getElementById("amountInput").focus(),50);

}

function closeAmount(){
 amountTarget=null;
 document.getElementById("amountModal").classList.add("hidden");
}

function markPurchased(id){

 let request=findRequest(id);

 if(!request)return;

 openAmount(
  {type:"purchase",id:id},
  "How much did you pay?",
  request.text,
  ""
 );

}

function undoPurchase(id){

 let request=findRequest(id);

 if(!request || !request.purchased)return;

 let before=data.spent;
 data.spent=Math.max(0,data.spent-Number(request.purchased.amount||0));

 audit("purchase.undo","Undid purchase: "+request.text,{entity:"requests",id:request.id,delta:-(before-data.spent),before:{spent:before,purchased:request.purchased},after:{spent:data.spent}});

 delete request.purchased;

 save();

}

function confirmAmount(){

 let amount=parseAmount(document.getElementById("amountInput").value);
 let msg=document.getElementById("amountMsg");

 if(amount===null || isNaN(amount) || amount<=0){
  msg.innerText="Please enter an amount, for example 4,599 or 4.6k.";
  msg.className="form-msg err";
  return;
 }

 let target=amountTarget;

 if(!target){ closeAmount(); return; }

 if(JasonCalc.crossesHardStop(data,amount) && !target.confirmedOverStop){
  msg.innerText="⚠️ This takes you to "+peso(data.spent+amount)+", past your hard stop of "+peso(data.stop)+". Tap ADD again to record it anyway.";
  msg.className="form-msg err";
  target.confirmedOverStop=true;
  return;
 }

 if(target.type==="purchase"){
  let request=findRequest(target.id);
  if(request && !request.purchased){
   request.purchased={
    amount:amount,
    date:new Date().toISOString(),
    category:request.category || guessCategory(request.text),
    store:(request.listing && request.listing.platform) || ""
   };
   data.spent+=amount;
   audit("purchase.add","Marked purchased: "+request.text+" ("+peso(amount)+")",{entity:"requests",id:request.id,delta:amount,after:{spent:data.spent}});
  }
 }

 if(target.type==="receipt"){
  let receipt=data.receipts[target.index];
  if(receipt && !receipt.amount){
   receipt.amount=amount;
   data.spent+=amount;
   audit("receipt.amount","Receipt amount added ("+peso(amount)+")",{entity:"receipts",id:receipt.id,delta:amount});
  }
 }

 closeAmount();

 save();

}

function retryRequest(id){

 let request=findRequest(id);

 if(!request)return;

 request.status="researching";

 save();

 runResearch(id,request.source);

}

function deleteRequest(index){

 let r=data.requests[index];

 if(!r) return;

 // A purchased item is part of your spending history: keep that purchase
 // as a spending entry so History, Spent and reports stay correct.
 if(r.purchased){
  if(!confirm("Remove \""+r.text+"\" from the inbox?\n\nIts purchase ("+peso(r.purchased.amount)+") stays in your Purchase History and Spent.")) return;
  let p=r.purchased;
  let entry={ id:"M"+Date.now(), date:localDay(p.date), store:p.store||"", item:p.itemName||r.text, amount:Number(p.amount)||0,
   category:p.category||r.category||guessCategory(r.text), payment:p.payment||"", counted:true, fromRequest:r.id };
  data.manual.unshift(entry);
  audit("purchase.moved","Inbox item removed; purchase kept in history: "+r.text,{entity:"manual",id:entry.id,before:{requestId:r.id}});
 }

 data.requests.splice(index,1);

 save();

}

function saveBudget(){

 let msg=document.getElementById("budgetMsg");

 let fund=parseAmount(document.getElementById("fundInput").value);
 let stop=parseAmount(document.getElementById("stopInput").value);
 let spent=parseAmount(document.getElementById("spentInput").value);

 let bad=[
  [fund,"Shopping Fund"],[stop,"Hard Stop Limit"],[spent,"Already Spent"]
 ].filter(([v])=>v!==null && (isNaN(v) || v<0)).map(([,name])=>name);

 if(bad.length){
  msg.innerText="Please check "+bad.join(", ")+". Use numbers like 500000, 500,000 or 500k.";
  msg.className="form-msg err";
  return;
 }

 let before={fund:data.fund,stop:data.stop,spent:data.spent};

 data.fund=fund||0;
 data.stop=stop||0;
 data.spent=spent||0;

 let after={fund:data.fund,stop:data.stop,spent:data.spent};
 if(JSON.stringify(before)!==JSON.stringify(after)){
  audit("budget.save","Budget changed: "+Object.keys(after).filter(k=>after[k]!==before[k]).map(k=>({fund:"fund",stop:"hard stop",spent:"spent"})[k]+" "+peso(before[k])+" → "+peso(after[k])).join(", "),
   {entity:"budget",delta:after.spent-before.spent||null,before,after});
 }

 save();
 fillBudgetForm();

 msg.innerText="✅ Budget saved. Safe to spend: "+document.getElementById("safe").innerText;
 msg.className="form-msg ok";

}

function fillBudgetForm(){
 document.getElementById("fundInput").value=amountForInput(data.fund);
 document.getElementById("stopInput").value=amountForInput(data.stop);
 document.getElementById("spentInput").value=amountForInput(data.spent);
}

function showBudget(focus){

 goTo("budget");

 if(focus===true){
  setTimeout(()=>document.getElementById("fundInput").focus({preventScroll:true}),450);
 }

}

/* Bottom navigation: see goTo() in js/features.js (tabbed views). */

function productCamera(){

 document.getElementById("productFile").click();

}

function receiptCamera(){

 document.getElementById("receiptFile").click();

}

/* =========================================
   PHOTOS: shrink on the phone, then let the AI read them
========================================= */

const PHOTO_MAX_SIDE=1600;
const PHOTO_QUALITY=0.82;
const PHOTO_MAX_UPLOAD=8*1024*1024;

let photo={ token:0, product:null, receipt:null };

function loadImageElement(file){
 return new Promise((resolve,reject)=>{
  let url=URL.createObjectURL(file);
  let img=new Image();
  img.onload=()=>{ URL.revokeObjectURL(url); resolve(img); };
  img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error("decode")); };
  img.src=url;
 });
}

function drawScaled(source,width,height,maxSide){
 let scale=Math.min(1,maxSide/Math.max(width,height));
 let canvas=document.createElement("canvas");
 canvas.width=Math.max(1,Math.round(width*scale));
 canvas.height=Math.max(1,Math.round(height*scale));
 let ctx=canvas.getContext("2d");
 ctx.fillStyle="#ffffff";               // transparent screenshots → white
 ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.drawImage(source,0,0,canvas.width,canvas.height);
 return canvas;
}

// → { blob (JPEG, max 1600px), thumb (small JPEG data URL), width, height }
async function prepareImage(file){

 let source, width, height;

 try{
  source=await createImageBitmap(file,{imageOrientation:"from-image"});
  width=source.width; height=source.height;
 }catch(error){
  try{
   source=await loadImageElement(file);
   width=source.naturalWidth; height=source.naturalHeight;
  }catch(error2){
   source=null;
  }
 }

 if(!source || !width || !height){
  // Can't decode here (e.g. some HEIC photos): send as-is if the server can take it.
  if(/^image\/(jpeg|png|webp)$/.test(file.type) && file.size<=PHOTO_MAX_UPLOAD){
   return { blob:file, thumb:"", width:0, height:0 };
  }
  throw new Error("This photo format can't be read. Please take a normal photo or a screenshot (JPG/PNG).");
 }

 let canvas=drawScaled(source,width,height,PHOTO_MAX_SIDE);
 let blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",PHOTO_QUALITY));
 let thumb=drawScaled(source,width,height,200).toDataURL("image/jpeg",0.6);

 if(source.close) source.close();

 if(!blob) throw new Error("Couldn't prepare the photo. Please try again.");

 return { blob, thumb, width:canvas.width, height:canvas.height };

}

async function readPhotoWithAI(kind,blob){

 let form=new FormData();
 form.append("kind",kind);
 form.append("image",blob,kind+".jpg");

 let started=await fetchJSON("/api/photo/start",{ method:"POST", body:form },75000);

 if(started.httpStatus===404){
  throw new ServerError("Photo reading needs the latest server update. Please redeploy jason-shop-api.");
 }

 if(!started.success || !started.jobId){
  throw new ServerError(started.error || "Couldn't send the photo. Please try again.");
 }

 let result=await pollJob(started.jobId,"/api/jobs/",3*60*1000);

 if(!result || result.status!=="complete"){
  throw new ServerError((result && result.error) || "The AI couldn't read this photo. Please try again.");
 }

 return result;

}

function setPhotoState(kind,html,isError){
 let el=document.getElementById(kind==="product" ? "productState" : "receiptState");
 el.innerHTML=html;
 el.classList.toggle("error",!!isError);
}

/* ---------- Product photo ---------- */

async function productSelected(input){

 if(!input.files.length)return;

 let file=input.files[0];
 input.value="";

 closeProduct();
 let token=++photo.token;
 photo.product={ file:file };

 document.getElementById("productModal").classList.remove("hidden");
 document.getElementById("productThumb").removeAttribute("src");
 setPhotoState("product",'<span class="spinner"></span>Preparing photo…');

 try{
  let prepared=await prepareImage(file);
  if(token!==photo.token)return;
  photo.product.prepared=prepared;
  if(prepared.thumb) document.getElementById("productThumb").src=prepared.thumb;
  await identifyProduct(token);
 }catch(error){
  if(token!==photo.token)return;
  setPhotoState("product","⚠️ "+escapeHTML(error.message),true);
  document.getElementById("productRetry").classList.remove("hidden");
 }

}

async function identifyProduct(token){

 document.getElementById("productRetry").classList.add("hidden");
 document.getElementById("productFields").classList.add("hidden");
 setPhotoState("product",'<span class="spinner"></span>Looking at your photo… (about 10–30 seconds)');

 try{

  let result=await readPhotoWithAI("product",photo.product.prepared.blob);
  if(token!==photo.token)return;

  fillProduct(result.product || {});

 }catch(error){

  if(token!==photo.token)return;
  setPhotoState("product","⚠️ "+escapeHTML(friendlyError(error))+"<br>You can also type the product name below.",true);
  document.getElementById("productRetry").classList.remove("hidden");
  fillProduct({ is_product:false, product_name:"", key_specs:[], listing:{found:false} });

 }

}

function fillProduct(p){

 photo.product.ai=p;

 document.getElementById("pName").value=p.product_name || "";
 document.getElementById("pSpecs").value=(p.key_specs || []).join(", ");

 let listing=p.listing || {};
 document.getElementById("pListingBox").classList.toggle("hidden",!listing.found);
 document.getElementById("pPlatform").innerText=listing.platform ? "("+listing.platform+")" : "";
 document.getElementById("pPrice").value=listing.price_php ? amountForInput(listing.price_php) : "";
 document.getElementById("pSeller").value=listing.seller || "";

 let note="";
 if(p.is_product===false){
  note="I couldn't recognise a product in this photo. Type what it is and I'll research it.";
 }else if(p.confidence==="low"){
  note="I'm not fully sure about this one — please check the name before researching.";
 }else if(listing.found){
  note="I'll compare this listing's price and seller with other stores.";
 }
 if(p.notes && p.is_product===false) note+=" ("+p.notes+")";
 document.getElementById("pNote").innerText=note;

 if(p.is_product!==false){
  setPhotoState("product","✅ Here's what I see. Fix anything that's wrong, then tap Research.");
 }else if(!document.getElementById("productState").classList.contains("error")){
  setPhotoState("product","🤔 No product found in this photo.",true);
 }

 document.getElementById("productFields").classList.remove("hidden");

}

function retryPhoto(kind){
 if(kind==="product" && photo.product && photo.product.prepared){
  identifyProduct(++photo.token);
 }
}

function researchFromPhoto(){

 let name=document.getElementById("pName").value.trim();

 if(!name){
  document.getElementById("pNote").innerText="Please type what the product is first.";
  document.getElementById("pName").focus();
  return;
 }

 let specs=document.getElementById("pSpecs").value.trim();
 let ai=(photo.product && photo.product.ai) || {};
 let showListing=!document.getElementById("pListingBox").classList.contains("hidden");
 let price=showListing ? parseAmount(document.getElementById("pPrice").value) : null;
 let seller=showListing ? document.getElementById("pSeller").value.trim() : "";
 let platform=showListing ? ((ai.listing && ai.listing.platform) || "an online shop") : "";

 // The server adds ". " after the request, so no trailing full stop here.
 let parts=[name.replace(/[.\s]+$/,"")];

 if(specs) parts.push("Key specs: "+specs.replace(/[.\s]+$/,""));

 if(showListing && (price>0 || seller)){
  parts.push("Jason saw this listed on "+platform+
   (price>0 ? " for "+peso(price) : "")+
   (seller ? " from seller \""+seller+"\"" : ""));
  parts.push("Compare that listing's price and seller reliability with the same product at other Philippine and international stores, and say whether it is a good deal");
 }

 let query=parts.join(". ");

 let thumb=photo.product && photo.product.prepared ? photo.product.prepared.thumb : "";

 submitRequest(name,"photo",{
  query:query,
  thumb:thumb,
  category:ai.category || null,
  listing:showListing && (price>0 || seller) ? { platform:platform, price:price>0 ? price : null, seller:seller } : null
 });

 closeProduct();

 goTo("shopping");

}

function closeProduct(){
 photo.token++;
 photo.product=null;
 document.getElementById("productModal").classList.add("hidden");
 document.getElementById("productFields").classList.add("hidden");
 document.getElementById("productRetry").classList.add("hidden");
 setPhotoState("product","");
}

/* ---------- Receipt photo ---------- */

async function receiptSelected(input){

 if(!input.files.length)return;

 let file=input.files[0];
 input.value="";

 closeReceipt();
 let token=++photo.token;
 photo.receipt={};

 document.getElementById("receiptModal").classList.remove("hidden");
 document.getElementById("receiptThumb").removeAttribute("src");
 setPhotoState("receipt",'<span class="spinner"></span>Preparing photo…');

 try{

  let prepared=await prepareImage(file);
  if(token!==photo.token)return;
  photo.receipt.prepared=prepared;
  if(prepared.thumb) document.getElementById("receiptThumb").src=prepared.thumb;

  setPhotoState("receipt",'<span class="spinner"></span>Reading your receipt… (about 10–30 seconds)');

  let result=await readPhotoWithAI("receipt",prepared.blob);
  if(token!==photo.token)return;

  handleReceiptResult(result.receipt || {});

 }catch(error){

  if(token!==photo.token)return;
  setPhotoState("receipt","⚠️ "+escapeHTML(friendlyError(error)),true);
  document.getElementById("receiptRetry").classList.remove("hidden");

 }

}

function handleReceiptResult(r){

 photo.receipt.ai=r;

 if(r.is_receipt===false){
  setPhotoState("receipt","🤔 This doesn't look like a receipt. Retake the photo, or enter it manually.",true);
  document.getElementById("receiptRetry").classList.remove("hidden");
  return;
 }

 if(r.readability==="unreadable"){
  setPhotoState("receipt","📷 Too blurry or cut off to read"+(r.problems ? " ("+escapeHTML(r.problems)+")" : "")+
   ". Retake it flat, in good light, with the whole receipt in the frame — or enter it manually.",true);
  document.getElementById("receiptRetry").classList.remove("hidden");
  return;
 }

 fillReceipt(r);

 let warnings=(r.warnings || []).slice();
 if(r.readability==="partly_readable") warnings.unshift("Parts of the receipt were hard to read"+(r.problems ? ": "+r.problems : "")+".");
 document.getElementById("rWarn").innerText=warnings.join(" ");

 setPhotoState("receipt","✅ Please check the details, then tap Save.");

}

function showReceiptFields(manual){
 if(manual){
  fillReceipt({ items:[] });
  document.getElementById("rWarn").innerText="";
  setPhotoState("receipt","✏️ Enter the receipt details.");
 }
 document.getElementById("receiptRetry").classList.add("hidden");
 document.getElementById("receiptFields").classList.remove("hidden");
}

function fillReceipt(r){

 document.getElementById("rStore").value=r.store || "";
 document.getElementById("rDate").value=r.date || new Date().toISOString().slice(0,10);
 document.getElementById("rPay").value=r.payment_method || "";
 document.getElementById("rSubtotal").value=r.subtotal!=null ? amountForInput(r.subtotal) : "";
 document.getElementById("rVat").value=r.vat!=null ? amountForInput(r.vat) : "";
 document.getElementById("rTotal").value=r.total!=null ? amountForInput(r.total) : "";
 document.getElementById("rAddSpent").checked=true;
 fillCategorySelect("rCategory", r.category || "", true);
 document.getElementById("rMsg").innerText="";
 document.getElementById("rMsg").className="form-msg";

 let rows=document.getElementById("rItems");
 rows.innerHTML="";
 (r.items || []).forEach(it=>addReceiptItem({
  name:it.name,
  qty:it.qty,
  price:it.line_total!=null ? it.line_total : (it.unit_price!=null ? it.unit_price*(it.qty||1) : null)
 }));

 showReceiptFields(false);

}

function addReceiptItem(it){

 it=it || {};

 let row=document.createElement("div");
 row.className="item-row";
 row.innerHTML=
  '<input class="ri-name" type="text" autocomplete="off" placeholder="Item">'+
  '<input class="ri-qty" type="text" inputmode="decimal" autocomplete="off" placeholder="1">'+
  '<input class="ri-price" type="text" inputmode="decimal" autocomplete="off" placeholder="0">'+
  '<button type="button" aria-label="Remove item">✕</button>';

 row.querySelector(".ri-name").value=it.name || "";
 row.querySelector(".ri-qty").value=it.qty!=null ? it.qty : "";
 row.querySelector(".ri-price").value=it.price!=null ? amountForInput(it.price) : "";
 row.querySelector("button").onclick=()=>row.remove();

 document.getElementById("rItems").appendChild(row);

}

function confirmReceipt(){

 let msg=document.getElementById("rMsg");
 let total=parseAmount(document.getElementById("rTotal").value);
 let subtotal=parseAmount(document.getElementById("rSubtotal").value);
 let vat=parseAmount(document.getElementById("rVat").value);
 let addToSpent=document.getElementById("rAddSpent").checked;

 if(total===null || isNaN(total) || total<=0){
  msg.innerText="Please enter the total paid, for example 1,250.";
  msg.className="form-msg err";
  document.getElementById("rTotal").focus();
  return;
 }

 if([subtotal,vat].some(v=>v!==null && isNaN(v))){
  msg.innerText="Please check the subtotal and VAT amounts.";
  msg.className="form-msg err";
  return;
 }

 let rStore=document.getElementById("rStore").value.trim();
 let rDate=document.getElementById("rDate").value || "";
 let rNumber=(photo.receipt.ai && photo.receipt.ai.receipt_number) ? String(photo.receipt.ai.receipt_number).trim() : "";
 let dup=JasonModel.findDuplicateReceipt(data.receipts,{ store:rStore, receiptDate:rDate, total:total, receiptNumber:rNumber });
 if(dup && !photo.receipt.confirmedDuplicate){
  msg.innerText="⚠️ This looks like a receipt you already saved ("+(dup.receipt.store||"receipt")+", "+(dup.receipt.receiptDate||localDay(dup.receipt.date))+", "+peso(dup.receipt.total)+(dup.reason==="same_number" ? ", same receipt number" : "")+"). Saving it again would count it twice. Tap Save again only if it's a different purchase.";
  msg.className="form-msg err";
  msg.dataset.dup=dup.reason;
  photo.receipt.confirmedDuplicate=true;
  return;
 }

 if(addToSpent && JasonCalc.crossesHardStop(data,total) && !photo.receipt.confirmedOverStop){
  msg.innerText="⚠️ This takes Spent to "+peso(data.spent+total)+", past your hard stop of "+peso(data.stop)+". Tap Save again to record it anyway.";
  msg.className="form-msg err";
  photo.receipt.confirmedOverStop=true;
  return;
 }

 let items=[...document.querySelectorAll("#rItems .item-row")].map(row=>{
  let qty=parseAmount(row.querySelector(".ri-qty").value);
  let price=parseAmount(row.querySelector(".ri-price").value);
  return {
   name:row.querySelector(".ri-name").value.trim(),
   qty:qty>0 ? qty : null,
   price:price!==null && !isNaN(price) ? price : null
  };
 }).filter(it=>it.name || it.price!=null);

 data.receipts.unshift({
  id:"RC"+Date.now(),
  date:new Date().toISOString(),
  receiptDate:document.getElementById("rDate").value || "",
  store:rStore,
  payment:document.getElementById("rPay").value.trim(),
  receiptNumber:rNumber,
  duplicateOf:dup ? dup.receipt.id : null,
  items:items,
  subtotal:subtotal,
  vat:vat,
  total:total,
  addedToSpent:addToSpent,
  thumb:(photo.receipt.prepared && photo.receipt.prepared.thumb) || "",
  readByAI:!!photo.receipt.ai,
  category:document.getElementById("rCategory").value ||
   guessCategory([document.getElementById("rStore").value].concat(items.map(it=>it.name)).join(" "))
 });

 if(addToSpent) data.spent+=total;

 let savedReceipt=data.receipts[0];
 let learned=JasonModel.priceRecordsFromReceipt(data,savedReceipt);
 let fed=typeof feedReceipt==="function" ? feedReceipt(savedReceipt) : {stocked:0,listBought:0};
 audit("receipt.add","Saved receipt "+(savedReceipt.store||"")+" ("+peso(total)+")"+(learned.priceRecords ? " · "+learned.priceRecords+" price"+(learned.priceRecords===1?"":"s")+" added to Price Book" : "")+
  (learned.review ? " · "+learned.review+" to check" : "")+(learned.unknown ? " · "+learned.unknown+" new product"+(learned.unknown===1?"":"s") : "")+(fed.stocked ? " · "+fed.stocked+" restocked" : "")+(fed.listBought ? " · "+fed.listBought+" ticked off the list" : "")+(dup ? " · saved despite duplicate warning" : ""),
  {entity:"receipts",id:savedReceipt.id,delta:addToSpent ? total : 0,after:{spent:data.spent,matches:{high:learned.high,review:learned.review,unknown:learned.unknown}}});

 closeReceipt();

 save();

 goTo(learned.review ? "review" : "receipts");
 if(typeof toast==="function" && (learned.review || fed.stocked || fed.listBought)) toast("🧾 Saved"+(fed.stocked ? " · "+fed.stocked+" restocked" : "")+(fed.listBought ? " · "+fed.listBought+" ticked off" : "")+(learned.review ? " · "+learned.review+" line"+(learned.review===1?"":"s")+" to check" : ""));

}

function closeReceipt(){
 photo.token++;
 photo.receipt=null;
 document.getElementById("receiptModal").classList.add("hidden");
 document.getElementById("receiptFields").classList.add("hidden");
 document.getElementById("receiptRetry").classList.add("hidden");
 setPhotoState("receipt","");
}

/* =========================================
   CATEGORIES
========================================= */

const DEFAULT_CATEGORIES=[
 {name:"Groceries",icon:"🛒",color:"#67e09a"},
 {name:"Household",icon:"🧴",color:"#7fb0ff"},
 {name:"Electronics & Appliances",icon:"🔌",color:"#1769ff"},
 {name:"Baby & Kids",icon:"🍼",color:"#ff9ad5"},
 {name:"Pet",icon:"🐶",color:"#c49a6c"},
 {name:"Health & Personal Care",icon:"💊",color:"#ff6b6b"},
 {name:"Clothing",icon:"👕",color:"#b18cff"},
 {name:"Home & Furniture",icon:"🛋️",color:"#ffbd66"},
 {name:"Food & Dining",icon:"🍔",color:"#ff8a3d"},
 {name:"Other",icon:"📦",color:"#8e99ad"}
];

// Simple keyword fallback (English + common Filipino words and PH stores).
const CATEGORY_KEYWORDS={
 "Baby & Kids":["baby","babies","diaper","diapers","pampers","huggies","eq dry","formula","infant","toddler","stroller","crib","toy","toys","kids","kid","wipes","feeding bottle","nido","similac","enfamil","bonna","lactum","s-26"],
 "Pet":["dog","dogs","cat","cats","pet","pets","pedigree","whiskas","royal canin","leash","kibble","vet","petco","pet food","dog food","cat litter","litter"],
 "Electronics & Appliances":["tv","television","fan","electric fan","stand fan","aircon","air conditioner","refrigerator","ref","fridge","washing machine","washer","phone","smartphone","iphone","laptop","tablet","ipad","charger","cable","earbuds","headphones","headset","speaker","router","rice cooker","air fryer","microwave","oven","blender","flat iron","flat-iron","appliance","appliances","electronics","camera","monitor","printer","power bank","powerbank","hanabishi","xiaomi","samsung","abenson","anson","imarflex","kyowa","asahi","electric"],
 "Health & Personal Care":["medicine","gamot","vitamin","vitamins","pharmacy","mercury drug","watsons","southstar","rose pharmacy","shampoo","conditioner","toothpaste","toothbrush","lotion","deodorant","sunscreen","biogesic","neozep","paracetamol","alcohol","face mask","sanitary","napkin","razor","clinic","hospital","dental"],
 "Clothing":["shirt","tshirt","t-shirt","pants","jeans","shorts","dress","shoes","sneakers","slippers","tsinelas","socks","jacket","uniform","underwear","bra","uniqlo","h&m","penshoppe","bench","zara","clothes","clothing"],
 "Home & Furniture":["chair","table","sofa","bed","mattress","cabinet","shelf","drawer","curtain","pillow","bedsheet","blanket","furniture","lamp","wilcon","ace hardware","handyman","ikea","mandaue foam","our home","hardware","paint","tiles","faucet"],
 "Food & Dining":["restaurant","jollibee","mcdo","mcdonald","mcdonalds","chowking","greenwich","mang inasal","kfc","starbucks","coffee shop","cafe","pizza","burger","grabfood","grab food","foodpanda","samgyup","milk tea","dine in","take out","takeout","meal"],
 "Household":["detergent","fabric conditioner","dishwashing","tissue","toilet paper","bleach","zonrox","ariel","tide","surf","downy","joy","cleaner","trash bag","garbage bag","sponge","broom","mop","walis","battery","batteries","bulb","light bulb","insecticide","baygon","air freshener","laundry"],
 "Groceries":["rice","bigas","milk","gatas","egg","eggs","itlog","bread","tinapay","water","mineral water","sugar","asukal","oil","mantika","coffee","kape","noodles","pancit","canned","sardines","corned beef","tuna","grocery","groceries","supermarket","landers","s&r","puregold","savemore","sm supermarket","robinsons supermarket","walter mart","palengke","market","fish","isda","pork","baboy","chicken","manok","beef","vegetables","gulay","fruit","fruits","prutas","banana","saging","snacks","juice","soda","softdrinks","cereal","flour","salt","soy sauce","toyo","vinegar","suka"]
};

function guessCategory(text){

 let t=" "+String(text||"").toLowerCase().replace(/[^a-z0-9&\-\s]/g," ").replace(/\s+/g," ")+" ";
 let best="Other", bestScore=0;

 Object.entries(CATEGORY_KEYWORDS).forEach(([cat,words])=>{
  let score=0;
  words.forEach(w=>{ if(t.includes(" "+w+" ")) score+=w.includes(" ") ? 2 : 1; });
  if(score>bestScore){ best=cat; bestScore=score; }
 });

 return best;

}

// Editable categories (Budget → Plan). The ten originals are built in.
function allCategories(){
 return (data.budgetCategories && data.budgetCategories.length) ? data.budgetCategories : DEFAULT_CATEGORIES;
}

function activeCategories(){
 return allCategories().filter(c=>!c.archived);
}

// Kept as a live list so older code (history filters) still works.
Object.defineProperty(window,"CATEGORIES",{ get:activeCategories, configurable:true });

function categoryInfo(name){
 return allCategories().find(c=>c.name===name) ||
  (name && name!=="Other" ? {name:name,icon:"🏷️",color:"#8e99ad"} : null) ||
  DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length-1];
}

function fillCategorySelect(id,selected,withAuto){
 let el=document.getElementById(id);
 let list=activeCategories().slice();
 if(selected && !list.some(c=>c.name===selected)) list.push(categoryInfo(selected));
 el.innerHTML=(withAuto ? '<option value="">✨ Auto-detect</option>' : "")+
  list.map(c=>`<option value="${escapeHTML(c.name)}">${c.icon} ${escapeHTML(c.name)}</option>`).join("");
 el.value=selected || (withAuto ? "" : "Other");
}

/* =========================================
   PURCHASE HISTORY
   One list built from: purchased shopping items, saved receipts
   and manual spending entries. Editing/deleting changes the
   original record, so nothing can get out of sync.
========================================= */

function pad2(n){ return String(n).padStart(2,"0"); }

function localDay(value){
 if(!value) return "";
 if(/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
 let d=new Date(value);
 if(isNaN(d)) return "";
 return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate());
}

function thisMonth(){ return localDay(new Date()).slice(0,7); }

function monthLabel(month){
 let [y,m]=month.split("-").map(Number);
 return new Date(y,m-1,1).toLocaleDateString("en-PH",{month:"long",year:"numeric"});
}

function shiftMonth(month,delta){
 let [y,m]=month.split("-").map(Number);
 let d=new Date(y,m-1+delta,1);
 return d.getFullYear()+"-"+pad2(d.getMonth()+1);
}

function historyEntries(){

 let out=[];

 data.requests.forEach(r=>{
  if(!r.purchased) return;
  let p=r.purchased;
  out.push({
   key:"p:"+r.id, source:"purchase",
   date:localDay(p.date),
   store:p.store!=null ? p.store : ((r.listing && r.listing.platform) || ""),
   title:p.itemName || r.text,
   items:[{name:p.itemName || r.text}],
   amount:Number(p.amount)||0,
   category:p.category || r.category || guessCategory(r.text),
   payment:p.payment || "",
   counted:true
  });
 });

 data.receipts.forEach(rc=>{
  let total=Number(rc.total)||0;
  if(total<=0) return;
  let items=Array.isArray(rc.items) ? rc.items : [];
  out.push({
   key:"r:"+rc.id, source:"receipt",
   date:rc.receiptDate || localDay(rc.date),
   store:rc.store || rc.name || "",
   title:rc.store || rc.name || "Receipt",
   items:items,
   amount:total,
   category:rc.category || guessCategory([rc.store].concat(items.map(i=>i.name)).join(" ")),
   payment:rc.payment || "",
   counted:!!rc.addedToSpent
  });
 });

 data.manual.forEach(m=>{
  out.push({
   key:"m:"+m.id, source:"manual",
   date:m.date || "",
   store:m.store || "",
   title:m.item || m.store || "Spending",
   items:Array.isArray(m.items) && m.items.length ? m.items : (m.item ? [{name:m.item}] : []),
   amount:Number(m.amount)||0,
   category:m.category || guessCategory((m.item||"")+" "+(m.store||"")),
   payment:m.payment || "",
   counted:m.counted!==false
  });
 });

 return out.sort((a,b)=>(b.date||"").localeCompare(a.date||"") || a.key.localeCompare(b.key));

}

function findEntrySource(key){
 let [type,...rest]=String(key).split(":");
 let id=rest.join(":");
 if(type==="p") return {type:"purchase",obj:findRequest(id)};
 if(type==="r") return {type:"receipt",obj:data.receipts.find(r=>r.id===id)};
 if(type==="m") return {type:"manual",obj:data.manual.find(m=>m.id===id)};
 return {type:null,obj:null};
}

let historyFilter={ month:thisMonth(), category:"all", q:"" };

function setHistoryFilter(field,value){
 historyFilter[field]=value;
 renderHistory();
}

function filteredHistory(){
 let q=historyFilter.q.trim().toLowerCase();
 return historyEntries().filter(e=>
  (historyFilter.month==="all" || (e.date||"").slice(0,7)===historyFilter.month) &&
  (historyFilter.category==="all" || e.category===historyFilter.category) &&
  (!q || [e.title,e.store,e.payment,e.category].concat(e.items.map(i=>i.name)).join(" ").toLowerCase().includes(q))
 );
}

const SOURCE_ICON={purchase:"🛍️",receipt:"🧾",manual:"✍️"};

function renderHistory(){

 let all=historyEntries();

 // Month filter: every month that has spending, plus this month.
 let months=[...new Set(all.map(e=>(e.date||"").slice(0,7)).filter(Boolean).concat([thisMonth()]))].sort().reverse();
 if(historyFilter.month!=="all" && !months.includes(historyFilter.month)) months.unshift(historyFilter.month);
 let mSel=document.getElementById("hMonth");
 mSel.innerHTML='<option value="all">All months</option>'+months.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join("");
 mSel.value=historyFilter.month;

 let cSel=document.getElementById("hCategory");
 cSel.innerHTML='<option value="all">All categories</option>'+CATEGORIES.map(c=>`<option value="${escapeHTML(c.name)}">${c.icon} ${escapeHTML(c.name)}</option>`).join("");
 cSel.value=historyFilter.category;

 let list=filteredHistory();
 let counted=list.filter(e=>e.counted);
 let total=counted.reduce((s,e)=>s+e.amount,0);

 document.getElementById("hSummary").innerText=
  list.length ? list.length+" entr"+(list.length===1?"y":"ies")+" · "+peso(total)+" spent" : "";

 document.getElementById("csvBtn").innerText="⬇️ Export CSV ("+(historyFilter.month==="all" ? "all time" : monthLabel(historyFilter.month))+")";

 let box=document.getElementById("historyList");

 if(!list.length){
  box.innerHTML='<div class="card muted">'+(all.length ? "Nothing matches these filters." :
   "No spending recorded yet. Mark items as purchased, save receipts, or tap ➕ Add spending.")+'</div>';
  return;
 }

 box.innerHTML=list.map(e=>{
  let cat=categoryInfo(e.category);
  let itemsText=e.source==="receipt" && e.items.length
   ? e.items.length+" item"+(e.items.length===1?"":"s")+": "+e.items.slice(0,3).map(i=>i.name).join(", ")+(e.items.length>3?"…":"")
   : "";
  return `
   <div class="item">
    <button class="delete" onclick="deleteEntry('${e.key}')" aria-label="Delete">✕</button>
    <b>${SOURCE_ICON[e.source]} ${escapeHTML(e.title)}</b>
    <small>${escapeHTML(e.date || "No date")}${e.store && e.store!==e.title ? " · "+escapeHTML(e.store) : ""}${e.payment ? " · "+escapeHTML(e.payment) : ""}</small>
    ${itemsText ? `<small>${escapeHTML(itemsText)}</small>` : ""}
    ${e.counted ? "" : '<span class="tag off">not counted in Spent</span>'}
    <div class="hist-row">
     <button class="cat-chip" onclick="openEntry('${e.key}')">${cat.icon} ${escapeHTML(cat.name)}</button>
     <span><b class="amt">${peso(e.amount)}</b> <button class="mini" style="margin:0 0 0 6px" onclick="openEntry('${e.key}')">✏️</button></span>
    </div>
   </div>`;
 }).join("");

}

/* ---------- Add / edit / delete ---------- */

let entryKey=null;

function openEntry(key){

 entryKey=key;
 let e=key ? historyEntries().find(x=>x.key===key) : null;

 if(key && !e) return;

 document.getElementById("entryTitle").innerText=e ? "Edit spending" : "Add spending";
 document.getElementById("entrySub").innerText=e ? {purchase:"From a purchased shopping item",receipt:"From a saved receipt",manual:"Manual entry"}[e.source] : "Record something you paid for.";
 document.getElementById("eDate").value=e ? (e.date || localDay(new Date())) : localDay(new Date());
 document.getElementById("eAmount").value=e ? amountForInput(e.amount) : "";
 document.getElementById("eStore").value=e ? e.store : "";
 document.getElementById("ePay").value=e ? e.payment : "";
 document.getElementById("eCounted").checked=e ? e.counted : true;
 fillCategorySelect("eCategory", e ? e.category : "", !e);

 let isReceipt=e && e.source==="receipt";
 document.getElementById("eItemWrap").classList.toggle("hidden",!!isReceipt);
 document.getElementById("eItem").value=e && !isReceipt ? (e.source==="manual" ? (findEntrySource(key).obj.item || "") : e.title) : "";
 let note=document.getElementById("eItemsNote");
 note.classList.toggle("hidden",!isReceipt);
 note.innerText=isReceipt ? e.items.length+" item(s) on this receipt — see Receipt Manager for the details." : "";

 document.getElementById("entryDeleteBtn").classList.toggle("hidden",!e);
 document.getElementById("entryMsg").innerText="";
 document.getElementById("entryMsg").className="form-msg";
 entryOverStopConfirmed=false;

 document.getElementById("entryModal").classList.remove("hidden");

}

function closeEntry(){
 entryKey=null;
 document.getElementById("entryModal").classList.add("hidden");
}

let entryOverStopConfirmed=false;

function saveEntry(){

 let msg=document.getElementById("entryMsg");
 let amount=parseAmount(document.getElementById("eAmount").value);
 let date=document.getElementById("eDate").value;
 let store=document.getElementById("eStore").value.trim();
 let item=document.getElementById("eItem").value.trim();
 let payment=document.getElementById("ePay").value.trim();
 let counted=document.getElementById("eCounted").checked;
 let category=document.getElementById("eCategory").value || guessCategory(item+" "+store);

 if(amount===null || isNaN(amount) || amount<=0){
  msg.innerText="Please enter the amount, for example 1,250.";
  msg.className="form-msg err";
  return;
 }

 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
  msg.innerText="Please pick a date.";
  msg.className="form-msg err";
  return;
 }

 let old=entryKey ? historyEntries().find(x=>x.key===entryKey) : null;
 let delta=(counted ? amount : 0)-(old && old.counted ? old.amount : 0);

 if(delta>0 && JasonCalc.crossesHardStop(data,delta) && !entryOverStopConfirmed){
  msg.innerText="⚠️ This takes Spent to "+peso(data.spent+delta)+", past your hard stop of "+peso(data.stop)+". Tap Save again to record it anyway.";
  msg.className="form-msg err";
  entryOverStopConfirmed=true;
  return;
 }

 let spentBefore=data.spent;
 let auditBefore=old ? {amount:old.amount,date:old.date,store:old.store,category:old.category,counted:old.counted} : null;

 if(!old){
  data.manual.unshift({ id:"M"+Date.now(), date, store, item, amount, category, payment, counted });
 }else{
  let src=findEntrySource(entryKey);
  if(!src.obj){ closeEntry(); return; }
  if(src.type==="purchase"){
   Object.assign(src.obj.purchased,{ amount, date, store, payment, category, itemName:item || src.obj.text });
   // A purchase always counts; unticking turns it into "not purchased".
   if(!counted){ delete src.obj.purchased; }
  }
  if(src.type==="receipt"){
   Object.assign(src.obj,{ total:amount, receiptDate:date, store, payment, category, addedToSpent:counted });
  }
  if(src.type==="manual"){
   Object.assign(src.obj,{ amount, date, store, item, payment, category, counted });
  }
 }

 data.spent=Math.max(0,Math.round((data.spent+delta)*100)/100);

 audit(old ? "spending.edit" : "spending.add",(old ? "Edited " : "Added ")+"spending: "+(item||store||"entry")+" "+peso(amount)+(counted ? "" : " (not counted)"),
  {entity:old ? old.source : "manual",id:old ? old.key : data.manual[0].id,delta:Math.round((data.spent-spentBefore)*100)/100,before:auditBefore,after:{amount,date,store,category,counted}});

 closeEntry();
 save();

}

function deleteEntry(key){

 let e=historyEntries().find(x=>x.key===key);
 if(!e) return;

 if(!confirm("Delete \""+e.title+"\" ("+peso(e.amount)+")?"+(e.counted ? " It will be taken off Spent." : "")))return;

 let src=findEntrySource(key);

 let spentBefore=data.spent;
 let removed=src.type==="purchase" ? (src.obj && src.obj.purchased) : src.obj;

 if(src.type==="purchase" && src.obj) delete src.obj.purchased;
 if(src.type==="receipt"){ data.receipts=data.receipts.filter(r=>r!==src.obj); if(src.obj) archivePriceRecordsFor(src.obj.id,"receipt deleted"); }
 if(src.type==="manual"){
  data.manual=data.manual.filter(m=>m!==src.obj);
  // prices recorded by a shopping trip for this entry leave comparisons too (kept, archived)
  if(src.obj && src.obj.tripId) (data.priceRecords||[]).forEach(pr=>{ if(pr.sourceRef && pr.sourceRef.type==="trip" && pr.sourceRef.entryId===src.obj.id && !pr.archived){ pr.archived=true; pr.archivedReason="entry deleted"; pr.archivedAt=new Date().toISOString(); } });
 }

 if(e.counted) data.spent=Math.max(0,Math.round((data.spent-e.amount)*100)/100);

 audit("spending.delete","Deleted "+e.source+": "+e.title+" "+peso(e.amount),{entity:e.source,id:key,delta:Math.round((data.spent-spentBefore)*100)/100,before:{record:JasonModel.clone(removed),spent:spentBefore},after:{spent:data.spent}});

 closeEntry();
 save();

}

/* ---------- CSV export ---------- */

function csvCell(value){
 let t=value==null ? "" : String(value);
 if(/^[=+\-@]/.test(t)) t="'"+t;           // stop spreadsheets running formulas
 return '"'+t.replace(/"/g,'""')+'"';
}

function exportCSV(){

 let month=historyFilter.month;
 let rows=historyEntries().filter(e=>month==="all" || (e.date||"").slice(0,7)===month);

 if(!rows.length){
  document.getElementById("hSummary").innerText="Nothing to export for "+(month==="all" ? "any month" : monthLabel(month))+".";
  return;
 }

 let lines=[["Date","Store","Items","Category","Payment","Amount (PHP)","Source","Counted in Spent"].map(csvCell).join(",")];

 rows.forEach(e=>{
  let items=e.items.map(i=>(i.name||"")+(i.qty>1 ? " x"+i.qty : "")+(i.price!=null ? " ("+Number(i.price).toFixed(2)+")" : "")).join("; ") || e.title;
  lines.push([e.date,e.store,items,e.category,e.payment,e.amount.toFixed(2),{purchase:"Purchased item",receipt:"Receipt",manual:"Manual"}[e.source],e.counted ? "Yes" : "No"].map(csvCell).join(","));
 });

 downloadFile("jason-shop-purchases-"+(month==="all" ? "all-time" : month)+".csv","\uFEFF"+lines.join("\r\n"),"text/csv;charset=utf-8");

}

function downloadFile(name,content,type){
 let blob=new Blob([content],{type:type});
 let url=URL.createObjectURL(blob);
 let a=document.createElement("a");
 a.href=url; a.download=name; a.style.display="none";
 document.body.appendChild(a); a.click();
 setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },2000);
}

/* =========================================
   MONTHLY REPORT
========================================= */

let reportMonth=thisMonth();

function setReportMonth(month){
 if(/^\d{4}-\d{2}$/.test(month)){ reportMonth=month; renderReport(); }
}

function shiftReportMonth(delta){ setReportMonth(shiftMonth(reportMonth,delta)); }

function monthStats(month){

 let entries=historyEntries().filter(e=>e.counted && (e.date||"").slice(0,7)===month);
 let total=entries.reduce((s,e)=>s+e.amount,0);
 let lastMonthTotal=historyEntries().filter(e=>e.counted && (e.date||"").slice(0,7)===shiftMonth(month,-1)).reduce((s,e)=>s+e.amount,0);

 let byCat={};
 entries.forEach(e=>{ byCat[e.category]=(byCat[e.category]||0)+e.amount; });
 let byCategory=Object.entries(byCat).map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount);

 let byStore={};
 entries.forEach(e=>{
  let name=(e.store||"").trim(); if(!name) return;
  let k=name.toLowerCase();
  byStore[k]=byStore[k] || {name,amount:0,count:0};
  byStore[k].amount+=e.amount; byStore[k].count++;
 });
 let topStores=Object.values(byStore).sort((a,b)=>b.amount-a.amount).slice(0,5);

 let biggest=entries.slice().sort((a,b)=>b.amount-a.amount).slice(0,5)
  .map(e=>({name:e.title+(e.store && e.store!==e.title ? " ("+e.store+")" : ""),amount:e.amount,date:e.date}));

 let now=thisMonth(), [y,m]=month.split("-").map(Number);
 let days=month===now ? new Date().getDate() : (month<now ? new Date(y,m,0).getDate() : 0);

 return {
  month, monthLabel:monthLabel(month), total, count:entries.length,
  fund:data.fund, stop:data.stop, lastMonthTotal,
  dailyAverage:days ? Math.round(total/days*100)/100 : 0, days,
  byCategory, topStores, biggest
 };

}

function renderReport(){

 document.getElementById("reportMonth").value=reportMonth;

 let st=monthStats(reportMonth);
 let body=document.getElementById("reportBody");

 if(!st.count){
  body.innerHTML='<p class="muted">No spending recorded for '+escapeHTML(st.monthLabel)+' yet.</p>';
  document.getElementById("summaryBtn").classList.add("hidden");
  document.getElementById("summaryBox").classList.add("hidden");
  return;
 }

 // Fund progress
 let pct=st.fund>0 ? Math.round(st.total/st.fund*100) : null;
 let barClass=pct===null ? "" : (pct>=100 ? "over" : (pct>=85 ? "warn" : ""));

 // Compared with last month
 let diff=st.total-st.lastMonthTotal;
 let compare=st.lastMonthTotal>0
  ? (diff>=0 ? "▲ "+peso(diff)+" more than" : "▼ "+peso(-diff)+" less than")+" last month ("+peso(st.lastMonthTotal)+", "+(diff>=0?"+":"")+Math.round(diff/st.lastMonthTotal*100)+"%)"
  : "No spending recorded last month.";

 // Donut
 let acc=0;
 let stops=st.byCategory.map(c=>{
  let from=acc/st.total*360; acc+=c.amount; let to=acc/st.total*360;
  return categoryInfo(c.name).color+" "+from.toFixed(1)+"deg "+to.toFixed(1)+"deg";
 }).join(",");

 body.innerHTML=`
  <small>SPENT IN ${escapeHTML(st.monthLabel.toUpperCase())}</small>
  <div class="big-num">${peso(st.total)}</div>
  ${pct!==null ? `
   <div class="progress"><span class="${barClass}" style="width:${Math.min(100,pct)}%"></span></div>
   <small>${pct}% of your ${peso(st.fund)} shopping fund${st.stop>0 ? " · hard stop "+peso(st.stop) : ""}</small>` :
   '<small class="muted">Set a shopping fund in Budget to compare.</small>'}
  <p style="margin:10px 0">${escapeHTML(compare)}</p>

  <div class="stats3">
   <div class="card"><small>DAILY AVERAGE</small><h3 style="margin:6px 0 0">${peso(st.dailyAverage)}</h3><small class="muted">over ${st.days} day${st.days===1?"":"s"}</small></div>
   <div class="card"><small>PURCHASES</small><h3 style="margin:6px 0 0">${st.count}</h3><small class="muted">avg ${peso(Math.round(st.total/st.count))}</small></div>
  </div>

  <h3>By category</h3>
  <div class="donut-wrap">
   <div class="donut" style="background:conic-gradient(${stops})" role="img" aria-label="Spending by category"></div>
   <div class="legend">
    ${st.byCategory.map(c=>{ let ci=categoryInfo(c.name); return `
     <div class="bar-row">
      <div class="lbl"><span>${ci.icon} ${escapeHTML(c.name)}</span><b>${peso(c.amount)}</b></div>
      <div class="bar"><span style="width:${(c.amount/st.byCategory[0].amount*100).toFixed(1)}%;background:${ci.color}"></span></div>
     </div>`; }).join("")}
   </div>
  </div>

  ${st.topStores.length ? `<h3>Top stores</h3>`+st.topStores.map(x=>`<div class="rank"><span>🏬 ${escapeHTML(x.name)} <small class="muted">×${x.count}</small></span><b>${peso(x.amount)}</b></div>`).join("") : ""}

  <h3>Biggest purchases</h3>
  ${st.biggest.map(x=>`<div class="rank"><span>${escapeHTML(x.name)} <small class="muted">${escapeHTML(x.date||"")}</small></span><b>${peso(x.amount)}</b></div>`).join("")}
 `;

 document.getElementById("summaryBtn").classList.remove("hidden");

 let saved=data.reportSummaries[reportMonth];
 let box=document.getElementById("summaryBox");
 if(saved && saved.text){
  box.classList.remove("hidden");
  box.innerHTML="✨ "+escapeHTML(saved.text)+(Math.round(saved.total)!==Math.round(st.total) ? '<br><small class="muted">Written before your latest changes — tap the button to refresh.</small>' : "");
  document.getElementById("summaryBtn").innerText="↻ Rewrite AI summary";
 }else{
  box.classList.add("hidden");
  document.getElementById("summaryBtn").innerText="✨ AI summary of this month";
 }

}

async function aiSummary(){

 let month=reportMonth;
 let st=monthStats(month);
 let btn=document.getElementById("summaryBtn");
 let box=document.getElementById("summaryBox");

 if(!st.count) return;

 btn.disabled=true;
 box.classList.remove("hidden");
 box.innerHTML='<span class="spinner"></span>Writing your summary…';

 try{

  let started=await fetchJSON("/api/report/summary",{
   method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({ stats:st })
  },75000);

  if(started.httpStatus===404) throw new ServerError("The AI summary needs the latest server update. Please redeploy jason-shop-api.");
  if(!started.success || !started.jobId) throw new ServerError(started.error || "Couldn't start the summary.");

  let result=await pollJob(started.jobId,"/api/jobs/",2*60*1000);
  if(!result || result.status!=="complete" || !result.text) throw new ServerError((result && result.error) || "The AI didn't return a summary.");

  data.reportSummaries[month]={ text:result.text, at:new Date().toISOString(), total:st.total };
  save();

 }catch(error){

  box.innerHTML="⚠️ "+escapeHTML(friendlyError(error));

 }finally{
  btn.disabled=false;
 }

}

/* =========================================
   BACKUP / RESTORE
========================================= */

const BACKUP_REMINDER_DAYS=7;

// Backup file: summary + record counts + checksum on top, then all data.
// Still readable by older Jason Shop versions (same app/type/version/data).
let lastBackupMeta=null;

function backupPayload(){
 let text=JasonModel.makeBackup(data,{ voiceSettings:voiceSettings });
 let head=JSON.parse(text.slice(0,text.indexOf(',"data":'))+"}");
 lastBackupMeta={ backupId:head.backupId, counts:head.counts, checksum:head.checksum.value, schemaVersion:head.schemaVersion };
 return text;
}

function backupFileName(){ return "jason-shop-backup-"+localDay(new Date())+".json"; }

function markBackedUp(how,action){
 if(lastBackupMeta) logBackup(action||"Backup created","success",lastBackupMeta.backupId,
  lastBackupMeta.counts.receipts+" receipts, "+lastBackupMeta.counts.manual+" manual entries, "+lastBackupMeta.counts.requests+" requests, "+lastBackupMeta.counts.priceRecords+" prices · checksum "+lastBackupMeta.checksum);
 data.lastBackup=new Date().toISOString();
 delete data.backupSnoozeUntil;
 save();
 let msg=document.getElementById("backupMsg");
 msg.innerText=how;
 msg.className="form-msg ok";
}

function backupNow(){
 downloadFile(backupFileName(),backupPayload(),"application/json");
 markBackedUp("✅ Saved "+backupFileName()+" to your Downloads. Open Files or Google Drive to keep a copy there.");
}

async function shareBackup(){
 try{
  let file=new File([backupPayload()],backupFileName(),{type:"application/json"});
  await navigator.share({ files:[file], title:"Jason Shop backup" });
  markBackedUp("✅ Backup shared. Choose Google Drive in the share menu to keep it safe.","Backup shared");
 }catch(error){
  if(error && error.name==="AbortError") return;      // Jason closed the share menu
  backupNow();
 }
}

function snoozeBackup(){
 data.backupSnoozeUntil=new Date(Date.now()+24*3600*1000).toISOString();
 save();
}

function daysSince(iso){ return iso ? Math.floor((Date.now()-new Date(iso).getTime())/86400000) : null; }

function renderBackupState(){

 let ago=daysSince(data.lastBackup);
 document.getElementById("lastBackupText").innerText=
  ago===null ? "No backup yet." : "Last backup: "+(ago===0 ? "today" : ago===1 ? "yesterday" : ago+" days ago")+" ("+new Date(data.lastBackup).toLocaleDateString()+")";

 let hasData=data.requests.length || data.receipts.length || data.manual.length;
 let snoozed=data.backupSnoozeUntil && new Date(data.backupSnoozeUntil)>new Date();
 let due=hasData && !snoozed && (ago===null || ago>=BACKUP_REMINDER_DAYS);

 document.getElementById("backupBanner").classList.toggle("hidden",!due);
 if(due){
  document.getElementById("backupBannerText").innerText=ago===null
   ? "💾 Your shopping data is only on this phone. Make a backup so you don't lose it."
   : "💾 Your last backup was "+ago+" days ago. Make a fresh one?";
 }

}

function setupShareButton(){
 try{
  let test=new File(["{}"],"test.json",{type:"application/json"});
  if(navigator.canShare && navigator.canShare({files:[test]})){
   document.getElementById("shareBackupBtn").classList.remove("hidden");
  }
 }catch(e){ /* sharing files not supported */ }
}

function restoreSelected(input){

 let file=input.files && input.files[0];
 input.value="";
 if(!file) return;

 let msg=document.getElementById("backupMsg");
 let reader=new FileReader();

 reader.onload=()=>restoreFromText(String(reader.result||""),{ label:file.name, msgEl:msg });

 reader.onerror=()=>{ msg.innerText="⚠️ Couldn't read that file."; msg.className="form-msg err"; };
 reader.readAsText(file);

}

/*
  Restore pipeline (spec §98–120): validate → checksum → migrate → preview
  & confirm → safety snapshot of current data → apply → validate counts →
  roll back automatically if anything doesn't match.
*/
function restoreFromText(text,opts){

 let msg=(opts && opts.msgEl) || document.getElementById("backupMsg");
 let say=(t,ok)=>{ msg.innerText=t; msg.className="form-msg "+(ok ? "ok" : "err"); };

 let rb=JasonModel.readBackup(text);

 if(!rb.ok){
  if(rb.error==="not_backup"){ say("⚠️ This file isn't a Jason Shop backup."); return false; }
  logBackup("Restore failed","failed",(rb.payload && rb.payload.backupId)||"",rb.error+(rb.problems ? ": "+rb.problems.join("; ") : ""));
  save();
  say(rb.error==="newer_version" ? "⚠️ This backup was made by a newer Jason Shop. Update the app first." :
   "⚠️ This backup failed its safety checks ("+rb.error.replace(/_/g," ")+"). Nothing was changed.");
  return false;
 }

 let payload=rb.payload, d=rb.data;
 let when=payload.exportedAt ? new Date(payload.exportedAt).toLocaleString() : "an unknown date";
 let summary=(d.requests.length)+" shopping items, "+d.receipts.length+" receipts, "+((d.manual||[]).length)+" manual entries, Spent "+peso(d.spent)+
  (d.priceRecords.length ? ", "+d.priceRecords.length+" prices" : "")+(d.products.length ? ", "+d.products.length+" products" : "");

 if(rb.checksumOk===false && !confirm("⚠️ This backup file looks damaged or edited (checksum doesn't match).\n\nRestore it anyway?")) return false;

 if(!confirm("Restore the backup from "+when+"?\n\n"+summary+"\n\nThis replaces everything currently in Jason Shop on this phone. A safety copy of your current data is kept first.")) return false;

 logBackup("Restore started","started",payload.backupId||(opts&&opts.label)||"","from "+when);
 persistReady=true;   // a restore is an explicit save — never deferred by the boot window

 // Safety copy of what is here now (localStorage + IndexedDB).
 let current=JasonModel.clone(data);
 let currentText=JSON.stringify(current);
 try{ localStorage.setItem("JasonShopData.beforeRestore",currentText); }catch(e){}
 if(window.JasonStore) JasonStore.putSnapshot({ reason:"before restore", json:currentText, schemaVersion:current.schemaVersion, counts:JasonModel.countsOf(current) }).catch(()=>{});

 try{
  let restored=normalizeData(d);
  let check=JasonModel.compareCounts(rb.counts,JasonModel.countsOf(restored));
  if(check.length) throw new Error("counts changed: "+check.join("; "));
  // Keep the two logs continuous: this phone's history + the backup's.
  restored.backupLog=mergeById(current.backupLog,restored.backupLog);
  restored.auditLog=mergeById(restored.auditLog,current.auditLog);
  data=restored;
  storeData();
  if(storageFull) throw new Error("phone storage is full");
  let verify=JasonModel.countsOf(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  let p=JasonModel.compareCounts(rb.counts,verify,JasonModel.LEGACY_COUNT_KEYS);
  if(p.length) throw new Error("saved data didn't match: "+p.join("; "));
 }catch(error){
  data=current;
  storeData();
  logBackup("Restore failed","rolled back",payload.backupId||"",String(error.message||error));
  save();
  say("⚠️ Restore didn't complete ("+(error.message||error)+"). Your previous data was put back.");
  return false;
 }

 if(payload.voiceSettings){
  voiceSettings=Object.assign({lang:"en",speak:true},payload.voiceSettings);
  localStorage.setItem("JasonShopVoice",JSON.stringify(voiceSettings));
 }

 logBackup("Restore completed","success",payload.backupId||(opts&&opts.label)||"",summary+(rb.migratedFrom ? " · upgraded from data version "+rb.migratedFrom : ""));
 audit("restore","Restored backup from "+when,{entity:"data",before:{counts:JasonModel.countsOf(current)},after:{counts:JasonModel.countsOf(data)}});
 storeData();
 renderVoiceSettings();
 fillBudgetForm();
 render();
 resumeResearch();

 // Stage 4: rebuild what is worked out from the data (cycles, alerts, recurring, checks). Money is never changed.
 let derived=null;
 try{ derived=typeof recalcDerived==="function" ? recalcDerived() : null; }catch(error){ console.warn("recalc",error); }
 if(derived) render();

 say("✅ Restored backup from "+when+"."+(derived ? " "+derived.summary : ""),true);
 return true;

}

function mergeById(a,b){
 let seen={}, out=[];
 (a||[]).concat(b||[]).forEach(x=>{ if(x && x.id && !seen[x.id]){ seen[x.id]=true; out.push(x); } });
 return out.sort((x,y)=>String(x.at||"").localeCompare(String(y.at||"")));
}

/* =========================================
   VOICE INPUT
   1) Built-in browser speech recognition
      (Chrome on Android) — fast and free.
   2) Fallback: record audio and let the
      server transcribe it (/api/transcribe).
========================================= */

const AUTO_SEND_SECONDS=3;

var voice={
 editing:false,
 state:"idle",          // idle | listening | recording | transcribing | review
 recognition:null,
 recorder:null,
 stream:null,
 audioContext:null,
 silenceTimer:null,
 countdownTimer:null,
 text:"",
 cancelled:false,
 speechApiBroken:false
};

// Old name kept so nothing else breaks.
function startVoice(){ toggleVoice(); }

function toggleVoice(){

 if(voice.state==="listening"){
  voice.recognition && voice.recognition.stop();
  return;
 }

 if(voice.state==="recording"){
  stopRecording();
  return;
 }

 if(voice.state==="transcribing"){
  return;
 }

 // idle or review → start a fresh request
 clearCountdown();
 startListening();

}

function startListening(){

 stopSpeaking();

 voice.text="";
 voice.cancelled=false;

 let SpeechRecognition=
 window.SpeechRecognition ||
 window.webkitSpeechRecognition;

 let forceRecorder=/[?&]voice=record/.test(location.search);

 if(SpeechRecognition && !forceRecorder && !voice.speechApiBroken){
  startSpeechRecognition(SpeechRecognition, voiceSettings.lang==="fil" ? "fil-PH" : "en-PH");
 }else{
  startRecording();
 }

}

function startSpeechRecognition(SpeechRecognition,lang){

 let recognition=new SpeechRecognition();
 let finalText="";
 let interimText="";
 let switchedToFallback=false;
 let errorShown=false;

 recognition.lang=lang;
 recognition.interimResults=true;
 recognition.continuous=false;   // stops by itself when Jason stops talking
 recognition.maxAlternatives=1;

 voice.recognition=recognition;

 recognition.onstart=function(){
  setVoiceUI("listening","Listening… tap to stop","Speak now");
  showTranscript("","");
 };

 recognition.onresult=function(event){

  finalText="";
  interimText="";

  for(let i=0;i<event.results.length;i++){
   let piece=event.results[i][0].transcript;
   if(event.results[i].isFinal){ finalText+=piece; }
   else{ interimText+=piece; }
  }

  showTranscript(finalText,interimText);

 };

 recognition.onerror=function(event){

  switch(event.error){

   case "no-speech":
    errorShown=true;
    voiceMessage("I didn't hear anything. Tap the mic and try again.",true);
    break;

   case "aborted":
    break;

   case "audio-capture":
    errorShown=true;
    voiceMessage("No microphone was found. Please check your phone's mic, or type your request.",true);
    break;

   case "language-not-supported":
    if(lang!=="en-US"){
     switchedToFallback=true;
     setTimeout(()=>startSpeechRecognition(SpeechRecognition,"en-US"),0);
    }else{
     voice.speechApiBroken=true;
     switchedToFallback=true;
     setTimeout(startRecording,0);
    }
    break;

   case "not-allowed":
   case "service-not-allowed":
   case "network":
   default:
    // The built-in recognizer is blocked or unavailable in this browser
    // (common in Samsung Internet). Try recording instead; if the mic
    // permission itself is denied, the recorder shows a friendly message.
    voice.speechApiBroken=true;
    switchedToFallback=true;
    setTimeout(startRecording,0);
    break;

  }

 };

 recognition.onend=function(){

  voice.recognition=null;

  if(switchedToFallback)return;

  let text=(finalText||interimText).trim();

  if(text){
   gotTranscript(text);
  }else{
   setVoiceUI("idle","Tap to talk");
   hideTranscript();
   if(!errorShown){
    voiceMessage("I didn't catch that. Tap the mic and try again.",true);
   }
  }

 };

 try{
  recognition.start();
 }catch(error){
  voice.speechApiBroken=true;
  startRecording();
 }

}

/* ---------- Fallback: record + server transcription ---------- */

async function startRecording(){

 if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder){
  setVoiceUI("idle","Tap to talk");
  voiceMessage("Voice isn't supported in this browser. Please open Jason Shop in Chrome, or type your request.",true);
  openAdd();
  return;
 }

 setVoiceUI("transcribing","Starting microphone…","");

 let stream;

 try{
  stream=await navigator.mediaDevices.getUserMedia({
   audio:{echoCancellation:true,noiseSuppression:true}
  });
 }catch(error){
  setVoiceUI("idle","Tap to talk");
  hideTranscript();
  voiceMessage(micErrorMessage(error),true);
  return;
 }

 let mimeType=[
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus"
 ].find(type=>MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type));

 let recorder;

 try{
  recorder=mimeType ? new MediaRecorder(stream,{mimeType}) : new MediaRecorder(stream);
 }catch(error){
  stream.getTracks().forEach(t=>t.stop());
  setVoiceUI("idle","Tap to talk");
  voiceMessage("Couldn't start recording on this phone. Please type your request.",true);
  return;
 }

 let chunks=[];

 voice.stream=stream;
 voice.recorder=recorder;
 voice.cancelled=false;

 recorder.ondataavailable=e=>{ if(e.data && e.data.size) chunks.push(e.data); };

 recorder.onstop=()=>{

  cleanupRecording();

  if(voice.cancelled)return;

  let blob=new Blob(chunks,{type:(recorder.mimeType||mimeType||"audio/webm")});

  uploadAudio(blob);

 };

 recorder.start(250);

 setVoiceUI("recording","Listening… tap to stop","Speak now — I'll stop when you pause");
 showTranscript("","🔴 Recording…");

 watchForSilence(stream);

}

// Stops automatically ~1.8 s after Jason stops talking,
// gives up after 8 s of total silence, and caps at 45 s.
function watchForSilence(stream){

 let AudioCtx=window.AudioContext||window.webkitAudioContext;

 let started=Date.now();
 let lastLoud=Date.now();
 let heardSpeech=false;
 let analyser=null;
 let samples=null;

 if(AudioCtx){
  try{
   voice.audioContext=new AudioCtx();
   let source=voice.audioContext.createMediaStreamSource(stream);
   analyser=voice.audioContext.createAnalyser();
   analyser.fftSize=1024;
   samples=new Uint8Array(analyser.fftSize);
   source.connect(analyser);
   if(voice.audioContext.state==="suspended"){
    voice.audioContext.resume().catch(()=>{});
   }
  }catch(error){
   analyser=null;
  }
 }

 voice.silenceTimer=setInterval(()=>{

  let now=Date.now();

  // Only trust the silence detector if the audio engine is really running;
  // otherwise Jason just taps to stop (or it stops at 45 s).
  if(analyser && voice.audioContext && voice.audioContext.state==="running"){

   analyser.getByteTimeDomainData(samples);

   let sum=0;
   for(let i=0;i<samples.length;i++){
    let v=(samples[i]-128)/128;
    sum+=v*v;
   }
   let level=Math.sqrt(sum/samples.length);

   document.getElementById("micBtn").style.setProperty("--level",Math.min(1,level*8).toFixed(2));

   if(level>0.03){
    heardSpeech=true;
    lastLoud=now;
   }

   if(heardSpeech && now-lastLoud>1800){
    stopRecording();
    return;
   }

   if(!heardSpeech && now-started>8000){
    voice.cancelled=true;
    stopRecording();
    setVoiceUI("idle","Tap to talk");
    hideTranscript();
    voiceMessage("I didn't hear anything. Tap the mic and try again.",true);
    return;
   }

  }

  if(now-started>45000){
   stopRecording();
  }

 },100);

}

function stopRecording(){

 clearInterval(voice.silenceTimer);
 voice.silenceTimer=null;

 if(voice.recorder && voice.recorder.state!=="inactive"){
  voice.recorder.stop();
 }else{
  cleanupRecording();
 }

}

function cleanupRecording(){

 clearInterval(voice.silenceTimer);
 voice.silenceTimer=null;

 if(voice.stream){
  voice.stream.getTracks().forEach(t=>t.stop());
  voice.stream=null;
 }

 if(voice.audioContext){
  voice.audioContext.close().catch(()=>{});
  voice.audioContext=null;
 }

 voice.recorder=null;

 document.getElementById("micBtn").style.removeProperty("--level");

}

async function uploadAudio(blob){

 if(!blob || blob.size<1000){
  setVoiceUI("idle","Tap to talk");
  hideTranscript();
  voiceMessage("That recording was too short. Tap the mic and try again.",true);
  return;
 }

 setVoiceUI("transcribing","Understanding what you said…","This can take a few seconds");
 showTranscript("","⏳ Transcribing…");

 let type=(blob.type||"audio/webm").split(";")[0];
 let ext={"audio/webm":"webm","audio/mp4":"mp4","audio/ogg":"ogg"}[type]||"webm";

 let form=new FormData();
 form.append("language",voiceSettings.lang);
 form.append("audio",blob,"voice."+ext);

 let controller=new AbortController();
 let timeout=setTimeout(()=>controller.abort(),90000);

 try{

  let response=await fetch(API_URL+"/api/transcribe",{
   method:"POST",
   body:form,
   signal:controller.signal
  });

  let result=await response.json().catch(()=>({}));

  if(!response.ok || !result.success || !result.text){
   throw new Error(result.error || "I couldn't understand that. Please try again or type your request.");
  }

  gotTranscript(result.text);

 }catch(error){

  setVoiceUI("idle","Tap to talk");
  hideTranscript();

  let message=error.name==="AbortError"
   ? "The server took too long to answer. Please try again."
   : (error.message==="Failed to fetch"
      ? "Could not reach the Jason Shop server. Check your internet and try again."
      : error.message);

  voiceMessage(message,true);

 }finally{
  clearTimeout(timeout);
 }

}

function micErrorMessage(error){

 let name=error && error.name;

 if(name==="NotAllowedError" || name==="SecurityError" || name==="PermissionDeniedError"){
  return "Microphone access is blocked. Tap the lock icon (🔒) next to the web address → Permissions → Microphone → Allow, then reload and try again.";
 }

 if(name==="NotFoundError" || name==="DevicesNotFoundError"){
  return "No microphone was found on this device. Please type your request.";
 }

 if(name==="NotReadableError" || name==="TrackStartError"){
  return "The microphone is being used by another app (for example a call). Close it and try again.";
 }

 return "Couldn't start the microphone. Please try again or type your request.";

}

/* ---------- After we have the words ---------- */

function gotTranscript(text){

 text=String(text||"").trim();

 if(!text){
  setVoiceUI("idle","Tap to talk");
  hideTranscript();
  voiceMessage("I didn't catch that. Tap the mic and try again.",true);
  return;
 }

 voice.text=text;

 clearCountdown();

 showTranscript(text,"");

 document.getElementById("voiceActions").classList.remove("hidden");

 let secondsLeft=AUTO_SEND_SECONDS;

 let updateLabel=()=>{
  setVoiceUI("review","Sending in "+secondsLeft+"…","Tap ✏️ Edit to fix the words, or ✕ to cancel");
  document.getElementById("voiceSendBtn").innerText="✅ Send ("+secondsLeft+")";
 };

 updateLabel();

 voice.countdownTimer=setInterval(()=>{
  secondsLeft--;
  if(secondsLeft<=0){
   sendVoiceNow();
  }else{
   updateLabel();
  }
 },1000);

}

function sendVoiceNow(){

 clearCountdown();

 let text=voice.text;

 voice.text="";

 document.getElementById("voiceActions").classList.add("hidden");

 if(!text){
  setVoiceUI("idle","Tap to talk");
  return;
 }

 // Stage 3: budget questions and household commands ("ubos na yung bigas",
 // "add 2 kilo rice") are handled on the phone — free and instant.
 let local=null;
 try{ local=typeof voiceLocal==="function" ? voiceLocal(text) : null; }catch(e){ local=null; }
 if(local){
  setVoiceUI("idle","Done ✓",local.say || "See the answer below the command bar");
  setTimeout(()=>{ hideTranscript(); if(voice.state==="idle") setVoiceUI("idle","Tap to talk"); },6000);
  let box=document.getElementById("cmdAnswer");
  if(box){ goTo("home"); setTimeout(()=>box.scrollIntoView({block:"center"}),30); }
  return;
 }

 submitRequest(text,"voice");

 setVoiceUI("idle","Got it! Researching…","Results will appear in your AI Shopping Inbox below");

 setTimeout(()=>{
  hideTranscript();
  if(voice.state==="idle") setVoiceUI("idle","Tap to talk");
 },6000);

 goTo("shopping");

}

function editVoice(){

 clearCountdown();

 document.getElementById("requestText").value=voice.text;

 voice.text="";

 document.getElementById("voiceActions").classList.add("hidden");
 hideTranscript();
 setVoiceUI("idle","Tap to talk");

 openAdd();

 voice.editing=true;

}

function cancelVoice(){

 clearCountdown();

 voice.text="";

 document.getElementById("voiceActions").classList.add("hidden");
 hideTranscript();
 setVoiceUI("idle","Tap to talk","Cancelled. Tap the mic to try again.");

}

function clearCountdown(){

 clearInterval(voice.countdownTimer);
 voice.countdownTimer=null;

 document.getElementById("voiceActions").classList.add("hidden");
 document.getElementById("voiceSendBtn").innerText="✅ Send";

}

/* ---------- Voice UI helpers ---------- */

function setVoiceUI(state,label,hint){

 voice.state=state;

 let mic=document.getElementById("micBtn");

 mic.classList.toggle("listening",state==="listening"||state==="recording");
 mic.classList.toggle("busy",state==="transcribing");
 mic.innerText=(state==="listening"||state==="recording") ? "⏹" : (state==="transcribing" ? "⏳" : "🎙️");
 mic.setAttribute("aria-label",(state==="listening"||state==="recording") ? "Tap to stop" : "Tap to talk");

 document.getElementById("voiceLabel").innerText=label;

 if(hint!==undefined){
  let hintEl=document.getElementById("voiceHint");
  hintEl.classList.remove("error");
  hintEl.innerText=hint;
 }

}

function voiceMessage(message,isError){

 let hintEl=document.getElementById("voiceHint");
 hintEl.innerText=message;
 hintEl.classList.toggle("error",!!isError);

}

function showTranscript(finalText,interimText){

 let box=document.getElementById("voiceTranscript");
 box.classList.remove("hidden");
 box.innerHTML=
  escapeHTML(finalText||"")+
  (interimText ? ' <span class="interim">'+escapeHTML(interimText)+'</span>' : "");

}

function hideTranscript(){

 let box=document.getElementById("voiceTranscript");
 box.classList.add("hidden");
 box.innerHTML="";

}

/* ---------- Voice settings ---------- */

function saveVoiceSettings(){
 localStorage.setItem("JasonShopVoice",JSON.stringify(voiceSettings));
 renderVoiceSettings();
}

function renderVoiceSettings(){
 document.getElementById("langEn").classList.toggle("on",voiceSettings.lang==="en");
 document.getElementById("langFil").classList.toggle("on",voiceSettings.lang==="fil");
 document.getElementById("speakToggle").checked=!!voiceSettings.speak;
}

function setVoiceLang(lang){
 voiceSettings.lang=lang;
 saveVoiceSettings();
}

function setSpeak(on){
 voiceSettings.speak=!!on;
 if(!on) stopSpeaking();
 saveVoiceSettings();
}

/* =========================================
   SPOKEN REPLY (speechSynthesis)
========================================= */

function spokenSummary(request){

 if(request.summary) return request.summary;

 // Fallback if the AI didn't include a VOICE SUMMARY line:
 // read the recommendation lines from the report.
 let lines=String(request.report||"")
  .split("\n")
  .map(l=>l.replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/https?:\/\/\S+/g,"").replace(/[*_#`>|]/g,"").trim())
  .filter(Boolean);

 let picked=lines.filter(l=>/best overall|recommend|\b(BUY|WAIT|WATCH|SKIP)\b/.test(l)).slice(0,2);

 let text=(picked.length ? picked : lines.slice(0,2)).join(". ");

 return text.length>320 ? text.slice(0,320).replace(/\s+\S*$/,"")+"…" : text;

}

function readAloud(id){

 let request=findRequest(id);

 if(request && request.status==="done"){
  speak(spokenSummary(request),true);
 }

}

function speak(text,force){

 if(!text || !("speechSynthesis" in window))return;
 if(!force && !voiceSettings.speak)return;

 window.speechSynthesis.cancel();

 let utterance=new SpeechSynthesisUtterance(text);

 let voices=window.speechSynthesis.getVoices();
 let preferred=
  voices.find(v=>/^en[-_]PH/i.test(v.lang)) ||
  voices.find(v=>/^en[-_]US/i.test(v.lang)) ||
  voices.find(v=>/^en/i.test(v.lang));

 if(preferred){
  utterance.voice=preferred;
  utterance.lang=preferred.lang;
 }else{
  utterance.lang="en-US";
 }

 utterance.rate=1;

 window.speechSynthesis.speak(utterance);

}

function stopSpeaking(){
 if("speechSynthesis" in window) window.speechSynthesis.cancel();
}

if("speechSynthesis" in window){
 // Voices load asynchronously on Android; touching them early warms the list.
 window.speechSynthesis.getVoices();
 window.speechSynthesis.onvoiceschanged=()=>window.speechSynthesis.getVoices();
}

/* =========================================
   START
========================================= */

renderVoiceSettings();
render();
fillBudgetForm();
setupShareButton();
finishBootSafety();
wakeServer();
resumeResearch();

async function sendToJasonAI(query) {
  const response = await fetch(API_URL + "/api/research", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: query,
      budget: budgetForAI(),
      mode: "AI_DECIDE"
    })
  });

  return await response.json();
}

