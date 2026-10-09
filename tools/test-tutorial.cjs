const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ts=require('D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function methods(file,names,extra={}){
 const text=fs.readFileSync(file,'utf8'), tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 const cls=tree.statements.find(ts.isClassDeclaration);
 const body=cls.members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
 return vm.runInNewContext(ts.transpileModule('class Test {'+body+'}\nTest;',{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{console:{error(){}},...extra});
}

class Vec3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} }
const Tips=methods('assets/scripts/ui/GameTips.ts',['_tap','dismiss'],{Vec3,UITransform:class{}});
for(const [x,y,want] of [[0,0,true],[200,200,false],[400,400,null]]){
 const t=new Tips();let result=null;t.node={active:true,getComponent:()=>({convertToNodeSpaceAR:p=>p})};t._center={x:0,y:0};t._screenRadius=50;t._skip={position:{x:200,y:200}};t._done=hit=>result=hit;
 const e={getUILocation:()=>({x,y})};t._tap(e);assert.equal(result,want);assert.equal(e.propagationStopped,true);assert.equal(t.node.active,want===null);
}
const Save=methods('assets/scripts/services/SaveService.ts',['completeTutorial']);const s=new Save();s._data={};let saves=0;s._persist=()=>saves++;s.completeTutorial();assert.equal(s._data.tutorialCompleted,true);assert.equal(saves,1);
console.log('PASS tutorial: focus hit, skip, outside input blocked, completion persisted');
const Flow=methods('assets/scripts/GameFlow.ts',['_showFirstLevelTutorial'],{PREVIEW:false,GameTips:class{}});
function tutorialRun(skipAt=-1){
 const f=new Flow();const level={key:'city/01',differences:[{id:'first'}]};f.isValid=true;f._currentLevel=level;f._cities=[{key:'city',levels:['01']}];
 let complete=0, callback, actions=[];const messages=[];
 const tips={present(n,l,r,done,text){callback=done;messages.push(text)},dismiss(){}};
 f.node={parent:{getChildByPath:()=>({getComponent:()=>tips})}};
 const target={node:{},local:{},radius:30};f.game={node:{activeInHierarchy:true},tutorialTarget:()=>target,tutorialControl:()=>target,tutorialZoom:()=>actions.push('zoom'),tutorialResetZoom:()=>actions.push('reset')};
 f.save={data:{},totalScore:0,completeTutorial(){complete++}};
 f.onDifferenceFound=()=>actions.push('found');f.useHint=done=>{actions.push('hint');done?.();};f.addTime=n=>actions.push('time:'+n);
 f._showFirstLevelTutorial(level);assert.equal(f._isPaused,true);assert.equal(complete,0);
 for(let i=0;i<7;i++){assert.equal(complete,0);callback(i!==skipAt);if(i===skipAt)break;}
 assert.equal(complete,1);assert.equal(!!f._isPaused,false);
 if(skipAt<0){assert.equal(messages.length,7);assert.deepEqual(actions,['found','zoom','reset','hint','time:30','reset']);}
 else {assert.equal(actions.includes('hint'),false);assert.equal(actions.includes('time:30'),false);}
}
tutorialRun();tutorialRun(3);
console.log('PASS seven-step tutorial progression, pause, actions, free assistance and mid-flow skip');
const HintFlow=methods('assets/scripts/GameFlow.ts',['useHint'],{GameTips:class{}});
for(const hit of [true,false]){
 const f=new HintFlow();const difference={id:'a'};f._currentLevel={differences:[difference]};f._foundIds=new Set();f.isValid=true;
 let callback,found=0,done=0;const tips={present(n,l,r,cb){callback=cb}};
 f.node={parent:{getChildByPath:()=>({getComponent:()=>tips})}};
 f.game={node:{activeInHierarchy:true},tutorialResetZoom(){},tutorialTarget:()=>({node:{},local:{},radius:30}),refreshHud(){}};
 f.onDifferenceFound=()=>found++;f.useHint(()=>done++);
 assert.equal(found,0);assert.equal(f._isPaused,true);assert.equal(done,0);
 callback(hit);assert.equal(found,hit?1:0);assert.equal(!!f._isPaused,false);assert.equal(done,1);
}
console.log('PASS hints reveal without completion, click confirms, close preserves progress, pause/resume');
