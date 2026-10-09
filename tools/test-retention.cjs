const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ts=require('D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function methods(file,names,extra={}){
 const text=fs.readFileSync(file,'utf8'), tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 const cls=tree.statements.find(ts.isClassDeclaration);
 const body=cls.members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
 return vm.runInNewContext(ts.transpileModule('class Test {'+body+'}\nTest;',{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{console,...extra});
}
(async()=>{
 const Save=methods('assets/scripts/services/SaveService.ts',['beginDailyFirstRound']); const save=new Save();save._data={};save._persist=()=>true;
 assert.equal(save.beginDailyFirstRound('2026-10-09'),true);assert.equal(save.beginDailyFirstRound('2026-10-09'),false);
 const reload=new Save();reload._data=JSON.parse(JSON.stringify(save._data));reload._persist=()=>true;
 assert.equal(reload.beginDailyFirstRound('2026-10-09'),false);assert.equal(reload.beginDailyFirstRound('2026-10-10'),true);
 const Flow=methods('assets/scripts/GameFlow.ts',['finishLevel','update']);
 for(const win of [true,false]) for(const collected of [true,false]){
  const f=new Flow();let popups=0;f._currentLevel={key:'food',type:'food',timeLimit:100};f._remainingTime=90;f._elapsedTime=10;
  f._playResultTone=()=>{};f.save={isCompleted:()=>collected,completeLevel(){},totalScore:2};f.rankProvider={submitScore(){}};
  f.resultModal={present(){}};f.findNextLevel=()=>null;f.showFoodTips=()=>popups++;f.platform={onRoundFinished(){}};
  f.finishLevel(win);assert.equal(popups,win&&!collected?1:0);
 }
 const timer=new Flow();timer.platform={interstitialBusy:true};timer._remainingTime=100;timer._elapsedTime=0;
 timer.update(5);assert.equal(timer._remainingTime,100);timer.platform.interstitialBusy=false;timer._currentLevel={};timer.game={node:{active:true},refreshHud(){}};
 timer.update(1);assert.equal(timer._remainingTime,99);
 let inflight=0,max=0;const calls=[];
 const Pre=methods('assets/scripts/GameFlow.ts',['preloadNextLevel'],{SpriteFrame:class{},assetManager:{preloadAny(req,opts,cb){assert.equal(opts.priority,-1);assert.equal(opts.maxConcurrency,1);calls.push(req.uuid);max=Math.max(max,++inflight);setTimeout(()=>{inflight--;cb(null)},1)}}});
 const p=new Pre();p.isValid=true;p._levelLoadVersion=1;p.game={node:{activeInHierarchy:true}};p._currentLevel={key:'city/01'};p._currentCity={key:'city',levels:['01','02']};p._cities=[p._currentCity];
 p._loadCityBundle=async()=>({name:'city',getInfoWithPath:path=>({uuid:path})});p._loadLevel=async()=>({topImage:'top',bottomImage:'bottom'});
 await p.preloadNextLevel(p._currentLevel);assert.deepEqual(calls,['top','bottom']);assert.equal(max,1);
 calls.length=0;p._loadLevel=async()=>{p._levelLoadVersion++;return {topImage:'top',bottomImage:'bottom'}};
 await p.preloadNextLevel(p._currentLevel);assert.equal(calls.length,0);
 console.log('PASS daily first round persistence/day rollover, food first-win only, interstitial timer pause/resume, serial low-priority prefetch and stale cancellation');
})().catch(e=>{console.error(e);process.exitCode=1});
