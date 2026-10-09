const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ts=require('D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function methods(file,names,extra={}){
 const text=fs.readFileSync(file,'utf8'), tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 const cls=tree.statements.find(ts.isClassDeclaration);
 const body=cls.members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
 return vm.runInNewContext(ts.transpileModule('class Test {'+body+'}\nTest;',{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{console:{error(){}},...extra});
}
(async()=>{
 const Screen=methods('assets/scripts/ui/GameScreen.ts',['clearLevel','setupLevel'],{Sprite:class{}});
 const s=new Screen();s.isValid=true;s._setupToken=0;s._levelFrames=[];
 const sprites={TopImage:{spriteFrame:null},BottomImage:{spriteFrame:null}};
 s._image=n=>({getComponent:()=>sprites[n]});s._resetGesture=()=>{};s._clearMarkers=()=>{};s._clearWrongMarkers=()=>{};s._resetLivesAnimation=()=>{};s._setZoom=()=>{};s.setLabel=()=>{};s.refreshHud=()=>{};
 s.resolveNode=(_,n)=>sprites[n];s._applySpriteFrame=(n,f)=>n.spriteFrame=f;
 let refs=0;const frames=[];s.flow={acquireLevelFrame:async()=>{refs++;const f={decRef(){refs--;}};frames.push(f);return f;}};
 for(let i=0;i<15;i++){await s.setupLevel({name:'test',topImage:'a',bottomImage:'b'});assert.equal(refs,2);}
 s.clearLevel();assert.equal(refs,0);assert.equal(sprites.TopImage.spriteFrame,null);
 let calls=0;s.flow.acquireLevelFrame=async()=>{if(++calls===2)throw Error('offline');refs++;return {decRef(){refs--}}};
 await assert.rejects(s.setupLevel({name:'test',topImage:'a',bottomImage:'b'}));assert.equal(refs,0);
 let finish;s.flow.acquireLevelFrame=()=>new Promise(r=>{finish=()=>{refs++;r({decRef(){refs--}})}});
 const pending=s.setupLevel({name:'test',topImage:'a',bottomImage:'b'});s.clearLevel();finish();await assert.rejects(pending);assert.equal(refs,0);
 const Flow=methods('assets/scripts/GameFlow.ts',['startLevel'],{sidebarDay:()=> '2026-10-09'});
 const f=new Flow();f.isValid=true;f._levelLoadVersion=0;f._assistRoundVersion=0;f._foundIds=new Set();f.ensureCity=async()=>{};
 f._showFirstLevelTutorial=()=>{};f._drawLoadingFrame=async()=>{};f._setLoadingProgress=()=>{};f._switchTo=()=>{};f.toast=()=>{};f.preloadNextLevel=()=>{};
 const footer={active:true};f._loadingNode={active:false,parent:{children:[{}]},getChildByName:n=>n==='FooterEnv'?footer:null,setSiblingIndex(){}};f._ensureLoadingBack=()=>{};
 let mark=0;f.save={beginDailyFirstRound(){mark++;return true},totalScore:0};
 let resolveSetup;f.game={clearLevel(){},setupLevel:()=>new Promise(r=>resolveSetup=r)};
 const city={levelConfigs:[{timeLimit:100,maxLives:5}]};const loading=f.startLevel(city,0);await new Promise(setImmediate);assert.equal(f._isPaused,true);assert.equal(f._levelLoading,true);assert.equal(mark,0);assert.equal(footer.active,false);assert.equal(f._loadingNode.active,true);
 resolveSetup();await loading;assert.equal(f._levelLoading,false);assert.equal(f._isPaused,false);assert.equal(mark,1);assert.equal(f._loadingNode.active,false);
 f.game.setupLevel=async()=>{throw Error('offline')};await f.startLevel(city,0);assert.equal(f._isPaused,true);assert.equal(typeof f._levelRetry,'function');assert.equal(mark,1);
 console.log('PASS: 15 transitions retain only 2 owned frames; partial failure/cancel release references; loading blocks timer state; success resumes; failure offers retry without consuming daily protection.');
})().catch(e=>{console.error(e);process.exitCode=1});

