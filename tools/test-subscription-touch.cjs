const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('D:/Cocos/cocoseditors/Creator/3.8.8/resources/resources/3d/engine/node_modules/typescript');
for(const dpr of [1,2,3]){
 const exports={},UITransform=class{},host={tt:{getSystemInfoSync:()=>({pixelRatio:dpr})}};
 class Vec2{constructor(x,y){this.x=x;this.y=y;}}
 const cc={_decorator:{ccclass:()=>()=>{}},Vec2,UITransform,view:{getFrameSize:()=>({height:800})}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('assets/scripts/ui/LobbyEntries.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2018,experimentalDecorators:true}}).outputText,{exports,globalThis:host,require:n=>n==='cc'?cc:n==='./UIScreen'?{UIScreen:class{}}:{}});
 const e=new exports.LobbyEntries();e.node={activeInHierarchy:true};
 const ui={hitTest:p=>Math.abs(p.x/dpr-100)<=60&&Math.abs(p.y/dpr-100)<=25};
 const button={isValid:true,activeInHierarchy:true,getComponent:()=>ui,getComponentInChildren:()=>null};e._subscribeButton=button;
 let calls=0;e._requestSubscription=()=>calls++;
 e._nativeTouchEnd({changedTouches:[{clientX:100,clientY:700}]});assert.equal(calls,1,`center hit at DPR ${dpr}`);
 e._nativeTouchEnd({changedTouches:[{x:100,y:700}]});assert.equal(calls,2);
 e._nativeTouchEnd({changedTouches:[{clientX:250,clientY:700}]});assert.equal(calls,2,'outside must not authorize');
 button.activeInHierarchy=false;e._nativeTouchEnd({changedTouches:[{clientX:100,clientY:700}]});assert.equal(calls,2,'hidden panel must not authorize');
 e.flow={platform:{feedSubscribed:false}};e._subscriptionStatus={node:{active:true},string:''};
 e._refreshSubscription();assert.equal(button.active,true);assert.equal(e._subscriptionStatus.node.active,false);
 e.flow.platform.feedSubscribed=true;e._refreshSubscription('订阅成功');
 assert.equal(button.active,false);assert.equal(e._subscriptionStatus.node.active,true);assert.equal(e._subscriptionStatus.string,'已完成订阅');
}
console.log('PASS: native subscription hit tests at DPR 1/2/3, both touch field formats, outside/hidden exclusion.');
