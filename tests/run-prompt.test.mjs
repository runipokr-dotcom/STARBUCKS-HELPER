import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../api/run-prompt.js', import.meta.url), 'utf8');
const {default: handler} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const token = 'test-only-access-token-32-characters';
const originalFetch = globalThis.fetch;
const envNames = ['RUN_PROMPT_ACCESS_TOKEN','OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENAI_MODEL','ANTHROPIC_MODEL'];
const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
async function call(overrides = {}) {
  const res = {headers:{}, setHeader(k,v){this.headers[k]=v;}, status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},end(){return this;}};
  await handler({method:'POST', headers:{origin:'https://runipokr-dotcom.github.io','content-type':'application/json',authorization:`Bearer ${token}`},body:{provider:'openai',prompt:'  테스트 원문\n '},...overrides},res);
  return res;
}
test('run-prompt API validation, auth, adapters and safe errors', async t => {
  process.env.RUN_PROMPT_ACCESS_TOKEN=token;
  process.env.OPENAI_API_KEY='test-openai-secret';process.env.ANTHROPIC_API_KEY='test-anthropic-secret';
  delete process.env.OPENAI_MODEL;delete process.env.ANTHROPIC_MODEL;
  let calls=[];
  const mock = data => {globalThis.fetch=async (url, init)=>{calls.push({url,init,body:JSON.parse(init.body)});return {ok:true,json:async()=>data};};};
  try {
    await t.test('OpenAI Responses output blocks, no storage and exact input',async()=>{
      mock({status:'completed',output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'첫째'},{type:'output_text',text:'둘째'}]}]});
      const res=await call();assert.equal(res.statusCode,200);assert.equal(res.body.text,'첫째\n둘째');
      assert.equal(calls.at(-1).url,'https://api.openai.com/v1/responses');assert.equal(calls.at(-1).body.store,false);
      assert.equal(calls.at(-1).body.input,'  테스트 원문\n ');assert.equal(calls.at(-1).body.max_output_tokens,4096);
      assert(!JSON.stringify(res.body).includes('secret'));
    });
    await t.test('Anthropic Messages with text-only blocks and truncation',async()=>{
      mock({content:[{type:'thinking',thinking:'private'},{type:'text',text:'Claude 답변'}],stop_reason:'max_tokens'});
      const res=await call({body:{provider:'anthropic',prompt:'test'}});assert.equal(res.body.text,'Claude 답변');assert.equal(res.body.incomplete,true);
      assert.equal(calls.at(-1).init.headers['anthropic-version'],'2023-06-01');assert.equal(calls.at(-1).body.messages[0].role,'user');
    });
    await t.test('rejects unauthorized, bad origins, methods, bodies and missing configuration before billing',async()=>{
      const count=calls.length;
      assert.equal((await call({headers:{authorization:'Bearer bad'}})).statusCode,401);
      assert.equal((await call({headers:{origin:'https://evil.example'}})).statusCode,403);
      assert.equal((await call({method:'GET'})).statusCode,405);
      const options=await call({method:'OPTIONS'});assert.equal(options.statusCode,204);assert.equal(options.headers['Access-Control-Allow-Origin'],'https://runipokr-dotcom.github.io');
      for (const body of [null,{},'{bad',{provider:'evil',prompt:'x'},{provider:'openai',prompt:' '},{provider:'openai',prompt:'x'.repeat(30001)}]) assert.equal((await call({body})).statusCode,400);
      assert.equal((await call({body:'x'.repeat(100001)})).statusCode,413);
      delete process.env.OPENAI_API_KEY;assert.equal((await call()).statusCode,503);process.env.OPENAI_API_KEY='test-openai-secret';
      delete process.env.RUN_PROMPT_ACCESS_TOKEN;assert.equal((await call()).statusCode,503);process.env.RUN_PROMPT_ACCESS_TOKEN=token;
      assert.equal(calls.length,count);
    });
    await t.test('deadline abort returns a safe timeout',async t=>{
      t.mock.timers.enable({apis:['setTimeout']});
      globalThis.fetch=(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));
      const pending=call();t.mock.timers.tick(55000);assert.equal((await pending).statusCode,504);t.mock.timers.reset();
    });
    await t.test('safe provider failures, empty output and incomplete responses',async()=>{
      globalThis.fetch=async()=>({ok:false,status:429,json:async()=>({error:{code:'insufficient_quota',message:'test-secret'}})});const quota=await call();assert.equal(quota.statusCode,429);assert(quota.body.error.includes('크레딧'));assert(!JSON.stringify(quota).includes('test-secret'));
      globalThis.fetch=async()=>({ok:false,status:429,json:async()=>({error:'test-secret'})});assert.equal((await call()).statusCode,429);
      globalThis.fetch=async()=>({ok:false,status:401,json:async()=>({error:'test-secret'})});const failure=await call();assert.equal(failure.statusCode,502);assert(!JSON.stringify(failure).includes('test-secret'));
      globalThis.fetch=async()=>{throw new Error('test-secret');};assert.equal((await call()).statusCode,502);
      mock({status:'completed',output:[]});assert.equal((await call()).statusCode,502);
      mock({status:'incomplete',output:[{type:'message',content:[{type:'output_text',text:'partial'}]}]});assert.equal((await call()).body.incomplete,true);
    });
  } finally {
    globalThis.fetch=originalFetch;
    for(const name of envNames) {if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
  }
});
