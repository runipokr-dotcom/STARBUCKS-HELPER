const SAVE_KEY="pixel-bunker-project-v1";

const STAGES=[
  {title:"부지 조사",tasks:[
    {name:"기준점 측량",desc:"부지 경계와 기준고를 설정합니다.",cost:{money:2500,fuel:1},gain:{quality:2},work:2},
    {name:"지반 스캔",desc:"지하 매설물과 토질 상태를 확인합니다.",cost:{money:4200,fuel:2},gain:{safety:3},work:3}
  ]},
  {title:"부지 정리",tasks:[
    {name:"수목 제거",desc:"장비 진입을 위해 작업구역을 비웁니다.",cost:{money:3800,fuel:5},work:3},
    {name:"진입로 확보",desc:"중장비 이동로와 자재 적치장을 만듭니다.",cost:{money:5200,fuel:6},gain:{equipment:2},work:4}
  ]},
  {title:"굴착",tasks:[
    {name:"1차 굴착",desc:"굴착기로 표토와 사질층을 제거합니다.",cost:{money:7200,fuel:12},gain:{depth:1.6},work:5},
    {name:"2차 굴착",desc:"벙커 바닥 레벨까지 굴착합니다.",cost:{money:9800,fuel:15},gain:{depth:1.4},work:6}
  ]},
  {title:"지반 다짐",tasks:[
    {name:"배수층 시공",desc:"쇄석과 배수관을 설치합니다.",cost:{money:6500,fuel:4},gain:{quality:4},work:4},
    {name:"기초면 다짐",desc:"플레이트 콤팩터로 허용 오차를 맞춥니다.",cost:{money:5400,fuel:7},gain:{quality:5},work:4}
  ]},
  {title:"기초 타설",tasks:[
    {name:"철근 배근",desc:"기초 슬래브 철근망을 조립합니다.",cost:{money:8200,steel:6},gain:{quality:3},work:5},
    {name:"콘크리트 타설",desc:"기초 슬래브와 타워 베이스를 타설합니다.",cost:{money:11000,concrete:12},gain:{quality:4},work:7}
  ]},
  {title:"철골 세우기",tasks:[
    {name:"기둥 인양",desc:"크레인으로 주기둥을 세웁니다.",cost:{money:9600,fuel:8,steel:8},gain:{safety:-1},work:6},
    {name:"보 설치",desc:"상부 보와 연결 플레이트를 조립합니다.",cost:{money:8800,fuel:6,steel:6},gain:{quality:3},work:6}
  ]},
  {title:"벙커 쉘",tasks:[
    {name:"외벽 시공",desc:"강재 패널과 콘크리트 벽체를 구축합니다.",cost:{money:12500,steel:4,concrete:10},work:7},
    {name:"방수·차폐",desc:"방수층과 외부 차폐층을 마감합니다.",cost:{money:7600},gain:{quality:5},work:5}
  ]},
  {title:"설비",tasks:[
    {name:"전력·환기",desc:"전력, 환기, 필터 시스템을 설치합니다.",cost:{money:10400},gain:{safety:4},work:6},
    {name:"통제실 시운전",desc:"센서와 통제 장비를 시험합니다.",cost:{money:6800,fuel:2},gain:{quality:4,safety:3},work:5}
  ]},
  {title:"완공",tasks:[
    {name:"최종 검사",desc:"구조·안전·설비 체크리스트를 완료합니다.",cost:{money:4000},gain:{quality:2,safety:2},work:4}
  ]}
];

const WEATHER=[
  {name:"맑음",icon:"☀",temp:24,wind:2,penalty:0},
  {name:"흐림",icon:"☁",temp:20,wind:4,penalty:0},
  {name:"강풍",icon:"🌬",temp:18,wind:9,penalty:1},
  {name:"비",icon:"☂",temp:17,wind:5,penalty:1}
];

const initial=()=>({
  stage:0,task:0,taskProgress:0,money:120000,fuel:100,steel:24,concrete:32,
  safety:92,quality:88,equipment:100,depth:0,crew:3,weather:0,completed:false,lastEvent:"현장 통제실 연결 완료."
});
let state=load();
let working=false;
let anim=0;

const $=id=>document.getElementById(id);
const canvas=$("siteCanvas"),ctx=canvas.getContext("2d");

function load(){
  try{return {...initial(),...JSON.parse(localStorage.getItem(SAVE_KEY)||"null")}}catch{return initial()}
}
function save(){
  localStorage.setItem(SAVE_KEY,JSON.stringify(state));
  state.lastEvent="진행상황을 저장했습니다.";
  renderUI();
}
function reset(){
  if(!confirm("프로젝트 진행상황을 초기화할까요?"))return;
  state=initial();localStorage.removeItem(SAVE_KEY);working=false;renderAll();
}
function stageData(){return STAGES[Math.min(state.stage,STAGES.length-1)]}
function taskData(){return stageData().tasks[Math.min(state.task,stageData().tasks.length-1)]}
function totalTasks(){return STAGES.reduce((n,s)=>n+s.tasks.length,0)}
function doneTasks(){return STAGES.slice(0,state.stage).reduce((n,s)=>n+s.tasks.length,0)+state.task}
function overall(){
  if(state.completed)return 100;
  return Math.round((doneTasks()+state.taskProgress/100)/totalTasks()*100);
}
function canAfford(cost){
  return Object.entries(cost).every(([k,v])=>state[k]>=v);
}
function pay(cost){Object.entries(cost).forEach(([k,v])=>state[k]-=v)}
function applyGain(gain={}){
  if(gain.depth)state.depth+=gain.depth;
  for(const key of ["safety","quality","equipment"])if(gain[key])state[key]=Math.max(0,Math.min(100,state[key]+gain[key]));
}

function runWork(){
  if(working||state.completed)return;
  const task=taskData();
  if(!canAfford(task.cost)){state.lastEvent="자원이 부족합니다. 보급을 진행하세요.";renderUI();return}
  pay(task.cost);working=true;state.taskProgress=0;
  const weather=WEATHER[state.weather];
  const totalTicks=task.work+weather.penalty;
  let tick=0;
  state.lastEvent=`${task.name} 작업 시작.`;
  const timer=setInterval(()=>{
    tick++;
    state.taskProgress=Math.min(100,Math.round(tick/totalTicks*100));
    state.equipment=Math.max(25,state.equipment-(Math.random()<.35?1:0));
    if(Math.random()<.07)state.safety=Math.max(40,state.safety-1);
    renderUI();
    if(tick>=totalTicks){
      clearInterval(timer);working=false;completeTask(task);
    }
  },520);
}
function completeTask(task){
  state.taskProgress=100;applyGain(task.gain);
  state.money+=1200+state.crew*200;
  const s=stageData();
  if(state.task<s.tasks.length-1){state.task++;state.taskProgress=0}
  else if(state.stage<STAGES.length-1){state.stage++;state.task=0;state.taskProgress=0;rollWeather()}
  else{state.completed=true;state.taskProgress=100}
  state.lastEvent=state.completed?"PROJECT COMPLETE — 벙커 시설 승인 완료.":`${task.name} 완료. 다음 공정으로 이동합니다.`;
  localStorage.setItem(SAVE_KEY,JSON.stringify(state));renderAll();
}
function supply(){
  if(working)return;
  if(state.money<9000){state.lastEvent="보급 예산이 부족합니다.";renderUI();return}
  state.money-=9000;state.fuel+=30;state.steel+=8;state.concrete+=10;
  state.lastEvent="현장 보급 완료: 연료 +30 / 강재 +8 / 콘크리트 +10";saveSilent();
}
function maintain(){
  if(working)return;
  if(state.money<4500){state.lastEvent="정비 예산이 부족합니다.";renderUI();return}
  state.money-=4500;state.equipment=Math.min(100,state.equipment+24);state.safety=Math.min(100,state.safety+2);
  state.lastEvent="장비 정비 완료. 가동률과 안전도가 회복됐습니다.";saveSilent();
}
function saveSilent(){localStorage.setItem(SAVE_KEY,JSON.stringify(state));renderAll()}
function rollWeather(){state.weather=Math.floor(Math.random()*WEATHER.length)}

function renderTimeline(){
  $("timeline").innerHTML=STAGES.map((s,i)=>{
    const cls=i<state.stage?"done":i===state.stage?"active":"locked";
    const mark=i<state.stage?"✓":String(i+1).padStart(2,"0");
    return `<div class="timeline-item ${cls}"><i>${mark}</i><span>${s.title}</span></div>`
  }).join("");
}
function renderUI(){
  const task=taskData(),weather=WEATHER[state.weather];
  $("phaseChip").textContent=`PHASE ${String(state.stage+1).padStart(2,"0")}`;
  $("stageTitle").textContent=state.completed?"PROJECT COMPLETE":stageData().title;
  $("stageSpec").textContent=stageData().title;
  $("depthSpec").textContent=state.depth.toFixed(1)+"m";
  $("weatherSpec").textContent=weather.name;
  $("weatherCard").textContent=`${weather.icon} ${weather.temp}°C · 풍속 ${weather.wind}m/s`;
  $("crewSpec").textContent=state.crew+"명";
  $("overallText").textContent=overall()+"%";
  $("moneyValue").textContent="₩"+Math.round(state.money).toLocaleString("ko-KR");
  $("fuelValue").textContent=Math.round(state.fuel);
  $("steelValue").textContent=Math.round(state.steel);
  $("concreteValue").textContent=Math.round(state.concrete);
  $("safetyMeter").value=state.safety;$("safetyText").textContent=Math.round(state.safety);
  $("qualityMeter").value=state.quality;$("qualityText").textContent=Math.round(state.quality);
  $("equipmentMeter").value=state.equipment;$("equipmentText").textContent=Math.round(state.equipment);
  $("taskTitle").textContent=state.completed?"시설 승인 완료":task.name;
  $("taskDesc").textContent=state.completed?"모든 주요 공정이 완료되었습니다.":task.desc;
  $("taskProgress").style.width=(state.completed?100:state.taskProgress)+"%";
  $("taskCosts").innerHTML=state.completed?"":Object.entries(task.cost).map(([k,v])=>`<span>${({money:"예산",fuel:"연료",steel:"강재",concrete:"콘크리트"})[k]} ${k==="money"?"₩"+v.toLocaleString():v}</span>`).join("");
  $("eventLog").textContent=state.lastEvent;
  $("floatingStatus").textContent=working?"작업 진행 중 · "+state.taskProgress+"%":state.completed?"시설 운영 준비 완료":"현장 대기";
  $("workBtn").disabled=working||state.completed;
  $("workBtn").textContent=working?"작업 중…":state.completed?"완공":"작업 시작";
  $("supplyBtn").disabled=working||state.completed;
  $("maintainBtn").disabled=working||state.completed;
  renderTimeline();
}
function renderAll(){renderUI();draw()}

function iso(x,y,z=0){return {x:canvas.width/2+(x-y)*42,y:580+(x+y)*22-z}}
function poly(points,fill,stroke="#3b413c"){
  ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke()
}
function box(x,y,w,d,h,top="#bcb7aa",side="#8e8a80"){
  const a=iso(x,y,0),b=iso(x+w,y,0),c=iso(x+w,y+d,0),e=iso(x,y+d,0);
  const at=iso(x,y,h),bt=iso(x+w,y,h),ct=iso(x+w,y+d,h),et=iso(x,y+d,h);
  poly([at,bt,ct,et],top);poly([b,c,ct,bt],side);poly([c,e,et,ct],"#76746d");
}
function drawGround(){
  const g=ctx.createLinearGradient(0,0,0,canvas.height);g.addColorStop(0,"#e5c982");g.addColorStop(.48,"#c89955");g.addColorStop(1,"#87643c");ctx.fillStyle=g;ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle="#97b26a";ctx.fillRect(0,0,canvas.width,180);
  for(let i=0;i<42;i++){const x=(i*83)%canvas.width,y=190+((i*137)%720);ctx.fillStyle=i%2?"#755331":"#9b7547";ctx.fillRect(x,y,3,3)}
  ctx.strokeStyle="#927048";ctx.lineWidth=2;
  for(let i=-7;i<8;i++){const a=iso(i,-5),b=iso(i,6);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
  for(let j=-5;j<7;j++){const a=iso(-7,j),b=iso(7,j);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
}
function drawExcavator(t){
  const x=170,y=690;ctx.save();ctx.translate(x,y);
  ctx.fillStyle="#433d32";ctx.fillRect(-35,28,90,22);ctx.fillStyle="#d89a2f";ctx.fillRect(-20,-5,55,42);ctx.fillStyle="#28342e";ctx.fillRect(10,0,22,18);
  ctx.strokeStyle="#c37a20";ctx.lineWidth=14;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(12,-2);ctx.lineTo(42,-48);ctx.lineTo(74,-65+Math.sin(t)*5);ctx.stroke();
  ctx.fillStyle="#80551f";ctx.beginPath();ctx.moveTo(72,-72);ctx.lineTo(92,-62);ctx.lineTo(77,-45);ctx.closePath();ctx.fill();ctx.restore();
}
function drawCrane(t){
  const x=720,y=430;ctx.save();ctx.translate(x,y);ctx.fillStyle="#4d4435";ctx.fillRect(-45,80,100,24);ctx.fillStyle="#d58c2c";ctx.fillRect(-15,45,62,40);
  ctx.strokeStyle="#4a4031";ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(10,48);ctx.lineTo(-95,-175);ctx.stroke();
  ctx.strokeStyle="#675a45";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-95,-175);ctx.lineTo(16,48);ctx.moveTo(-70,-115);ctx.lineTo(-38,-125);ctx.moveTo(-50,-72);ctx.lineTo(-20,-82);ctx.stroke();
  const hookY=-30+Math.sin(t*.7)*8;ctx.strokeStyle="#2f332e";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-95,-175);ctx.lineTo(-95,hookY);ctx.stroke();ctx.fillStyle="#a63f32";ctx.fillRect(-103,hookY,16,18);ctx.restore();
}
function drawSite(t){
  drawGround();
  if(state.stage>=2){ctx.fillStyle="#745138";ctx.beginPath();ctx.ellipse(canvas.width/2,620,250,120,0,0,Math.PI*2);ctx.fill()}
  if(state.stage>=3){poly([iso(-4,-3),iso(4,-3),iso(4,3),iso(-4,3)],"#aca28d")}
  if(state.stage>=4){box(-4,-3,8,6,16,"#bdb7a6","#8d887c")}
  if(state.stage>=5){
    const cols=[[-3,-2],[3,-2],[-3,2],[3,2]];
    cols.forEach(([x,y])=>box(x,y,.35,.35,155,"#6e7470","#4f5551"));
    ctx.strokeStyle="#565c58";ctx.lineWidth=8;[[-3,-2,3,-2],[-3,2,3,2]].forEach(v=>{const a=iso(v[0],v[1],150),b=iso(v[2],v[3],150);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()})
  }
  if(state.stage>=6){box(-3.6,-2.6,7.2,5.2,90,"#9b9a91","#72746d")}
  if(state.stage>=7){
    ctx.fillStyle="#375f4c";ctx.fillRect(380,540,140,48);ctx.fillStyle="#d7d2c4";ctx.font="bold 16px sans-serif";ctx.fillText("CONTROL",410,570)
  }
  if(state.stage<4)drawExcavator(t);
  if(state.stage>=4&&state.stage<7)drawCrane(t);
  if(state.completed){
    ctx.fillStyle="#ffffffdd";ctx.fillRect(225,120,450,80);ctx.fillStyle="#203025";ctx.font="bold 28px sans-serif";ctx.textAlign="center";ctx.fillText("PROJECT COMPLETE",450,168);ctx.textAlign="left"
  }
}
function draw(){
  const t=performance.now()/700;ctx.clearRect(0,0,canvas.width,canvas.height);drawSite(t);anim=requestAnimationFrame(draw)
}

$("workBtn").onclick=runWork;$("supplyBtn").onclick=supply;$("maintainBtn").onclick=maintain;$("saveBtn").onclick=save;$("resetBtn").onclick=reset;
renderAll();