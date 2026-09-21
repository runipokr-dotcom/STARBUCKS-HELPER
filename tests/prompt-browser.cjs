// NODE_PATH must point to a Playwright installation. No production data or paid API calls.
const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const origin='https://runipokr-dotcom.github.io';
const firestore=`
const initial={version:1,items:[{id:'fixture',title:'기존 항목',body:'  {{상품명}} / {{상품명}} / {{톤}}  ',tags:['태그'],createdAt:1,custom:'preserve'}]};
let state=JSON.parse(localStorage.getItem('fixture-db')||'null')||initial;let listeners=[];
const snapshot=()=>({exists:()=>true,data:()=>structuredClone(state),metadata:{fromCache:false}});
export const getFirestore=()=>({});export const doc=()=>({});export const serverTimestamp=()=>0;
export async function runTransaction(db,fn){let next;const result=await fn({get:async()=>snapshot(),set:(ref,data)=>next=data,update:(ref,data)=>next={...state,...data}});if(next){state=next;localStorage.setItem('fixture-db',JSON.stringify(state));listeners.forEach(fn=>fn(snapshot()));}return result;}
window.addEventListener('fixture-remote-edit',()=>{state.items[0].body='다른 기기 변경';localStorage.setItem('fixture-db',JSON.stringify(state));listeners.forEach(fn=>fn(snapshot()));});
export function onSnapshot(ref,opt,fn){listeners.push(fn);fn(snapshot());}
`;
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
 const requests=[];let fail=false,delay=0;
 await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:url.pathname.includes('firebase-app')?'export const initializeApp=()=>({});export const getApps=()=>[];':firestore});
   if(url.pathname==='/api/run-prompt'){
     if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}});
     const body=route.request().postDataJSON();requests.push(body);if(delay)await new Promise(r=>setTimeout(r,delay));
     return route.fulfill({status:fail?502:200,headers:{'Access-Control-Allow-Origin':origin},contentType:'application/json',body:JSON.stringify(fail?{error:'검수용 실패'}:{text:'<script>unsafe</script>\n'+body.prompt,model:'test-model',incomplete:false})});
   }
   if(url.pathname.endsWith('prompt.html'))return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'prompt.html'),'utf8')});
   if(url.pathname.endsWith('prompt-runner.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'prompt-runner.js'),'utf8')});
   return route.abort();
 });
 const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
 await p.goto(origin+'/STARBUCKS-HELPER/prompt.html');await p.waitForFunction(()=>!document.querySelector('#submitBtn').disabled);
 const card=()=>p.locator('.card').filter({hasText:'기존 항목'});
 await card().getByText('☆ 즐겨찾기',{exact:true}).click();await p.getByRole('button',{name:'즐겨찾기',exact:true}).click();assert.equal(await p.locator('.card').count(),1);
 await card().getByText('수정',{exact:true}).click();await p.locator('#fTitle').fill('기존 항목 수정');await p.locator('#submitBtn').click();await p.getByText('기존 항목 수정',{exact:true}).waitFor();
 const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('fixture-db')).items[0]);assert.equal(stored.custom,'preserve');assert.equal(stored.favorite,true);assert.equal(stored.body,'  {{상품명}} / {{상품명}} / {{톤}}  ');
 await card().getByText('사용하기',{exact:true}).click();assert.equal(await p.locator('#variableFields textarea').count(),2);
 await p.locator('#variable-0').fill('컵 $& {{새 변수}}');await p.locator('#variable-1').fill('친절');await p.locator('#runAccess').fill('test-only-access-token-32-characters');
 assert.equal(await p.locator('#runPreview').inputValue(),'  컵 $& {{새 변수}} / 컵 $& {{새 변수}} / 친절  ');
 delay=200;await p.locator('#runBtn').click();assert.equal(await p.locator('#runBtn').isDisabled(),true);await p.locator('#runResult').waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('#runBtn').disabled);delay=0;
 assert.equal(requests[0].provider,'openai');assert.equal(await p.locator('#runResult script').count(),0);
 const firstPrompt=requests[0].prompt;
 await p.locator('#runPreview').fill('unsent change');await p.locator('#rerunBtn').click();await p.waitForFunction(()=>!document.querySelector('#rerunBtn').disabled);assert.equal(requests[1].prompt,firstPrompt);
 await p.locator('#otherModelBtn').click();await p.waitForFunction(()=>!document.querySelector('#otherModelBtn').disabled);assert.equal(requests[2].provider,'anthropic');assert.equal(requests[2].prompt,firstPrompt);
 await p.locator('#copyResultBtn').click();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),await p.locator('#runOutput').inputValue());
 if(process.env.SCREENSHOT){await p.setViewportSize({width:390,height:844});await p.locator('#runnerPanel').screenshot({path:process.env.SCREENSHOT});}
 fail=true;const previous=await p.locator('#runOutput').inputValue();await p.locator('#rerunBtn').click();await p.waitForFunction(()=>!document.querySelector('#rerunBtn').disabled);assert((await p.locator('#runNote').textContent()).includes('이전 결과'));assert.equal(await p.locator('#runOutput').inputValue(),previous);
 await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));

 await p.reload();await p.getByText('기존 항목 수정',{exact:true}).waitFor();assert.equal(await p.locator('#runAccess').inputValue(),'');
 await card().getByText('수정',{exact:true}).click();await p.locator('#fBody').fill('내 작성 보존');await p.evaluate(()=>window.dispatchEvent(new Event('fixture-remote-edit')));await p.locator('#submitBtn').click();await p.waitForFunction(()=>!document.querySelector('#submitBtn').disabled);assert((await p.locator('#formNote').textContent()).includes('다른 기기'));assert.equal(await p.locator('#fBody').inputValue(),'내 작성 보존');assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('fixture-db')).items[0].body),'다른 기기 변경');await p.locator('#cancelEditBtn').click();
 await p.locator('#fTitle').fill('신규 검수');await p.locator('#fBody').fill('  원문 보존\n끝  ');await p.locator('#submitBtn').click();await p.getByText('신규 검수',{exact:true}).waitFor();
 await p.locator('#searchInput').fill('신규 검수');assert.equal(await p.locator('.card').count(),1);await p.getByText('전체보기',{exact:true}).click();assert.equal(await p.locator('.cardBody').textContent(),'  원문 보존\n끝  ');
 p.on('dialog',d=>d.accept());await p.getByText('삭제',{exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.card').length===0);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS: save/edit/favorite/search/delete/reload, unknown-field preservation, variables, repeated literal substitution, safe output, rerun/switch/copy/error recovery, no persisted token, 390px layout');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
