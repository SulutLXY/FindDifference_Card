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
    getChildByName(name){return this.children.find(child=>child.name===name);}
    addChild(node){node.parent=this;this.children.push(node);}
    setScale(scale){this.scale=scale.clone();}
    setPosition(position){this.position=position.clone();}
    setSiblingIndex(){} on(){} off(){}
    destroy(){this.isValid=false;}
    world(){const p=this.parent?.world()??{x:0,y:0,sx:1,sy:1};return {x:p.x+this.position.x*p.sx,y:p.y+this.position.y*p.sy,sx:p.sx*this.scale.x,sy:p.sy*this.scale.y};}
}
let loaded;
const output={};
const cc={_decorator:{ccclass:()=>Type=>Type},Component:class {constructor(){this.isValid=this.enabledInHierarchy=true;this.callbacks=[];}scheduleOnce(callback){this.callbacks.push(callback);}unscheduleAllCallbacks(){this.callbacks=[];}},
    EventTouch:class{},input:{on(){},off(){}},Input:{EventType:{TOUCH_START:'touch'}},Node,Prefab:class{},UITransform,Vec3,
    resources:{load(path,Type,callback){loaded=callback;}},instantiate(){const node=new Node('TouchPoint');node.setScale(new Vec3(.8,.8,1));return node;}};
const source=fs.readFileSync('assets/scripts/ui/TouchPointEffect.ts','utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2018,module:ts.ModuleKind.CommonJS,experimentalDecorators:true}}).outputText,{exports:output,require:()=>cc,console});
const canvas=new Node('Canvas');canvas.setPosition(new Vec3(375,667));canvas.setScale(new Vec3(1.2,1.2,1));
const screens=new Node('Screens');canvas.addChild(screens);
const feedback=new output.TouchPointEffect();feedback.node=canvas;let sounds=0;feedback.playClickSound=()=>sounds++;
feedback.onLoad();feedback.onEnable();
const event=(x,y)=>({getUILocation:()=>({x,y})});
// A click queued before prefab loading keeps its screen location across a resize.
feedback._onPress(event(420,730));screens.setScale(new Vec3(.55,.55,1));loaded(null,{});
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
const active=[...feedback._effects];feedback.onDisable();assert.equal(feedback._effects.size,0);assert.ok(active.every(node=>!node.isValid));
feedback.onDestroy();assert.equal(feedback._layer,null);
console.log('PASS: click effect matches interface scale, keeps prefab animation scale and pointer position, handles resize/async loading, deduplicates input and cleans instances.');
