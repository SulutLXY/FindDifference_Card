const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const source=fs.readFileSync('assets/scripts/ui/ResultModal.ts','utf8');
const tree=ts.createSourceFile('result.ts',source,ts.ScriptTarget.Latest,true);
const names=['_reviveTween','_reviveFade','_reviveNode','_reviveScale','_reviveOpacity','_startRevivePulse','_stopRevivePulse','onDisable','onDestroy','present'];
const body=tree.statements.find(ts.isClassDeclaration).members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
class Vec3 {constructor(x=1,y=1,z=1){Object.assign(this,{x,y,z});}clone(){return new Vec3(this.x,this.y,this.z);}}
class UIOpacity{} class Label{}
const running=[];
function tween(target) {return {target,stopped:false,to(){return this;},repeatForever(){return this;},start(){running.push(this);return this;},stop(){this.stopped=true;}};}
class UIScreen {open(){}onDisable(){}onDestroy(){}}
const Modal=vm.runInNewContext(ts.transpileModule(`class Test extends UIScreen {${body}};Test;`,{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{UIScreen,Vec3,UIOpacity,Label,tween,TITLE_COLOR_WIN:'win',UIColors:{red:'red'}});
const modal=new Modal();const opacity={opacity:200},reviveLabel={};
const revive={isValid:true,active:false,scale:new Vec3(2,2,1),getComponent:()=>opacity,getComponentInChildren:()=>reviveLabel,setScale(value){this.scale=value.clone();}};
const homeLabel={},primaryLabel={};
const nodes={BtnRevive:revive,BtnHome:{getComponentInChildren:()=>homeLabel},BtnPrimary:{getComponentInChildren:()=>primaryLabel},BtnShare:{}};
modal.flow={node:{parent:null}};modal.node={};modal.findChildDeep=()=>null;
modal.resolveNode=(_,name)=>nodes[name];modal.resolveLabel=()=>({});modal.setLabel=()=>{};
const failed={win:false,canRevive:true,elapsedSeconds:10,stars:0};
modal.present(failed);assert.equal(reviveLabel.string,'复活');assert.equal(homeLabel.string,'返回主页');assert.equal(running.length,2);assert.equal(revive.active,true);
assert.equal(nodes.BtnShare.active,false,'Failure must hide share');
revive.scale=new Vec3(2.12,2.12,1);opacity.opacity=144;
modal.onDisable();assert.ok(running.every(t=>t.stopped));assert.equal(revive.scale.x,2);assert.equal(opacity.opacity,200);
modal.present(failed);assert.equal(running.length,4,'Reopening gets one fresh scale/opacity pair');
modal.present({...failed,win:true,hasNext:true});assert.equal(revive.active,false);assert.equal(running.length,4);assert.ok(running.every(t=>t.stopped));
assert.equal(nodes.BtnShare.active,true,'Success must restore share');
modal.present({...failed,canRevive:false});assert.equal(running.length,4);
assert.equal(nodes.BtnShare.active,false,'Reused success modal must hide share on failure, including after revival');
modal.present({...failed,win:true,hasNext:false});assert.equal(nodes.BtnShare.active,true,'Final level success also allows sharing');
modal.present(failed);modal.onDestroy();assert.ok(running.every(t=>t.stopped));
const prefab=JSON.parse(fs.readFileSync('assets/PleyGame/prefabs/ResultModal.prefab','utf8'));
assert.ok(prefab.some(n=>n.__type__==='cc.Label'&&n._string==='复活'));
assert.ok(!prefab.some(n=>n._string==='看广告复活'||n._string==='返回选关'));
assert.equal(JSON.parse(fs.readFileSync('assets/resources/configs/levels.json','utf8')).maxLives,3);
console.log('PASS: three lives, revive/home text, whole-button scale/opacity pulse and cleanup across win, close and destroy.');
