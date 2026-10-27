const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function methods(file,names,extra={}) {
 const source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const body=tree.statements.find(ts.isClassDeclaration).members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
 return vm.runInNewContext(ts.transpileModule(`class Test {${body}}; Test;`,{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{console,...extra});
}
const Flow=methods('assets/scripts/GameFlow.ts',['enterLevelSelection','requestLevelSelectAccess','requestReward','requestEnergyReward','energyAdsRemaining','returnToLobby'],{sidebarDay:()=> '2026-10-26'});
(async()=>{
 const f=new Flow();f.isValid=true;f.lobby={node:{activeInHierarchy:true}};f.citySelect={node:{activeInHierarchy:true}};f._secondaryNavigationVersion=0;f._isPaused=false;
 let access=false,ads=0,rewards=0,entered=0,claims=0,energy=0,quota=3,finish;
 f.save={hasLevelSelectAccess:()=>access,grantLevelSelectAccess:()=>access=true,get energy(){return energy;},energyLimit:99,energyRecoveryLimit:10,
  energyAdsRemaining:()=>quota,claimEnergyAd:()=>{claims++;energy=Math.min(99,energy+5);quota--;return true;}};
 f.toast=()=>{};f.showCitySelect=()=>entered++;
 f.platform={showRewardedAd:()=>{rewards++;return new Promise(r=>finish=r);},showInterstitial:async(active,frequency,round)=>{assert.ok(active());assert.equal(frequency,true);assert.equal(round,true);ads++;}};
 const first=f.enterLevelSelection();await f.enterLevelSelection();assert.equal(rewards,1);assert.equal(ads,0);assert.equal(entered,0);
 finish({success:true,completed:false});await first;assert.equal(entered,0);assert.equal(access,false);
 const good=f.enterLevelSelection();finish({success:true,completed:true});await good;
 assert.equal(entered,1);assert.equal(access,true);assert.equal(ads,1,'First successful entry also requests an interstitial; native SDK controls reward frequency');
 await f.enterLevelSelection();assert.equal(entered,2);assert.equal(ads,2,'Valid pass requests an interstitial on every entry');
 access=false;const stale=f.enterLevelSelection();f._secondaryNavigationVersion++;finish({success:true,completed:true});await stale;
 assert.equal(access,true);assert.equal(entered,2,'Earned pass persists but stale result cannot navigate');
 f._isPaused=false;const cancelled=f.requestEnergyReward();await f.requestEnergyReward();assert.equal(f._isPaused,true);
 finish({success:false,completed:false});await cancelled;assert.equal(claims,0);assert.equal(quota,3);assert.equal(f._isPaused,false);
 const gain=f.requestEnergyReward();finish({success:true,completed:true});await gain;assert.equal(energy,5);assert.equal(quota,2);
 f._isPaused=true;const paused=f.requestEnergyReward();finish({success:true,completed:true});await paused;assert.equal(f._isPaused,true);assert.equal(energy,10);
 const fullCalls=rewards;await f.requestEnergyReward();assert.equal(rewards,fullCalls,'No ad at recovery cap');
 energy=9;const bonus=f.requestEnergyReward();finish({success:true,completed:true});await bonus;assert.equal(energy,14,'A video started below 10 grants the whole +5');
 const calls=rewards;for(const value of [14,99]){energy=value;await f.requestEnergyReward();assert.equal(rewards,calls,'No ad at or above 10');}
 energy=0;quota=0;await f.requestEnergyReward();assert.equal(rewards,calls,'No ad after daily limit');
 f.showLobby=()=>{f.lobby.node.activeInHierarchy=true;};f.returnToLobby();await new Promise(setImmediate);assert.equal(ads,3,'Return home requests interstitial');
 const Display=methods('assets/scripts/ui/EnergyDisplay.ts',['_refresh','_onRewardClick']);const d=new Display();let clicked=0;d.flow={save:{energy:9,energyLimit:99,energyRecoveryLimit:10,energyRecoverySeconds:61},requestEnergyReward:()=>clicked++};
 d.energyLabel={string:''};d.countdownLabel={string:''};d.countdownRoot={active:false};d.videoIcon={active:false};
 d._refresh();assert.equal(d.energyLabel.string,'体力 9');assert.equal(d.countdownRoot.active,true);assert.equal(d.countdownLabel.string,'01:01');assert.equal(d.videoIcon.active,true);
 d._onRewardClick();assert.equal(clicked,1);
 d.flow.save.energyRecoverySeconds=60;d._refresh();assert.equal(d.countdownLabel.string,'01:00');
 d.flow.save.energy=10;d._onRewardClick();assert.equal(clicked,1,'Click rechecks actual energy before next display refresh');
 for(const energy of [10,15,98,99]){d.flow.save.energy=energy;d._refresh();assert.equal(d.energyLabel.string,`体力 ${energy}`);assert.equal(d.countdownRoot.active,true);assert.equal(d.countdownLabel.string,'体力已满');assert.equal(d.videoIcon.active,false);d._onRewardClick();assert.equal(clicked,1);}
 d.flow.save.energy=9;d._refresh();assert.equal(d.countdownLabel.string,'01:00');assert.equal(d.videoIcon.active,true);d._onRewardClick();assert.equal(clicked,2);
 for(const screen of ['LobbyScreen','CitySelectScreen','LevelSelectScreen','GameScreen'])assert.match(fs.readFileSync(`assets/scripts/ui/${screen}.ts`,'utf8'),/EnergyDisplay\.attach\(this\.node/);
 console.log('PASS: entry reward vs interstitial, duplicate/stale/cancelled requests, energy quota and pause restoration, home ad, four-page energy and countdown visibility.');
})().catch(e=>{console.error(e);process.exitCode=1;});
