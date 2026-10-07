const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('D:/Cocos/cocoseditors/Creator/3.8.8/resources/resources/3d/engine/node_modules/typescript');
const source=fs.readFileSync('assets/scripts/services/PlatformService.ts','utf8');
let created=0,shown=0,destroyed=0,close,fail,now=100000;
const host={tt:{createInterstitialAd:o=>{
    assert.equal(o.adUnitId,'14eaqmfhd0gg22d184');created++;
    return {onClose:f=>close=f,onError:f=>fail=f,offClose(){},offError(){},destroy(){destroyed++;},load:async()=>{},show:async()=>{shown++;}};
}}};
const output={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2018}}).outputText,{
    exports:output,globalThis:host,setTimeout,clearTimeout,Date:{now:()=>now},console:{warn(){},info(){}},
    require:n=>n==='cc/env'?{BYTEDANCE:true,WECHAT:false}:n.includes('Sidebar')?{SidebarService:class{}}:{PlayerInfoService:class{}},
});
(async()=>{
    const p=new output.PlatformService();p.configure({douyinInterstitialAdUnitId:'14eaqmfhd0gg22d184'});
    const tick=async()=>{await Promise.resolve();await Promise.resolve();};
    let resolved=false;const first=p.onRoundFinished(()=>true).then(()=>resolved=true);
    await tick();assert.equal(shown,1,'first settlement attempts immediately');assert.equal(resolved,false,'wait for native close');
    await p.showInterstitial(()=>true);assert.equal(created,1,'busy excludes overlap');
    close();await first;assert.equal(destroyed,1);
    const repeated=p.onRoundFinished(()=>true);await tick();assert.equal(created,2,'every settlement bypasses cooldown');close();await repeated;
    created=0;shown=0;destroyed=0;
    await p.showInterstitial(()=>true);assert.equal(created,0,'other entries retain frequency guard');
    now+=59000;await p.showInterstitial(()=>true);assert.equal(created,0,'protected for the full minute');
    now+=1000;await p.showInterstitial(()=>false);assert.equal(created,0);
    const second=p.showInterstitial(()=>true);await tick();assert.equal(shown,1);fail({errCode:2002});await second;assert.equal(destroyed,1);
    now+=60000;let checks=0;await p.onRoundFinished(()=>++checks===1);assert.equal(created,2);assert.equal(shown,1);assert.equal(destroyed,2);
    now+=60000;host.tt.createInterstitialAd=()=>{throw Error('unavailable');};await p.showInterstitial(()=>true);assert.equal(p._interstitialBusy,false);
    console.log('Passed: first settlement and shared entry trigger, configured ID, cooldown/busy guards, stale-page cancellation, close/error recovery.');
})().catch(e=>{console.error(e);process.exitCode=1;});
