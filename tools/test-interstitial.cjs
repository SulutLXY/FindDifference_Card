const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
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
    const tick=()=>new Promise(resolve=>setImmediate(resolve));
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
    now+=60000;
    const missingClose=p.showInterstitial(()=>true);await tick();
    assert.equal(p.interstitialBusy,true);
    const staleClose=close;
    p.recoverInterstitialOnTouch();await missingClose;
    assert.equal(p.interstitialBusy,false,'Engine button touch recovers a missing native close callback');
    host.tt.createRewardedVideoAd=()=>({onClose(f){this.close=f;},onError(){},offClose(){},offError(){},show(){this.close({isEnded:true});return Promise.resolve();}});
    p.configure({douyinInterstitialAdUnitId:'14eaqmfhd0gg22d184',douyinRewardedAdUnitId:'reward'});
    assert.equal((await p.showRewardedAd('revive')).completed,true,'Revive can show a real rewarded ad after recovery');
    now+=60000;
    const next=p.showInterstitial(()=>true);await tick();staleClose();
    assert.equal(p.interstitialBusy,true,'Late close from the old instance cannot unlock a newer ad');
    assert.equal((await p.showRewardedAd('hint')).success,false,'An active native interstitial still blocks direct ad calls');
    close();await next;
    let finishLoad;
    const normalCreate=host.tt.createInterstitialAd;
    host.tt.createInterstitialAd=o=>{const ad=normalCreate(o);ad.load=()=>new Promise(resolve=>finishLoad=resolve);return ad;};
    now+=60000;
    const pending=p.showInterstitial(()=>true);await tick();
    assert.equal(p.interstitialBusy,false,'Loading must not pause gameplay');
    const shownBefore=shown;
    assert.equal((await p.showRewardedAd('add-time')).completed,true,'Requested reward cancels a pending interstitial');
    await pending;finishLoad();await tick();assert.equal(shown,shownBefore,'Cancelled load cannot display over rewarded video');
    now+=60000;host.tt.createInterstitialAd=()=>{throw Error('unavailable');};await p.showInterstitial(()=>true);assert.equal(p._interstitialBusy,false);
    console.log('Passed: first settlement and shared entry trigger, configured ID, cooldown/busy guards, stale-page cancellation, close/error recovery.');
})().catch(e=>{console.error(e);process.exitCode=1;});
