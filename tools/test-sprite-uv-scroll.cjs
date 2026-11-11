const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
class Vec2{constructor(x=0,y=0){Object.assign(this,{x,y});}}
class Vec4{constructor(x=0,y=0,z=0,w=0){this.set(x,y,z,w);}set(x,y,z,w){Object.assign(this,{x,y,z,w});return this;}}
class Color{constructor(r=255,g=255,b=255,a=255){Object.assign(this,{r,g,b,a});}}
class Mat4{
 constructor(){Object.assign(this,{m00:1,m01:0,m04:0,m05:1,m08:0,m09:0,m12:0,m13:0});}
 static invert(out,m){const d=m.m00*m.m05-m.m04*m.m01;Object.assign(out,{m00:m.m05/d,m04:-m.m04/d,m01:-m.m01/d,m05:m.m00/d,m08:0,m09:0,m12:(m.m04*m.m13-m.m05*m.m12)/d,m13:(m.m01*m.m12-m.m00*m.m13)/d});return out;}
}
class Component{}
class UITransform{constructor(){Object.assign(this,{width:200,height:100,anchorX:.5,anchorY:.5});}}
class Sprite{
 constructor(){this.isValid=true;this.type=0;}
 getMaterialInstance(){if(!this.instance){this.instance=new Material();this.instance.copy(this.customMaterial);}return this.instance;}
 getRenderMaterial(){return this.instance??this.customMaterial;}
 getSharedMaterial(){return this.customMaterial;}
 setSharedMaterial(value){this.instance?.destroy();this.instance=null;this.customMaterial=value;}
}
class Texture2D{constructor(name){this.name=name;}}
class Material{
 constructor(){this.props={};}copy(m){this.effectAsset=m.effectAsset;this.props={...m.props};}
 setProperty(k,v){this.props[k]=v instanceof Vec4?[v.x,v.y,v.z,v.w]:v;}
 getProperty(k){return this.props[k]??null;}destroy(){this.destroyed=true;}
}
const mod={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('assets/scripts/ui/SpriteUVScroll.ts','utf8'),{
 compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,experimentalDecorators:true},
}).outputText,{exports:mod,require:()=>({Vec2,Vec4,Color,Mat4,Material,Component,Sprite,Texture2D,UITransform,Enum:v=>v,warn(){},
 _decorator:{ccclass:()=>T=>T,property:()=>()=>{},requireComponent:()=>T=>T,executeInEditMode:T=>T}})});
const template=new Material();template.effectAsset={name:'SpriteUVScroll'};
function setup(){const c=new mod.SpriteUVScroll(),sprite=new Sprite(),ui=new UITransform();sprite.customMaterial=template;
 sprite.spriteFrame={uv:[.2,.3,.2,.7,.4,.3,.4,.7],texture:{name:'atlas-A'}};
 c.node={worldMatrix:new Mat4()};c.getComponent=T=>T===Sprite?sprite:ui;c.onEnable();return{c,sprite,ui};}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
let {c,sprite,ui}=setup();const other=setup(),aUV=[...sprite.spriteFrame.uv];
assert.notEqual(c._owned,other.c._owned);assert.notEqual(c._owned,template);assert.equal(c._owned.props.overlayEnabled,0);
const b=new Texture2D('overlay-B');c.overlayTexture=b;c.overlayColor=new Color(128,64,255,128);c.overlayOpacity=.35;c.update(0);
assert.equal(c._owned.props.overlayTexture,b);assert.notEqual(c._owned.props.overlayTexture,sprite.spriteFrame.texture);
assert.equal(c._owned.props.overlayEnabled,1);near(c._owned.props.overlayColor[0],128/255);near(c._owned.props.overlayColor[3],128/255);
near(c._owned.props.overlayOpacity,.35);assert.equal(other.c._owned.props.overlayEnabled,0);
c.speed=new Vec2(.15,-.25);c.offset=new Vec2(.1,0);c.update(2);
near(c._owned.props.scrollOffset[0],.4);near(c._owned.props.scrollOffset[1],.5);
assert.deepEqual(sprite.spriteFrame.uv,aUV,'A atlas coordinates never move');
assert.equal(c._owned.props.scrollOffset[2],1);assert.equal(other.c._owned.props.scrollOffset[0],0);assert.deepEqual(template.props,{});
c.playing=false;const paused=[...c._owned.props.scrollOffset];c.update(100);assert.deepEqual(c._owned.props.scrollOffset,paused);
c.playing=true;c.speed=new Vec2(1e6,-1e6);c.update(1e6);for(const n of c._owned.props.scrollOffset.slice(0,2))assert.ok(n>=0&&n<1);
c.speed=new Vec2(NaN,Infinity);c.tiling=new Vec2(0,-1);c.overlayOpacity=2;c.update(1);
assert.deepEqual(c._owned.props.scrollSpeed,[0,0,1,1]);assert.equal(c._owned.props.overlayOpacity,1);
c.overlayOpacity=-1;c.update(0);assert.equal(c._owned.props.overlayOpacity,0);
c.resetScroll();near(c._owned.props.scrollOffset[0],.1);
c.tiling=new Vec2(3,2);c.overlayMode=0;c.update(0);assert.equal(c._owned.props.overlayMode,0);assert.deepEqual(c._owned.props.scrollSpeed.slice(2),[3,2]);
c.overlayMode=1;c.clipToBaseAlpha=false;c.update(0);assert.equal(c._owned.props.overlayMode,1);assert.equal(c._owned.props.clipToBaseAlpha,0);
for(const [rotation,sx,sy,tx,ty]of [[0,1,1,0,0],[.7,2,.5,300,-40],[1.1,-1,3,-20,90]]){
 const cos=Math.cos(rotation),sin=Math.sin(rotation),m=new Mat4();Object.assign(m,{m00:cos*sx,m01:sin*sx,m04:-sin*sy,m05:cos*sy,m12:tx,m13:ty});
 c.node.worldMatrix=m;ui.width=300;ui.height=120;ui.anchorX=.2;ui.anchorY=.8;c.update(0);
 const x=c._owned.props.bWorldToLocalX,y=c._owned.props.bWorldToLocalY,bounds=c._owned.props.bLocalBounds;
 for(const [u,v]of [[0,0],[.5,.5],[1,1],[.3,.8]]){
  const lx=bounds[0]+u*bounds[2],ly=bounds[1]+v*bounds[3];
  const wx=m.m00*lx+m.m04*ly+tx,wy=m.m01*lx+m.m05*ly+ty;
  near((x[0]*wx+x[1]*wy+x[3]-bounds[0])/bounds[2],u);near((y[0]*wx+y[1]*wy+y[3]-bounds[1])/bounds[3],v);
 }
 const before=[...bounds];sprite.type=1;sprite.spriteFrame.uv=[.9,.9,.8,.9,.9,.5,.8,.5];c.update(0);
 assert.deepEqual(c._owned.props.bLocalBounds,before,'A mode and atlas frame do not change B mapping');
}
c.overlayTexture=null;c.update(0);assert.equal(c._owned.props.overlayEnabled,0);
const owned=c._owned;c.onDisable();assert.equal(sprite.customMaterial,template);assert.equal(owned.destroyed,true);assert.equal(c._owned,null);
template.props.scrollSpeed=new Vec4(1.45,1,1,1);template.props.overlayColor=new Color(255,255,255,57);
template.props.bLocalBounds=new Vec4(-.5,-.5,2,2);template.props.overlayEnabled=1;
const authored=setup();authored.ui.width=1000;authored.ui.height=2000;authored.c.update(1);
assert.deepEqual(authored.c._owned.props.bLocalBounds,[-500,-1000,1000,2000],'Real background size overrides stale 2x2 material bounds');
near(authored.c._owned.props.overlayColor[3],57/255);near(authored.c._owned.props.scrollOffset[0],.45);
assert.equal(authored.sprite.customMaterial,template,'Editor keeps the persistent asset reference, not an unsaved temporary material');
assert.equal(authored.c._owned.props.scrollOffset[3],1,'Coordinates are explicitly marked ready');
template.props.scrollSpeed=new Vec4(.3,.4,2,3);authored.c.update(0);assert.deepEqual(authored.c._owned.props.scrollSpeed,[.3,.4,2,3],'Material inspector changes update the preview');
authored.c.useMaterialSettings=false;authored.c.update(0);assert.deepEqual(authored.c._owned.props.scrollSpeed,[.15,0,1,1]);
authored.c.onDisable();delete template.props.scrollSpeed;delete template.props.overlayColor;delete template.props.bLocalBounds;delete template.props.overlayEnabled;
template.props.overlayTexture=b;const fromMaterial=setup();assert.equal(fromMaterial.c._owned.props.overlayTexture,b);assert.equal(fromMaterial.c._owned.props.overlayEnabled,1);
fromMaterial.c.onDisable();other.c.onDisable();delete template.props.overlayTexture;
const prefab=JSON.parse(fs.readFileSync('assets/PleyGame/prefabs/GameScreen.prefab','utf8'));
const bg=prefab.find(n=>n.__type__==='cc.Node'&&n._name==='GameScreenBG');
const uuid=JSON.parse(fs.readFileSync('assets/scripts/ui/SpriteUVScroll.ts.meta','utf8')).uuid.replace(/-/g,'');
// Script Class IDs use a 5-hex prefix (23 chars), unlike minimal asset UUIDs (22 chars).
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let type=uuid.slice(0,5);
for(let i=5;i<uuid.length;i+=3){const value=parseInt(uuid.slice(i,i+3),16);type+=alphabet[value>>6]+alphabet[value&63];}
const sync=bg._components.map(c=>prefab[c.__id__]).find(c=>c.__type__===type);
assert.ok(sync,'Actual material-bearing background has coordinate sync');assert.equal(sync.useMaterialSettings,true);
const badType=uuid.slice(0,2)+Buffer.from(uuid.slice(2),'hex').toString('base64');
assert.ok(!prefab.some(c=>c.__type__===badType),'No invalid minimal UUID remains as a script Class ID');
for(const target of ['editor','preview']){
 const dir=`temp/programming/packer-driver/targets/${target}`;
 if(fs.existsSync(`${dir}/import-map.json`)){
  const imports=JSON.parse(fs.readFileSync(`${dir}/import-map.json`)).imports;
  const entry=Object.entries(imports).find(([key])=>key.endsWith('/assets/scripts/ui/SpriteUVScroll.ts'));
  assert.ok(entry,`${target} registered the script module`);
  const compiled=fs.readFileSync(require('node:path').resolve(dir,entry[1]),'utf8');
  const registered=compiled.match(/_RF\.push\(\{\},\s*["']([^"']+)["'],\s*["']SpriteUVScroll["']/)?.[1];
  assert.equal(sync.__type__,registered,`${target} actual engine registration matches serialized Class ID`);
 }
}
assert.equal(bg._components.map(c=>prefab[c.__id__]).find(c=>c.__type__==='cc.Sprite')._type,1,'Preserve authored Sliced background');
console.log('PASS dual-image sticker: static A/independent B, both texture entries, tint/opacity, tile/fill, motion/pause, transform/anchor/atlas/mode independence and cleanup');
