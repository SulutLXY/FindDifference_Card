const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const scene=read('assets/scene/game.scene'),home=read('assets/LobbySources/prefabs/LobbyScreen.prefab');
assert.ok(!scene.some(x=>x.__type__==='cc.Node'&&['Lobby','LobbyScreen','CitySelect','LevelSelect'].includes(x._name)));
assert.equal(scene.find(x=>'lobby'in x).lobby,null);assert.equal(scene.find(x=>'lobby'in x).game,null);
assert.equal(scene.find(x=>'citySelect'in x).citySelect,null);assert.equal(scene.find(x=>'levelSelect'in x).levelSelect,null);
assert.ok(!fs.existsSync('assets/SecondaryUI'),'Secondary pages must physically belong to the lobby directory');
const metas=new Map();for(const f of walk('assets').filter(f=>f.endsWith('.meta'))){const m=read(f);for(const id of [m.uuid,...Object.values(m.subMetas||{}).map(s=>s.uuid)])metas.set(id,f.slice(0,-5).replaceAll('\\','/'));}
const seen=new Set();function dependencies(value){if(!value||typeof value!=='object')return;if(value.__uuid__){const f=metas.get(value.__uuid__);assert.ok(!f?.startsWith('assets/LobbySources/'),'Startup transitively depends on remote lobby '+f);if(f&&!seen.has(f)&&/\.(prefab|anim|json|mtl)$/.test(f)){seen.add(f);dependencies(read(f));}}Object.values(value).forEach(dependencies);}
dependencies(scene);for(const f of walk('assets/resources').filter(f=>/\.(prefab|anim)$/.test(f)))dependencies(read(f));
const settings=read('settings/v2/packages/builder.json').bundleConfig.custom;
const bundles=walk('assets').filter(f=>f.endsWith('.meta')).map(f=>({root:f.slice(0,-5).replaceAll('\\','/'),meta:read(f).userData})).filter(b=>b.meta?.isBundle).sort((a,b)=>b.root.length-a.root.length);
for(const f of seen){const owner=bundles.find(b=>f.startsWith(b.root+'/'));if(owner&&owner.root!=='assets/resources')assert.equal(owner.meta.bundleConfigID,'default','Startup dependency must be local: '+f);}
const game=read('assets/PleyGame.meta').userData,lobby=read('assets/LobbySources.meta').userData;
assert.equal(settings[game.bundleConfigID].configs.miniGame.fallbackOptions.isRemote,true);
assert.equal(settings[lobby.bundleConfigID].configs.miniGame.fallbackOptions.isRemote,true);
assert.equal(lobby.bundleName,'LobbySources');
// Art may change after migration; validate references without freezing editable coordinates.
for(const name of ['LobbyScreen','CitySelectScreen','LevelSelectScreen']){
 const graph=read('assets/LobbySources/prefabs/'+name+'.prefab');
 for(const [i,node]of graph.entries())if(node.__type__==='cc.Node')for(const ref of node._components)assert.equal(graph[ref.__id__].node.__id__,i);
}
const text=fs.readFileSync('assets/scripts/GameFlow.ts','utf8'),tree=ts.createSourceFile('Flow.ts',text,ts.ScriptTarget.Latest,true);
const names=['_navigationPagesPending','_loadLobbyBundle','loadLobbyPrefab','_ensureLobby','_preloadLobby','_openLobby','showLobby','_cancelSecondaryNavigation','openDailySignIn','_ensureNavigationPage','_openNavigationPage','_tickLobbyWarmup'];
const body=tree.statements.find(ts.isClassDeclaration).members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
class Prefab{} class AudioClip{} class LobbyScreen{} class CitySelectScreen{} class LevelSelectScreen{} class SpriteFrame{}
let requests=0,finish,created=0;
const loaded=[];const bundle={load(request,type,done){loaded.push(request);done(null,{request});}};
const Flow=vm.runInNewContext(ts.transpileModule('class Flow{'+body+'};Flow;', {compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{
    Prefab,AudioClip,LobbyScreen,CitySelectScreen,LevelSelectScreen,SpriteFrame,console:{warn(){}},sidebarDay:()=> '2026-11-03',
    assetManager:{loadBundle(name,done){assert.equal(name,'LobbySources');requests++;finish=done;}},
    instantiate(){created++;const node={active:true,name:'',destroy(){},getComponent(){return {isValid:true,node,preloadHero:async()=>assert.fail('Home animation warmed during gameplay')};}};return node;}
});
const tick=()=>new Promise(setImmediate);
(async()=>{
 const f=new Flow();f._sharedUIReady=true;f.isValid=true;f.node={parent:{getChildByName:()=>({})}};f._musicClips=new Map();f._secondaryNavigationVersion=0;
 let opens=0;f._switchTo=()=>opens++;
 const a=f._ensureLobby(),b=f._ensureLobby();assert.equal(requests,1);finish(Error('offline'));await assert.rejects(a);await assert.rejects(b);assert.equal(created,0);
 const retry=f._ensureLobby();assert.equal(requests,2);finish(null,bundle);await retry;assert.equal(created,1);assert.equal(f.lobby.node.active,false);assert.equal(opens,0);
 await f._preloadLobby();await f._ensureLobby();assert.equal(created,1);assert.equal(opens,0,'Background preload never activates lobby');assert.ok(f._musicClips.has('voice/BGmusic/Main_music00'));
 assert.deepEqual(loaded,['prefabs/LobbyScreen','voice/BGmusic/Main_music00'],'Warm only home shell/music; no sign-in, collection, cover or hero assets');
 f.showLobby();assert.equal(opens,1,'Warm return is synchronous');
 // A foreground return waiting for download must not hijack a later navigation.
 const stale=new Flow();stale.isValid=true;stale._secondaryNavigationVersion=0;stale._isPaused=false;stale._currentLevel={};let resolve;
 stale._ensureLobby=()=>new Promise(r=>resolve=r);stale._switchTo=()=>assert.fail('Stale callback navigated');
 const waiting=stale._openLobby();stale._cancelSecondaryNavigation();resolve({});await waiting;
 const failed=new Flow();failed.isValid=true;failed._secondaryNavigationVersion=0;failed._isPaused=false;failed._currentLevel={};failed.toast=()=>{};failed._ensureLobby=async()=>{throw Error('offline');};
 await failed._openLobby();assert.equal(failed._isPaused,false);assert.equal(failed._secondaryPageLoading,false);
 const twice=new Flow();twice.isValid=true;twice._secondaryNavigationVersion=0;twice._isPaused=false;twice._currentLevel={};twice.toast=()=>{};const rejects=[];twice._ensureLobby=()=>new Promise((_,reject)=>rejects.push(reject));
 const firstReturn=twice._openLobby(),secondReturn=twice._openLobby();rejects.forEach(reject=>reject(Error('offline')));await Promise.all([firstReturn,secondReturn]);assert.equal(twice._isPaused,false,'Repeated returns must not leave gameplay paused after network failure');
 // Even automatic sign-in on the gameplay page cannot download or prompt.
 const daily=new Flow();daily._dailyConfig={};daily.game={node:{activeInHierarchy:true}};daily._ensureDailySignIn=()=>assert.fail('Sign-in requested outside lobby');assert.equal(await daily.openDailySignIn(true),false);
 // Eight active gameplay seconds before shell warmup; loading/tutorial/Feed pauses do not count.
 function cold(){const m=new Flow();m.isValid=true;m._lobbyWarmupRemaining=8;m._lobbyWarmupStarted=false;
   m.game={node:{activeInHierarchy:true}};m.platform={interstitialBusy:false};m.feed={isPreview:false};
   m._ensureNavigationPage=()=>assert.fail('Background created a navigation page');
   m._ensureSecondaryPage=()=>assert.fail('Background created collection/rank');
   m._contentBundles={use:()=>assert.fail('Background downloaded covers or food icons')};
   m._preloadLobby=async()=>{m.warmCalls=(m.warmCalls||0)+1;};return m;}
 const menu=cold();for(let i=0;i<7;i++)menu._tickLobbyWarmup(1);assert.equal(menu.warmCalls,undefined);
 menu._tickLobbyWarmup(1);assert.equal(menu.warmCalls,1);menu._tickLobbyWarmup(100);assert.equal(menu.warmCalls,1);
 for(const flag of ['_levelLoading','_isPaused','_isGameOver']){const blocked=cold();blocked[flag]=true;blocked._tickLobbyWarmup(20);assert.equal(blocked._lobbyWarmupRemaining,8);}
 const feed=cold();feed.feed.isPreview=true;feed._tickLobbyWarmup(20);assert.equal(feed._lobbyWarmupRemaining,8);
 const ad=cold();ad.platform.interstitialBusy=true;ad._tickLobbyWarmup(20);assert.equal(ad._lobbyWarmupRemaining,8);
 const disposed=cold();disposed.isValid=false;disposed._tickLobbyWarmup(20);assert.equal(disposed.warmCalls,undefined);
 const resumed=cold();resumed._tickLobbyWarmup(999);assert.equal(resumed._lobbyWarmupRemaining,7,'Resume delta cannot trigger immediate downloads');
 const warm=cold();warm.lobby={isValid:true};for(let i=0;i<8;i++)warm._tickLobbyWarmup(1);assert.equal(warm.warmCalls,undefined,'Foreground-loaded home needs no duplicate warmup');
 const nav=new Flow();nav.isValid=true;nav.node={parent:{getChildByName:()=>({})}};let finishNav,navLoads=0;
 nav.loadLobbyPrefab=()=>{navLoads++;return new Promise(r=>finishNav=r);};
 const navA=nav._ensureNavigationPage('citySelect'),navB=nav._ensureNavigationPage('citySelect');assert.equal(navLoads,1);
 finishNav({});await Promise.all([navA,navB]);assert.equal(nav.citySelect.node.active,false,'Prepared navigation stays inactive');
 await tick();console.log('PASS: local Loading / remote gameplay and lobby, no startup lobby dependencies, preserved layout, download merge, retry, warm return, stale navigation protection, background isolation and lobby-only sign-in.');
})().catch(error=>{console.error(error);process.exitCode=1;});
