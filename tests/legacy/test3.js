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
const val=(p,s)=>p.$eval(s,e=>e.value);
const visible=(p,s)=>p.$eval(s,e=>!e.classList.contains("hidden") && getComputedStyle(e).display!=="none");
async function waitFor(fn, ms=15000){ const t0=Date.now(); while(Date.now()-t0<ms){ try{ if(await fn()) return true; }catch(e){} await sleep(150);} return false; }
const ctl = q => fetch("http://localhost:3999/"+q).then(r=>r.json());
(async()=>{
 const b = await puppeteer.launch({executablePath:revealShim.CHROME,headless:"new",args:["--no-sandbox"]}); revealShim(b);
 const mk = async (seed)=>{
  const p=await b.newPage();
  await p.setUserAgent("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36");
  await p.setViewport({width:384,height:854,isMobile:true,hasTouch:true,deviceScaleFactor:2});
  p.errors=[]; p.on("pageerror",e=>p.errors.push(e.message)); p.on("console",m=>{ if(m.type()==="error" && !/favicon|status of (4\d\d|5\d\d)/.test(m.text())) p.errors.push(m.text()); });
  p.on("dialog",d=>d.accept());
  await p.goto(URL); await p.evaluate(s=>{localStorage.clear(); if(s) localStorage.JasonShopData=JSON.stringify(s);}, seed||null); await p.reload();
  return p;
 };
 const tap = async (p,sel)=>{ const el=await p.$(sel); await el.scrollIntoView(); await sleep(100); const bb=await el.boundingBox(); await p.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2); await sleep(200); };
 const typeInto = async (p,sel,v)=>{ await p.$eval(sel,e=>e.value=""); await tap(p,sel); const c=await p.target().createCDPSession(); await c.send("Input.insertText",{text:v}); };
 const choose = async (p,btnSel,file)=>{ const [fc]=await Promise.all([p.waitForFileChooser(), tap(p,btnSel)]); await fc.accept([file]); };
 const lastSeen = async kind => (await ctl("seen")).filter(x=>x.kind===kind).pop();

 // P1 product photo (4000x3000) -> identify -> edit -> research
 await ctl("set?product=photo&receipt=clear"); await ctl("clear");
 let p = await mk({fund:20000,stop:15000,spent:0,requests:[],receipts:[]});
 check("P0 file inputs allow gallery/screenshots (no forced camera)", await p.evaluate(()=>!document.getElementById("productFile").hasAttribute("capture") && !document.getElementById("receiptFile").hasAttribute("capture")));
 await choose(p,"button[onclick='productCamera()']",path.join(FIX,"imgs","product.jpg"));
 await sleep(150);
 check("P1 product sheet opens with a 'working' state", await visible(p,"#productModal") && /Preparing|Looking/.test(await text(p,"#productState")));
 check("P1 AI identification fills the form", await waitFor(async()=>(await val(p,"#pName")).includes("Hanabishi HSF-16")));
 check("P1 key specs filled", (await val(p,"#pSpecs")).includes("3 speeds"));
 check("P1 no listing box for a normal photo", !(await visible(p,"#pListingBox")));
 check("P1 thumbnail shown", await p.$eval("#productThumb",e=>e.src.startsWith("data:image/jpeg")));
 let s = await lastSeen("product");
 check(`P1 upload shrunk on phone to JPEG ≤1600px (${s.dims && s.dims.w}x${s.dims && s.dims.h}, ${Math.round(s.bytes/1024)} KB)`, s.mime==="image/jpeg" && s.dims && Math.max(s.dims.w,s.dims.h)<=1600 && s.dims.w===1600 && s.bytes<1200*1024);
 await typeInto(p,"#pName","Hanabishi HSF-16 Stand Fan (white)");
 await tap(p,"button[onclick='researchFromPhoto()']");
 check("P1 sheet closes and item appears with 📷 + thumbnail", !(await visible(p,"#productModal")) && (await text(p,"#shoppingList")).includes("📷 Hanabishi HSF-16 Stand Fan (white)") && !!(await p.$("#shoppingList img.thumb")));
 check("P1 research runs and finishes (job + polling)", await waitFor(async()=>(await text(p,"#shoppingList")).includes("AI Research ready")));
 s = await lastSeen("research");
 check("P1 research query uses edited name + specs, and budget", s.query.includes("Hanabishi HSF-16 Stand Fan (white). Key specs: 16-inch blades, 3 speeds, Oscillating. Search") && s.query.includes("hard stop limit ₱15,000") && !s.query.includes(".."), s.query);
 check("P1 Mark purchased available on photo items", !!(await p.$("#shoppingList button.mini.buy")));
 check("P1 no JS errors", p.errors.length===0, p.errors.join(" | "));
 await p.close();

 // P2 Shopee screenshot -> listing price/seller -> compare
 await ctl("set?product=screenshot");
 p = await mk();
 await choose(p,"button[onclick='productCamera()']",path.join(FIX,"imgs","shopee.png"));
 check("P2 listing box shows price + seller", await waitFor(async()=>await visible(p,"#pListingBox")) && (await val(p,"#pPrice"))==="1,899" && (await val(p,"#pSeller"))==="Hanabishi Official Store" && (await text(p,"#pPlatform")).includes("Shopee"));
 check("P2 note says it will compare the listing", (await text(p,"#pNote")).includes("compare"));
 await tap(p,"button[onclick='researchFromPhoto()']");
 check("P2 item shows 'Seen on Shopee for ₱1,899 · seller'", (await text(p,"#shoppingList")).includes("Seen on Shopee for ₱1,899 · Hanabishi Official Store"));
 await waitFor(async()=>(await text(p,"#shoppingList")).includes("AI Research ready"));
 s = await lastSeen("research");
 check("P2 research asked to compare listing price & seller", !s.query.includes("..") && s.query.includes("listed on Shopee for ₱1,899 from seller \"Hanabishi Official Store\"") && s.query.includes("good deal"), s.query);
 await p.close();

 // P3 not a product -> must type a name
 await ctl("set?product=none");
 p = await mk();
 await choose(p,"button[onclick='productCamera()']",path.join(FIX,"imgs","landscape.jpg"));
 check("P3 'no product found' shown, name empty", await waitFor(async()=>(await text(p,"#productState")).includes("No product")) && (await val(p,"#pName"))==="");
 await tap(p,"button[onclick='researchFromPhoto()']");
 check("P3 research blocked until a name is typed", (await text(p,"#pNote")).includes("Please type") && (await text(p,"#shoppingList")).includes("No shopping requests"));
 await typeInto(p,"#pName","garden chair"); await tap(p,"button[onclick='researchFromPhoto()']");
 check("P3 typed name researched", (await text(p,"#shoppingList")).includes("garden chair"));
 await p.close();

 // P4 AI rejects image -> friendly error + Try again + manual entry
 await ctl("set?product=imagebad");
 p = await mk();
 await choose(p,"button[onclick='productCamera()']",path.join(FIX,"imgs","product.jpg"));
 check("P4 friendly error + Try again + manual field", await waitFor(async()=>(await text(p,"#productState")).includes("couldn't open that picture")) && await visible(p,"#productRetry") && await visible(p,"#productFields"));
 await ctl("set?product=photo");
 await tap(p,"button[onclick=\"retryPhoto('product')\"]");
 check("P4 Try again works", await waitFor(async()=>(await val(p,"#pName")).includes("Hanabishi")));
 await p.close();

 // P5 undecodable HEIC
 await ctl("clear");
 p = await mk();
 await choose(p,"button[onclick='productCamera()']",path.join(FIX,"imgs","photo.heic"));
 check("P5 unreadable format -> friendly message, nothing uploaded", await waitFor(async()=>(await text(p,"#productState")).includes("format can't be read")) && (await ctl("seen")).length===0);
 // P6 cancel while reading -> result ignored
 await tap(p,"button[onclick='closeProduct()']");
 await choose(p,"button[onclick='productCamera()']",path.join(FIX,"imgs","product.jpg")); await sleep(250);
 await tap(p,"button[onclick='closeProduct()']"); await sleep(2000);
 check("P6 cancelling mid-read keeps sheet closed, nothing added", !(await visible(p,"#productModal")) && (await text(p,"#shoppingList")).includes("No shopping requests"));
 check("P5/P6 no JS errors", p.errors.length===0, p.errors.join(" | "));
 await p.close();

 // R1 clear receipt (2400x4200 PNG) -> editable card -> save -> Spent + list
 await ctl("set?receipt=clear"); await ctl("clear");
 p = await mk({fund:20000,stop:0,spent:1000,requests:[],receipts:[]});
 await choose(p,"button[onclick='receiptCamera()']",path.join(FIX,"imgs","receipt.png"));
 check("R1 card filled: store, date, payment, total", await waitFor(async()=>(await val(p,"#rTotal"))==="2,424") && (await val(p,"#rStore"))==="SM Supermarket" && (await val(p,"#rDate"))==="2026-10-05" && (await val(p,"#rPay"))==="Cash");
 check("R1 3 editable item rows + subtotal + VAT", (await p.$$eval("#rItems .item-row",x=>x.length))===3 && (await val(p,"#rSubtotal"))==="2,424" && (await val(p,"#rVat"))==="259.71");
 check("R1 water row qty 2, price 180", await p.$eval("#rItems .item-row:nth-child(2)",r=>r.querySelector(".ri-qty").value==="2" && r.querySelector(".ri-price").value==="180"));
 s = await lastSeen("receipt");
 check(`R1 receipt shrunk to JPEG ≤1600px (${s.dims.w}x${s.dims.h}, ${Math.round(s.bytes/1024)} KB)`, s.mime==="image/jpeg" && Math.max(s.dims.w,s.dims.h)===1600);
 await tap(p,"#rItems .item-row:nth-child(3) button");
 check("R1 item row can be removed", (await p.$$eval("#rItems .item-row",x=>x.length))===2);
 await p.screenshot({path:path.join(OUT,"receipt-card.png")});
 await tap(p,"button[onclick='confirmReceipt()']");
 check("R1 saved: Spent 1,000 → 3,424", (await text(p,"#spentDisplay"))==="₱3,424");
 const rl = await text(p,"#receiptList");
 check("R1 receipt listed with store, date, payment, total, tag, thumbnail", rl.includes("SM Supermarket") && rl.includes("2026-10-05 · Cash") && rl.includes("₱2,424") && rl.includes("added to Spent") && !!(await p.$("#receiptList img.thumb")));
 check("R1 receipt status line", (await text(p,"#receiptStatus")).includes("1 receipt saved"));
 const stored = await p.evaluate(()=>JSON.parse(localStorage.JasonShopData).receipts[0]);
 check(`R1 record saved with items + small thumbnail (${Math.round(stored.thumb.length/1024)} KB)`, stored.items.length===2 && stored.vat===259.71 && stored.thumb.length<40000 && stored.readByAI===true);
 await p.$eval("#receiptList details",d=>d.open=true); await sleep(100);
 await (await p.$("#receiptList")).screenshot({path:path.join(OUT,"receipt-list.png")});
 // R6 delete -> spent back
 await tap(p,"button[onclick='deleteReceipt(0)']");
 check("R6 deleting receipt takes it off Spent", (await text(p,"#spentDisplay"))==="₱1,000" && (await text(p,"#receiptList"))==="");
 check("R1 no JS errors", p.errors.length===0, p.errors.join(" | "));
 await p.close();

 // R2 partly readable -> warnings
 await ctl("set?receipt=partly");
 p = await mk();
 await choose(p,"button[onclick='receiptCamera()']",path.join(FIX,"imgs","receipt.png"));
 await waitFor(async()=>(await val(p,"#rTotal"))!=="");
 const w = await text(p,"#rWarn");
 check("R2 partly readable + totals mismatch warnings shown", w.includes("hard to read: Bottom edge is cut off") && w.includes("doesn't match"), w);
 await p.close();

 // R3 blurry -> retake / enter manually
 await ctl("set?receipt=blurry");
 p = await mk({fund:0,stop:0,spent:0,requests:[],receipts:[]});
 await choose(p,"button[onclick='receiptCamera()']",path.join(FIX,"imgs","receipt_blurry.jpg"));
 check("R3 blurry -> 'Too blurry' + Retake/Enter manually", await waitFor(async()=>(await text(p,"#receiptState")).includes("Too blurry")) && await visible(p,"#receiptRetry") && !(await visible(p,"#receiptFields")));
 await tap(p,"button[onclick='showReceiptFields(true)']");
 check("R3 manual entry opens empty card", await visible(p,"#receiptFields") && (await val(p,"#rTotal"))==="" && (await p.$$eval("#rItems .item-row",x=>x.length))===0);
 await tap(p,"button[onclick='confirmReceipt()']");
 check("R8 total required", (await text(p,"#rMsg")).includes("Please enter the total"));
 await typeInto(p,"#rStore","Palengke"); await typeInto(p,"#rTotal","850"); await tap(p,"button[onclick='addReceiptItem()']");
 await typeInto(p,"#rItems .item-row .ri-name","Tilapia 1kg"); await typeInto(p,"#rItems .item-row .ri-price","180");
 await tap(p,"button[onclick='confirmReceipt()']");
 check("R3 manual receipt saved, Spent ₱850", (await text(p,"#spentDisplay"))==="₱850" && (await text(p,"#receiptList")).includes("Palengke"));
 await p.close();

 // R4 not a receipt
 await ctl("set?receipt=notreceipt");
 p = await mk();
 await choose(p,"button[onclick='receiptCamera()']",path.join(FIX,"imgs","landscape.jpg"));
 check("R4 not a receipt -> friendly message", await waitFor(async()=>(await text(p,"#receiptState")).includes("doesn't look like a receipt")) && await visible(p,"#receiptRetry"));
 await p.close();

 // R5 hard stop + 'don't add to Spent'
 await ctl("set?receipt=clear");
 p = await mk({fund:5000,stop:3000,spent:1000,requests:[],receipts:[]});
 await choose(p,"button[onclick='receiptCamera()']",path.join(FIX,"imgs","receipt.png"));
 await waitFor(async()=>(await val(p,"#rTotal"))==="2,424");
 await tap(p,"button[onclick='confirmReceipt()']");
 check("R5 past hard stop asks for a second tap", (await text(p,"#rMsg")).includes("past your hard stop") && (await text(p,"#spentDisplay"))==="₱1,000");
 await tap(p,"#rAddSpent"); await tap(p,"button[onclick='confirmReceipt()']");
 check("R5 unticking 'Add to Spent' saves without changing Spent", (await text(p,"#spentDisplay"))==="₱1,000" && (await text(p,"#receiptList")).includes("SM Supermarket") && !(await text(p,"#receiptList")).includes("added to Spent"));
 await p.close();

 // R7 old receipts from previous versions still render/delete
 p = await mk({fund:0,stop:0,spent:500,requests:[{id:"R1",text:"📷 Product photo: x.jpg",date:new Date().toISOString(),photo:true}],receipts:[{name:"old.jpg",date:new Date().toISOString(),amount:500}]});
 check("R7 legacy receipt + legacy photo item render", (await text(p,"#receiptList")).includes("old.jpg") && (await text(p,"#shoppingList")).includes("scan it again"));
 await tap(p,"button[onclick='deleteReceipt(0)']");
 check("R7 legacy receipt delete subtracts its amount", (await text(p,"#spentDisplay"))==="₱0");
 check("R7 no JS errors", p.errors.length===0, p.errors.join(" | "));
 await p.close();

 // S storage full -> thumbnails trimmed, data kept
 p = await mk();
 const ok = await p.evaluate(()=>{ const big="x".repeat(1024*1024); let i=0; try{ for(;i<20;i++) localStorage.setItem("filler"+i,big); }catch(e){}
   data.receipts.unshift({id:"a",date:new Date().toISOString(),store:"A",total:1,thumb:"data:image/jpeg;base64,"+"A".repeat(600000)});
   data.receipts.unshift({id:"b",date:new Date().toISOString(),store:"B",total:2,thumb:"data:image/jpeg;base64,"+"A".repeat(600000)});
   save(); const saved=JSON.parse(localStorage.JasonShopData); return saved.receipts.length===2 && saved.receipts.some(r=>!r.thumb); });
 check("S storage full -> keeps receipts, drops old thumbnails", ok);
 await p.close();

 await b.close();
 console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
