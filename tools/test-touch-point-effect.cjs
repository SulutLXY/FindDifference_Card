const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
class Vec3 {
    constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
    clone(){return new Vec3(this.x,this.y,this.z);}
}
class UITransform {
    convertToNodeSpaceAR(point){const w=this.node.world();return new Vec3((point.x-w.x)/w.sx,(point.y-w.y)/w.sy,0);}
}
class Node {
    static EventType={TOUCH_START:'touch'};
    constructor(name){this.name=name;this.children=[];this.position=new Vec3();this.scale=new Vec3(1,1,1);this.parts=new Map();this.isValid=true;this.layer=1;}
    addComponent(Type){const component=new Type();component.node=this;this.parts.set(Type,component);return component;}
    getComponent(Type){return this.parts.get(Type);}
    getComponentsInChildren(Type){return [...(this.parts.has(Type)?[this.parts.get(Type)]:[]),...this.children.flatMap(child=>child.getComponentsInChildren(Type))];}
    getChildByName(name){return this.children.find(child=>child.name===name);}
    addChild(node){node.parent=this;this.children.push(node);}
    setScale(scale){this.scale=scale.clone();}
    setPosition(position){this.position=position.clone();}
    setSiblingIndex(){} on(){} off(){}
    destroy(){this.isValid=false;this.children.forEach(child=>child.destroy());}
    world(){const p=this.parent?.world()??{x:0,y:0,sx:1,sy:1};return {x:p.x+this.position.x*p.sx,y:p.y+this.position.y*p.sy,sx:p.sx*this.scale.x,sy:p.sy*this.scale.y};}
}
let loaded;
let created=0;
class Animation {
    constructor(){this.defaultClip={name:'TouchPoint_01'};this.playOnLoad=this.enabledInHierarchy=true;this.plays=0;this.stops=0;this.samples=0;
        this.state={time:1,sample:()=>{this.samples++;this.node.visualAlpha=1;}};}
    play(){this.plays++;} stop(){this.stops++;} getState(){return this.state;}
}
const output={};
const cc={_decorator:{ccclass:()=>Type=>Type},Component:class {constructor(){this.isValid=this.enabledInHierarchy=true;this.callbacks=[];}scheduleOnce(callback){this.callbacks.push(callback);}unscheduleAllCallbacks(){this.callbacks=[];}},
    Animation,EventTouch:class{},input:{on(){},off(){}},Input:{EventType:{TOUCH_START:'touch'}},Node,Prefab:class{},UITransform,Vec3,
    resources:{load(path,Type,callback){loaded=callback;}},instantiate(){created++;const node=new Node('TouchPoint');node.addComponent(Animation);node.setScale(new Vec3(.8,.8,1));return node;}};
const source=fs.readFileSync('assets/scripts/ui/TouchPointEffect.ts','utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2018,module:ts.ModuleKind.CommonJS,experimentalDecorators:true}}).outputText,{exports:output,require:name=>name==='cc'?cc:{getGameFlow:()=>({loadCommonPrefab:()=>new Promise((resolve,reject)=>{loaded=(error,prefab)=>error?reject(error):resolve(prefab);})})},console});
(async()=>{
const canvas=new Node('Canvas');canvas.setPosition(new Vec3(375,667));canvas.setScale(new Vec3(1.2,1.2,1));
const screens=new Node('Screens');canvas.addChild(screens);
const feedback=new output.TouchPointEffect();feedback.node=canvas;let sounds=0;feedback.playClickSound=()=>sounds++;
feedback.onLoad();feedback.onEnable();
const event=(x,y)=>({getUILocation:()=>({x,y})});
// A click queued before prefab loading keeps its screen location across a resize.
feedback._onPress(event(420,730));screens.setScale(new Vec3(.55,.55,1));loaded(null,{});await new Promise(setImmediate);
const first=[...feedback._effects][0];assert.equal(first.world().x,420);assert.equal(first.world().y,730);
assert.equal(first.scale.x,.8,'Keep the prefab-authored scale');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
for(const scale of [1,.6,.85,1,.4]){
    screens.setScale(new Vec3(scale,scale,1));feedback.lateUpdate();
    near(first.world().sx,screens.world().sx*.8,'Existing effects follow resize');
    const touch=event(500,800),before=feedback._effects.size,soundBefore=sounds;
    feedback._onPress(touch);feedback._onPress(touch);
    assert.equal(feedback._effects.size,before+1,'UI capture and global input produce one effect');assert.equal(sounds,soundBefore+1);
    const effect=[...feedback._effects].at(-1);near(effect.world().x,500);near(effect.world().y,800);
    near(effect.world().sx/screens.world().sx,.8);near(effect.world().sy/screens.world().sy,.8);
    assert.equal(effect.scale.x,.8);assert.equal(effect.scale.y,.8);
}
// Completion returns live inactive instances; the next press restarts at the authored first frame.
const initial=[...feedback._effects],initialCreated=created;
for(const node of initial) node.visualAlpha=0;
feedback.callbacks.splice(0).forEach(callback=>callback());
assert.equal(feedback._effects.size,0);assert.equal(feedback._pool.length,initial.length);
assert.ok(initial.every(node=>node.isValid&&!node.active));
feedback._onPress(event(480,700));assert.equal(created,initialCreated,'Reuse a node without another instantiate');
const reused=[...feedback._effects][0],animation=reused.getComponent(Animation);
assert.equal(animation.plays,2);assert.equal(animation.state.time,0);assert.equal(reused.visualAlpha,1);
near(reused.world().x,480);near(reused.world().y,700);assert.equal(reused.scale.x,.8);
for(let i=0;i<200;i++) feedback._onPress(event(400+i,600));
assert.equal(feedback._effects.size,8);assert.equal(created,8,'Fast taps cannot grow the effect pool indefinitely');
assert.equal(feedback.callbacks.length,8);
const active=[...feedback._effects];feedback.onDisable();assert.equal(feedback._effects.size,0);assert.equal(feedback.callbacks.length,0);
assert.equal(feedback._pool.length,8);assert.ok(active.every(node=>node.isValid&&!node.active));
feedback.onEnable();feedback._onPress(event(430,720));assert.equal(created,8,'Disable/enable also reuses nodes');
feedback.onDisable();feedback.onDestroy();assert.equal(feedback._layer,null);assert.equal(feedback._pool.length,0);
assert.ok(active.every(node=>!node.isValid),'Destroy the entire pool with its owner');
// Slow downloads retain only a bounded number of recent click positions.
const delayed=new output.TouchPointEffect();delayed.node=new Node('Canvas');delayed.onLoad();
for(let i=0;i<100;i++) delayed._onPress(event(i,i));
assert.equal(delayed._pending.length,8);loaded(null,{});await new Promise(setImmediate);assert.equal(delayed._effects.size,8);
assert.equal([...delayed._effects][0].world().x,92);
delayed.onDisable();delayed.onDestroy();
const disposed=new output.TouchPointEffect();disposed.node=new Node('Canvas');disposed.onLoad();
disposed.onDestroy();disposed.isValid=false;const beforeLateLoad=created;loaded(null,{});await new Promise(setImmediate);assert.equal(created,beforeLateLoad);
console.log('PASS: click coordinates/resize/deduplication, bounded pool and pending clicks, reuse with first-frame animation reset, disable/enable and destruction.');

})().catch(error=>{console.error(error);process.exitCode=1;});
