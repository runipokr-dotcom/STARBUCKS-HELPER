const SAVE_KEY="pixel-bunker-project-v3";
const $=id=>document.getElementById(id);

let phases=[],animations={},state={
  phase:0,progress:0,money:120000,fuel:100,steel:24,concrete:32,
  safety:92,quality:88,equipment:100,day:1,hour:8,completed:false,event:"현장 통제실 연결 완료."
};
let playing=false,framesCache=new Map(),lastFrame=null;

const bg=$("stageBg"),canvas=$("seqCanvas"),ctx=canvas.getContext("2d");

async function boot(){
  const [p,a]=await Promise.all([fetch("data/phases.json").then(r=>r.json()),fetch("data/animations.json").then(r=>r.json())]);
  phases=p;animations=a;
  try{state={...state,...JSON.parse(localStorage.getItem(SAVE_KEY)||"null")}}catch{}
  bind();resize();renderAll();window.addEventListener("resize",resize);
}
function bind(){
  $("workBtn").onclick=runPhase;$("supplyBtn").onclick=supply;$("maintainBtn").onclick=maintain;$("resetBtn").onclick=resetGame;
}
function phase(){return phases[Math.min(state.phase,phases.length-1)]}
function save(){localStorage.setItem(SAVE_KEY,JSON.stringify(state))}
function canPay(cost){return Object.entries(cost||{}).every(([k,v])=>Number(state[k]||0)>=v)}
function pay(cost){Object.entries(cost||{}).forEach(([k,v])=>state[k]-=v)}
function overall(){if(state.completed)return 100;return Math.round(((state.phase+state.progress/100)/phases.length)*100)}
function resize(){
  const r=canvas.parentElement.getBoundingClientRect();const dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.round(r.width*dpr));canvas.height=Math.max(1,Math.round(r.height*dpr));
  canvas.style.width=r.width+"px";canvas.style.height=r.height+"px";ctx.setTransform(dpr,0,0,dpr,0,0);
  if(lastFrame)drawFrame(lastFrame,animations[phase().animation]);
}
function renderAll(){renderUI();renderBackground();drawFallback()}
function renderBackground(){
  const p=phase();bg.classList.remove("loaded");bg.onload=()=>bg.classList.add("loaded");bg.onerror=()=>bg.classList.remove("loaded");bg.src=p.background;
}
function renderUI(){
  const p=phase();
  $("phaseChip").textContent="PHASE "+String(state.phase+1).padStart(2,"0");
  $("phaseTitle").textContent=state.completed?"PROJECT COMPLETE":p.title;
  $("sceneState").textContent=p.id.toUpperCase();
  $("overallValue").textContent=overall()+"%";
  $("taskTitle").textContent=state.completed?"시설 승인 완료":p.task;
  $("taskDesc").textContent=state.completed?"모든 주요 공정이 완료되었습니다.":p.description;
  $("taskProgress").style.width=(state.completed?100:state.progress)+"%";
  $("moneyValue").textContent="₩"+Math.round(state.money).toLocaleString("ko-KR");
  $("fuelValue").textContent=Math.round(state.fuel);$("steelValue").textContent=Math.round(state.steel);$("concreteValue").textContent=Math.round(state.concrete);
  $("safetyMeter").value=state.safety;$("safetyText").textContent=Math.round(state.safety);
  $("qualityMeter").value=state.quality;$("qualityText").textContent=Math.round(state.quality);
  $("equipmentMeter").value=state.equipment;$("equipmentText").textContent=Math.round(state.equipment);
  $("clockTop").textContent=`DAY ${String(state.day).padStart(2,"0")} · ${String(state.hour).padStart(2,"0")}:00`;
  $("eventLog").textContent=state.event;
  $("taskCosts").innerHTML=state.completed?"":Object.entries(p.cost||{}).map(([k,v])=>`<span>${({money:"예산",fuel:"연료",steel:"강재",concrete:"콘크리트"})[k]} ${k==="money"?"₩"+v.toLocaleString():v}</span>`).join("");
  $("workBtn").disabled=playing||state.completed;$("workBtn").textContent=playing?"작업 중…":state.completed?"완공":"작업 시작";
  renderTimeline();
}
function renderTimeline(){
  $("timeline").innerHTML=phases.map((p,i)=>{
    const cls=i<state.phase?"done":i===state.phase?"active":"locked";
    return `<div class="timeline-item ${cls}"><i>${i<state.phase?"✓":String(i+1).padStart(2,"0")}</i><span>${p.title}</span></div>`;
  }).join("");
}
async function runPhase(){
  if(playing||state.completed)return;
  const p=phase();if(!canPay(p.cost)){state.event="자원이 부족합니다. 보급을 진행하세요.";renderUI();return}
  pay(p.cost);playing=true;state.progress=0;state.event=p.task+" 작업 시작.";renderUI();
  if(p.animation)await playSequence(p.animation);else await simulateProgress();
  finishPhase();
}
function simulateProgress(){
  return new Promise(resolve=>{let n=0;const timer=setInterval(()=>{n+=8;state.progress=Math.min(100,n);renderUI();if(n>=100){clearInterval(timer);resolve()}},90)})
}
async function playSequence(key){
  const cfg=animations[key];if(!cfg)return simulateProgress();
  const frames=await preload(cfg);
  if(!frames.length){state.event="렌더 시퀀스 대기 중 · 임시 애니메이션으로 진행";return fallbackProgress(key)}
  const frameMs=1000/(cfg.fps||24);let i=0;
  return new Promise(resolve=>{
    const step=()=>{
      lastFrame=frames[i];drawFrame(frames[i],cfg);state.progress=Math.round((i+1)/frames.length*100);renderUI();i++;
      if(i<frames.length)setTimeout(()=>requestAnimationFrame(step),frameMs);else resolve();
    };step();
  })
}
async function preload(cfg){
  const cacheKey=cfg.path+cfg.prefix;if(framesCache.has(cacheKey))return framesCache.get(cacheKey);
  const frames=[];for(let i=cfg.start;i<=cfg.end;i++){
    const img=new Image();img.decoding="async";img.src=cfg.path+cfg.prefix+String(i).padStart(4,"0")+"."+cfg.ext;
    try{await img.decode();frames.push(img)}catch{}
  }
  framesCache.set(cacheKey,frames);return frames
}
function drawFrame(img,cfg){
  if(!img||!cfg)return;const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);
  ctx.drawImage(img,w*cfg.x,h*cfg.y,w*cfg.width,h*cfg.height)
}
function drawFallback(){
  const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);
  if(bg.classList.contains("loaded"))return;
  const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,"#b8ced0");g.addColorStop(.5,"#d3bb82");g.addColorStop(1,"#86613d");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  ctx.fillStyle="#5c7348";ctx.fillRect(0,0,w,h*.22);
  ctx.fillStyle="#7d5d3d";ctx.beginPath();ctx.ellipse(w*.5,h*.68,w*.30,h*.14,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#202820";ctx.font="700 12px sans-serif";ctx.fillText("RENDER ASSET PLACEHOLDER",16,h-18)
}
function fallbackProgress(kind){
  return new Promise(resolve=>{let n=0;const timer=setInterval(()=>{n+=5;state.progress=n;renderUI();drawFallbackMachine(kind,n/100);if(n>=100){clearInterval(timer);resolve()}},70)})
}
function drawFallbackMachine(kind,t){
  drawFallback();const w=canvas.clientWidth,h=canvas.clientHeight;ctx.save();
  if(kind.includes("excavator")){
    const x=w*(.18+t*.12),y=h*.68;ctx.translate(x,y);ctx.fillStyle="#d7902d";ctx.fillRect(-28,-20,58,28);ctx.strokeStyle="#bd7422";ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(5,-14);ctx.lineTo(45,-55+Math.sin(t*Math.PI)*18);ctx.lineTo(70,-35);ctx.stroke()
  }else{
    ctx.strokeStyle="#cb7c28";ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(w*.70,h*.70);ctx.lineTo(w*.70,h*.18);ctx.lineTo(w*.35,h*.25);ctx.stroke();ctx.fillStyle="#9c3f35";ctx.fillRect(w*(.35+t*.20),h*.48,28,20)
  }ctx.restore()
}
function finishPhase(){
  playing=false;state.progress=100;state.quality=Math.min(100,state.quality+1);state.equipment=Math.max(35,state.equipment-1);state.hour+=2;
  if(state.hour>=18){state.day++;state.hour=8}
  if(state.phase<phases.length-1){state.phase++;state.progress=0;state.event="공정 완료. 다음 단계로 이동합니다."}
  else{state.completed=true;state.event="PROJECT COMPLETE — 최종 검사 승인 완료."}
  save();lastFrame=null;renderAll()
}
function supply(){if(playing)return;if(state.money<9000){state.event="보급 예산이 부족합니다.";renderUI();return}state.money-=9000;state.fuel+=30;state.steel+=8;state.concrete+=10;state.event="보급 완료.";save();renderUI()}
function maintain(){if(playing)return;if(state.money<4500){state.event="정비 예산이 부족합니다.";renderUI();return}state.money-=4500;state.equipment=Math.min(100,state.equipment+24);state.safety=Math.min(100,state.safety+2);state.event="장비 정비 완료.";save();renderUI()}
function resetGame(){if(confirm("프로젝트를 처음부터 다시 시작할까요?")){localStorage.removeItem(SAVE_KEY);location.reload()}}

boot().catch(err=>{console.error(err);$("eventLog").textContent="초기화 오류: "+err.message});