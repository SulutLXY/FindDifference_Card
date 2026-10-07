const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const scene=JSON.parse(fs.readFileSync('assets/scene/game.scene','utf8'));
const game=fs.readFileSync('assets/scripts/ui/GameScreen.ts','utf8');
const hud=game.slice(game.indexOf('const flow = this.flow;',game.indexOf('public refreshHud()')),game.indexOf('const timer =',game.indexOf('public refreshHud()')));
const labels={},sprites={};class Label{} class Sprite{}
function node(index){
 const item=scene[index];
 return {name:item._name,active:item._active,children:(item._children||[]).map(c=>node(c.__id__)),
 getComponent(type){if(type===Sprite)return sprites[index]??={grayscale:false};const label=(item._components||[]).map(c=>scene[c.__id__]).find(c=>c.__type__==='cc.Label');return label?(labels[index]??={string:label._string}):null;},
 getComponentInChildren(){for(const child of this.children){const label=child.getComponent()||child.getComponentInChildren();if(label)return label;}return null;}};
}
function find(root,name){for(const child of root.children){if(child.name===name)return child;const nested=find(child,name);if(nested)return nested;}return null;}
const hint=node(scene.findIndex(n=>n._name==='BtnHint')),time=node(scene.findIndex(n=>n._name==='BtnAddTime'));
const ctx={btnHint:hint,btnAddTime:time,flow:{save:{freeHints:7,freeAddTimes:3},canWatchHintAd:true,canWatchAddTimeAd:true},resolveNode:n=>n,findChildDeep:find};
const ts=require('D:/Cocos/cocoseditors/Creator/3.8.8/resources/resources/3d/engine/node_modules/typescript');
const script=ts.transpileModule('(function(){'+hud+'})',{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText;
const refresh=vm.runInNewContext(script,{Label,Sprite});
refresh.call(ctx);
assert.equal(find(hint,'Times').getComponent().string,'7');assert.equal(find(time,'Times').getComponent().string,'3');
for(const button of [hint,time]){assert.equal(find(button,'icon_Tips01').active,true);assert.equal(find(button,'icon_videoplay').active,false);assert.equal(button.getComponent(Sprite).grayscale,false);}
ctx.flow.save.freeHints=0;ctx.flow.save.freeAddTimes=0;refresh.call(ctx);
assert.equal(find(hint,'Times').getComponent().string,'');assert.equal(find(time,'Times').getComponent().string,'');
for(const button of [hint,time]){assert.equal(find(button,'icon_Tips01').active,false);assert.equal(find(button,'icon_videoplay').active,true);assert.equal(find(button,'Times').active,false);assert.equal(button.getComponent(Sprite).grayscale,false);}
ctx.flow.canWatchHintAd=false;ctx.flow.canWatchAddTimeAd=false;refresh.call(ctx);
for(const button of [hint,time]){assert.equal(find(button,'icon_videoplay').active,false);assert.equal(button.getComponent(Sprite).grayscale,true);}
ctx.flow.save.freeHints=1;refresh.call(ctx);assert.equal(hint.getComponent(Sprite).grayscale,false);assert.equal(find(hint,'icon_Tips01').active,true);
console.log('Passed: actual scene stock/ad/exhausted icons, counts, grayscale, and restored inventory.');
