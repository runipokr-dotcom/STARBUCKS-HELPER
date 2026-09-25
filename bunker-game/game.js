import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js";

const SAVE_KEY="pixel-bunker-project-v2";
const STAGES=[
  {name:"부지 조사",state:"SURVEY MODE",task:"기준점 측량",desc:"부지 경계와 기준고를 설정합니다.",cost:{money:2500,fuel:1},depth:0},
  {name:"부지 정리",state:"CLEARING",task:"진입로 확보",desc:"중장비 이동로와 작업구역을 정리합니다.",cost:{money:5200,fuel:5},depth:.2},
  {name:"굴착",state:"EXCAVATION",task:"2차 굴착",desc:"벙커 바닥 레벨까지 토사를 제거합니다.",cost:{money:9800,fuel:14},depth:3},
  {name:"지반 다짐",state:"GROUND PREP",task:"기초면 다짐",desc:"배수층과 기초면을 정밀 다짐합니다.",cost:{money:6200,fuel:6},depth:3},
  {name:"기초 타설",state:"FOUNDATION",task:"슬래브 타설",desc:"철근 배근 후 기초 슬래브를 타설합니다.",cost:{money:11000,steel:5,concrete:10},depth:3},
  {name:"철골 세우기",state:"STEEL FRAME",task:"주기둥 인양",desc:"크레인으로 주요 철골을 세웁니다.",cost:{money:9800,fuel:8,steel:8},depth:3},
  {name:"벙커 쉘",state:"BUNKER SHELL",task:"외벽 시공",desc:"철골 외부에 차폐 구조체를 구축합니다.",cost:{money:12500,steel:4,concrete:10},depth:3},
  {name:"설비",state:"SYSTEM INSTALL",task:"전력·환기",desc:"전력, 환기, 필터 시스템을 설치합니다.",cost:{money:10200},depth:3},
  {name:"완공",state:"PROJECT COMPLETE",task:"최종 검사",desc:"구조·안전·설비 체크리스트를 완료합니다.",cost:{money:4000},depth:3}
];
const WEATHER=[
  {label:"☀ 24°C",name:"맑음"},{label:"☁ 20°C",name:"흐림"},{label:"🌬 18°C",name:"강풍"},{label:"☂ 17°C",name:"비"}
];

const $=id=>document.getElementById(id);
const state=load();
let working=false;

function load(){
  const base={stage:0,progress:0,money:120000,fuel:100,steel:24,concrete:32,safety:92,quality:88,equipment:100,weather:0,day:1,hour:8,event:"현장 통제실 연결 완료."};
  try{return {...base,...JSON.parse(localStorage.getItem(SAVE_KEY)||"null")}}catch{return base}
}
function save(){localStorage.setItem(SAVE_KEY,JSON.stringify(state))}
function stage(){return STAGES[Math.min(state.stage,STAGES.length-1)]}
function canAfford(cost){return Object.entries(cost).every(([k,v])=>state[k]>=v)}
function pay(cost){Object.entries(cost).forEach(([k,v])=>state[k]-=v)}
function overall(){return Math.round(((state.stage+state.progress/100)/(STAGES.length-1))*100)}
function tickTime(){state.hour+=2;if(state.hour>=18){state.day++;state.hour=8;state.weather=Math.floor(Math.random()*WEATHER.length)}}
function runWork(){
  if(working||state.stage>=STAGES.length-1)return;
  const s=stage();
  if(!canAfford(s.cost)){state.event="자원이 부족합니다. 보급을 진행하세요.";renderUI();return}
  pay(s.cost);working=true;state.progress=0;state.event=s.task+" 작업 시작.";
  const timer=setInterval(()=>{
    state.progress=Math.min(100,state.progress+10);
    state.equipment=Math.max(35,state.equipment-(Math.random()<.25?1:0));
    if(Math.random()<.05)state.safety=Math.max(50,state.safety-1);
    renderUI();
    if(state.progress>=100){
      clearInterval(timer);working=false;
      state.stage=Math.min(STAGES.length-1,state.stage+1);state.progress=0;tickTime();
      state.quality=Math.min(100,state.quality+1);state.event="공정 완료. 다음 단계로 이동합니다.";save();syncScene();renderUI();
    }
  },180);
}
function supply(){
  if(working)return;
  if(state.money<9000){state.event="보급 예산이 부족합니다.";renderUI();return}
  state.money-=9000;state.fuel+=30;state.steel+=8;state.concrete+=10;state.event="보급 완료: 연료 +30 / 강재 +8 / 콘크리트 +10";save();renderUI()
}
function maintain(){
  if(working)return;
  if(state.money<4500){state.event="정비 예산이 부족합니다.";renderUI();return}
  state.money-=4500;state.equipment=Math.min(100,state.equipment+24);state.safety=Math.min(100,state.safety+2);state.event="장비 정비 완료.";save();renderUI()
}
function resetGame(){
  if(!confirm("프로젝트를 처음부터 다시 시작할까요?"))return;
  localStorage.removeItem(SAVE_KEY);location.reload()
}
function renderTimeline(){
  $("timeline").innerHTML=STAGES.map((s,i)=>{
    const cls=i<state.stage?"done":i===state.stage?"active":"locked";
    return `<div class="timeline-item ${cls}"><i>${i<state.stage?"✓":String(i+1).padStart(2,"0")}</i><span>${s.name}</span></div>`
  }).join("")
}
function renderUI(){
  const s=stage(),weather=WEATHER[state.weather];
  $("phaseChip").textContent="PHASE "+String(state.stage+1).padStart(2,"0");
  $("phaseTitle").textContent=s.name;$("sceneState").textContent=s.state;$("structureValue").textContent=s.name;$("depthValue").textContent=s.depth.toFixed(1)+" m";
  $("overallValue").textContent=Math.min(100,overall())+"%";$("weatherTop").textContent=weather.label;$("clockTop").textContent=`DAY ${String(state.day).padStart(2,"0")} · ${String(state.hour).padStart(2,"0")}:00`;
  $("moneyValue").textContent="₩"+Math.round(state.money).toLocaleString("ko-KR");$("fuelValue").textContent=Math.round(state.fuel);$("steelValue").textContent=Math.round(state.steel);$("concreteValue").textContent=Math.round(state.concrete);
  $("safetyMeter").value=state.safety;$("safetyText").textContent=Math.round(state.safety);$("qualityMeter").value=state.quality;$("qualityText").textContent=Math.round(state.quality);$("equipmentMeter").value=state.equipment;$("equipmentText").textContent=Math.round(state.equipment);
  $("taskTitle").textContent=s.task;$("taskDesc").textContent=s.desc;$("eventLog").textContent=state.event;$("taskProgress").style.width=state.progress+"%";
  $("taskCosts").innerHTML=Object.entries(s.cost).map(([k,v])=>`<span>${({money:"예산",fuel:"연료",steel:"강재",concrete:"콘크리트"})[k]} ${k==="money"?"₩"+v.toLocaleString():v}</span>`).join("");
  $("workBtn").disabled=working||state.stage>=STAGES.length-1;$("workBtn").textContent=working?"작업 중…":state.stage>=STAGES.length-1?"완공":"작업 시작";
  $("supplyBtn").disabled=working;$("maintainBtn").disabled=working;renderTimeline()
}

// THREE.JS
const canvas=$("threeCanvas"),viewport=$("viewport");
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
const scene=new THREE.Scene();scene.background=new THREE.Color(0xb7cdd1);scene.fog=new THREE.Fog(0xb7cdd1,28,62);
const camera=new THREE.PerspectiveCamera(35,1,.1,120);camera.position.set(18,15,22);
const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.target.set(0,2,0);controls.minDistance=16;controls.maxDistance=34;controls.maxPolarAngle=Math.PI*.47;controls.minPolarAngle=Math.PI*.22;controls.enablePan=false;

scene.add(new THREE.HemisphereLight(0xe9f2f3,0x6a543d,1.9));
const sun=new THREE.DirectionalLight(0xfff0d5,3.2);sun.position.set(-10,20,8);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-20;sun.shadow.camera.right=20;sun.shadow.camera.top=20;sun.shadow.camera.bottom=-20;scene.add(sun);

const siteRoot=new THREE.Group();scene.add(siteRoot);
const groundMat=new THREE.MeshStandardMaterial({color:0xa98b5d,roughness:1});
const grassMat=new THREE.MeshStandardMaterial({color:0x6f8b56,roughness:1});
const concreteMat=new THREE.MeshStandardMaterial({color:0x9d9f98,roughness:.85});
const steelMat=new THREE.MeshStandardMaterial({color:0x4d5553,roughness:.42,metalness:.55});
const darkSteel=new THREE.MeshStandardMaterial({color:0x343b38,roughness:.5,metalness:.65});
const orangeMat=new THREE.MeshStandardMaterial({color:0xd08b2c,roughness:.55,metalness:.15});
const bunkerMat=new THREE.MeshStandardMaterial({color:0x7b8079,roughness:.8});
const glassMat=new THREE.MeshStandardMaterial({color:0x315b55,roughness:.25,metalness:.2});

function mesh(geo,mat,x=0,y=0,z=0){
  const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m
}
const base=mesh(new THREE.BoxGeometry(28,.8,22),groundMat,0,-.4,0);siteRoot.add(base);
const grass=mesh(new THREE.BoxGeometry(28,.15,5),grassMat,0,.075,-8.5);siteRoot.add(grass);

const construction=new THREE.Group();siteRoot.add(construction);
function clearConstruction(){while(construction.children.length)construction.remove(construction.children[0])}
function addPit(){
  const pit=mesh(new THREE.BoxGeometry(12,.55,9),new THREE.MeshStandardMaterial({color:0x6f5037,roughness:1}),0,.08,0);construction.add(pit);
  const rimMat=new THREE.MeshStandardMaterial({color:0x8e6b46,roughness:1});
  construction.add(mesh(new THREE.BoxGeometry(14,.35,1),rimMat,0,.2,-5));construction.add(mesh(new THREE.BoxGeometry(14,.35,1),rimMat,0,.2,5));construction.add(mesh(new THREE.BoxGeometry(1,.35,9),rimMat,-6.5,.2,0));construction.add(mesh(new THREE.BoxGeometry(1,.35,9),rimMat,6.5,.2,0))
}
function addFoundation(){construction.add(mesh(new THREE.BoxGeometry(10,.65,7),concreteMat,0,.45,0))}
function addFrame(){
  const cols=[[-4,-2.5],[4,-2.5],[-4,2.5],[4,2.5]];
  cols.forEach(([x,z])=>construction.add(mesh(new THREE.BoxGeometry(.38,5,.38),steelMat,x,3,z)));
  [[-4,-2.5,4,-2.5],[-4,2.5,4,2.5],[-4,-2.5,-4,2.5],[4,-2.5,4,2.5]].forEach(([x1,z1,x2,z2])=>{
    const len=Math.hypot(x2-x1,z2-z1),bar=mesh(new THREE.BoxGeometry(len,.32,.32),steelMat,(x1+x2)/2,5.35,(z1+z2)/2);bar.rotation.y=Math.atan2(z2-z1,x2-x1);construction.add(bar)
  })
}
function addShell(){
  const wallT=.35,h=3.9;construction.add(mesh(new THREE.BoxGeometry(9, h, wallT),bunkerMat,0,2.25,-3.3));construction.add(mesh(new THREE.BoxGeometry(9,h,wallT),bunkerMat,0,2.25,3.3));construction.add(mesh(new THREE.BoxGeometry(wallT,h,6.3),bunkerMat,-4.3,2.25,0));construction.add(mesh(new THREE.BoxGeometry(wallT,h,6.3),bunkerMat,4.3,2.25,0));
  construction.add(mesh(new THREE.BoxGeometry(9,.42,6.6),bunkerMat,0,4.2,0))
}
function addSystems(){
  const panel=mesh(new THREE.BoxGeometry(2.4,1.5,.2),glassMat,0,2.1,-3.55);construction.add(panel);
  for(let i=-2;i<=2;i++){const vent=mesh(new THREE.CylinderGeometry(.18,.18,2.2,16),darkSteel,i*1.2,5.3,0);vent.rotation.z=Math.PI/2;construction.add(vent)}
}

const machines=new THREE.Group();siteRoot.add(machines);
function addExcavator(){
  const g=new THREE.Group();g.position.set(-8,.6,4);
  const track=mesh(new THREE.BoxGeometry(3,.45,1.5),darkSteel);g.add(track);const body=mesh(new THREE.BoxGeometry(1.8,1.1,1.3),orangeMat,0,.75,0);g.add(body);const cab=mesh(new THREE.BoxGeometry(.85,.8,1.05),glassMat,.35,1.45,0);g.add(cab);
  const boom=mesh(new THREE.BoxGeometry(3,.22,.22),orangeMat,1.8,2.1,0);boom.rotation.z=.55;g.add(boom);const arm=mesh(new THREE.BoxGeometry(2.2,.18,.18),orangeMat,3.8,2.8,0);arm.rotation.z=-.25;g.add(arm);machines.add(g);return g
}
function addCrane(){
  const g=new THREE.Group();g.position.set(8,.5,-3);
  g.add(mesh(new THREE.BoxGeometry(3,.5,1.7),darkSteel));g.add(mesh(new THREE.BoxGeometry(1.8,1.2,1.4),orangeMat,0,1,0));
  const mast=mesh(new THREE.BoxGeometry(.35,8,.35),darkSteel,0,5,0);g.add(mast);
  const boom=mesh(new THREE.BoxGeometry(8,.22,.22),orangeMat,-3,8.5,0);boom.rotation.z=.18;g.add(boom);
  const cable=mesh(new THREE.CylinderGeometry(.025,.025,4,8),darkSteel,-5.5,6.2,0);g.add(cable);const hook=mesh(new THREE.BoxGeometry(.3,.45,.3),orangeMat,-5.5,4.1,0);g.add(hook);machines.add(g);return {group:g,hook,cable}
}
const excavator=addExcavator();const crane=addCrane();

function syncScene(){
  clearConstruction();machines.visible=true;excavator.visible=state.stage<=3;crane.group.visible=state.stage>=4&&state.stage<=6;
  if(state.stage>=2)addPit();if(state.stage>=4)addFoundation();if(state.stage>=5)addFrame();if(state.stage>=6)addShell();if(state.stage>=7)addSystems();
  if(state.stage>=8){crane.group.visible=false;excavator.visible=false}
}
syncScene();

function resize(){
  const r=viewport.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix()
}
new ResizeObserver(resize).observe(viewport);resize();

let t=0;
function animate(){
  requestAnimationFrame(animate);t+=.016;controls.update();
  if(excavator.visible){excavator.rotation.y=Math.sin(t*.35)*.035}
  if(crane.group.visible){crane.hook.position.y=4.1+Math.sin(t*.9)*.3}
  renderer.render(scene,camera)
}
animate();

$("workBtn").onclick=runWork;$("supplyBtn").onclick=supply;$("maintainBtn").onclick=maintain;$("resetBtn").onclick=resetGame;
renderUI();