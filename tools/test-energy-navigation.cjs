const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function methods(file,names,extra={}) {
 const source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const body=tree.statements.find(ts.isClassDeclaration).members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
 return vm.runInNewContext(ts.transpileModule(`class Test {${body}}; Test;`,{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{console,...extra});
}
const Flow=methods('assets/scripts/GameFlow.ts',['enterLevelSelection','requestReward','requestEnergyReward','returnToLobby'],{sidebarDay:()=> '2026-10-26'});
(async()=>{
 const f=new Flow();f.isValid=true;f.lobby={isValid:true,node:{activeInHierarchy:true}};f.citySelect={node:{activeInHierarchy:true}};f._secondaryNavigationVersion=0;f._isPaused=false;
 let ads=0,rewards=0,entered=0,claims=0,energy=0,finish;
 f.save={hasLevelSelectAccess:()=>{throw Error('Free entry must not read legacy access');},grantLevelSelectAccess:()=>{throw Error('Free entry must not grant legacy access');},get energy(){return energy;},energyLimit:99,energyRecoveryLimit:15,
  claimEnergyAd:()=>{claims++;energy=Math.min(99,energy+5);return true;}};
 f.toast=()=>{};f.showCitySelect=()=>entered++;
 f.platform={showRewardedAd:()=>{rewards++;return new Promise(r=>finish=r);},showInterstitial:async(active,frequency,round)=>{assert.ok(active());assert.equal(frequency,true);assert.equal(round,true);ads++;}};
 const first=f.enterLevelSelection();await f.enterLevelSelection();await first;
 assert.equal(rewards,0);assert.equal(entered,1);assert.equal(ads,1,'Free entry opens before any interstitial and ignores old access');
 await f.enterLevelSelection();assert.equal(entered,2);assert.equal(ads,2);assert.equal(rewards,0);
 const open=f.showCitySelect;f.citySelect.node.activeInHierarchy=false;
 f.showCitySelect=()=>new Promise(resolve=>finish=resolve);
 const stale=f.enterLevelSelection();f._secondaryNavigationVersion++;finish();await stale;
 assert.equal(entered,2);assert.equal(ads,2,'A cancelled page load cannot request an entry ad');
 assert.equal(f._levelSelectEntryPending,false);f.showCitySelect=open;
 const Lobby=methods('assets/scripts/ui/LobbyScreen.ts',['_refreshLevelSelectEntry']);
 const lobby=new Lobby(),icon={active:true},tip={active:true};
 lobby.resolveNode=()=>({getChildByName:()=>icon});lobby.findChildDeep=()=>tip;
 lobby._refreshLevelSelectEntry();assert.equal(icon.active,false);assert.equal(tip.active,false);
 f._isPaused=false;const cancelled=f.requestEnergyReward();await f.requestEnergyReward();assert.equal(f._isPaused,true);
 finish({success:false,completed:false});await cancelled;assert.equal(claims,0);assert.equal(f._isPaused,false);
 const gain=f.requestEnergyReward();finish({success:true,completed:true});await gain;assert.equal(energy,5);
 f._isPaused=true;const paused=f.requestEnergyReward();finish({success:true,completed:true});await paused;assert.equal(f._isPaused,true);assert.equal(energy,10);
 energy=15;const fullCalls=rewards;await f.requestEnergyReward();assert.equal(rewards,fullCalls,'No ad at recovery cap');
 energy=9;const bonus=f.requestEnergyReward();finish({success:true,completed:true});await bonus;assert.equal(energy,14,'A video started below 15 grants the whole +5');
 const calls=rewards;for(const value of [15,99]){energy=value;await f.requestEnergyReward();assert.equal(rewards,calls,'No ad at or above 15');}
 energy=0;const again=f.requestEnergyReward();finish({success:true,completed:true});await again;assert.equal(energy,5,'Daily limit removed; ads remain available');
 f.showLobby=()=>{f.lobby.node.activeInHierarchy=true;};f.returnToLobby();await new Promise(setImmediate);assert.equal(ads,3,'Return home requests interstitial');
 const Display=methods('assets/scripts/ui/EnergyDisplay.ts',['_refresh','_onRewardClick']);const d=new Display();let clicked=0;d.flow={save:{energy:9,energyLimit:99,energyRecoveryLimit:15,energyRecoverySeconds:61},requestEnergyReward:()=>clicked++};
 d.energyLabel={string:''};d.countdownLabel={string:''};d.countdownRoot={active:false};d.videoIcon={active:false};
 d._refresh();assert.equal(d.energyLabel.string,'9');assert.equal(d.countdownRoot.active,true);assert.equal(d.countdownLabel.string,'01:01');assert.equal(d.videoIcon.active,true);
 d._onRewardClick();assert.equal(clicked,1);
 d.flow.save.energyRecoverySeconds=60;d._refresh();assert.equal(d.countdownLabel.string,'01:00');
 d.flow.save.energy=15;d._onRewardClick();assert.equal(clicked,1,'Click rechecks actual energy before next display refresh');
 for(const energy of [15,16,98,99]){d.flow.save.energy=energy;d._refresh();assert.equal(d.energyLabel.string,String(energy));assert.equal(d.countdownRoot.active,true);assert.equal(d.countdownLabel.string,'');assert.equal(d.videoIcon.active,false);d._onRewardClick();assert.equal(clicked,1);}
 d.flow.save.energy=9;d._refresh();assert.equal(d.countdownLabel.string,'01:00');assert.equal(d.videoIcon.active,true);d._onRewardClick();assert.equal(clicked,2);
 for(const energy of [10,11,12,13,14]){d.flow.save.energy=energy;d._refresh();assert.equal(d.countdownLabel.string,'01:00');assert.equal(d.videoIcon.active,true);d._onRewardClick();}
 assert.equal(clicked,7,'Energy from 10 through 14 must retain countdown and video access');
 for(const screen of ['LobbyScreen','CitySelectScreen','LevelSelectScreen','GameScreen'])assert.match(fs.readFileSync(`assets/scripts/ui/${screen}.ts`,'utf8'),/EnergyDisplay\.attach\(this\.node/);
 console.log('PASS: free level-selection entry without legacy access/reward ads, hidden video/caption, duplicate/stale requests, uncapped energy ads, home ad and four-page energy/countdown visibility.');
})().catch(e=>{console.error(e);process.exitCode=1;});
