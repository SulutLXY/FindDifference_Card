const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, {compilerOptions:{target:ts.ScriptTarget.ES2018,module:ts.ModuleKind.CommonJS}}).outputText;
const viewport = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/core/ViewportLayout.ts','utf8')), {exports:viewport});
const {gameViewport,fitDesignFrame} = viewport;
for (const [w,h,tall] of [[750,900,false],[450,800,false],[750,1334,false],[450,850,false],
    [450,900,true],[393,852,true],[450,1000,true],[900,450,false],[0,0,false]]) {
    const value=gameViewport(w,h);
    assert.equal(value.prefab,tall?'prefabs/GameScreen':'prefabs/GameScreen_9x16');
    assert.ok(value.height >= 1334);
    const graph=JSON.parse(fs.readFileSync('assets/PleyGame/'+value.prefab+'.prefab'));
    const ui=graph[graph[0].data.__id__]._components.map(c=>graph[c.__id__]).find(c=>c.__type__==='cc.UITransform');
    const fit=fitDesignFrame(value.width,value.height,ui._contentSize.width,ui._contentSize.height);
    assert.ok(ui._contentSize.width*fit.scale<=value.width+0.001);
    assert.ok(ui._contentSize.height*fit.scale<=value.height+0.001);
}
function methods(file,names,globals={}) {
    const tree=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const body=tree.statements.find(ts.isClassDeclaration).members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Test {${body}};Test;`),globals);
}
class UITransform {} class Widget {} class Layout {} class ScrollView {}
let visible={width:750,height:1334},window={width:450,height:1000},calls=[];
const Flow=methods('assets/scripts/GameFlow.ts',['_refreshViewport','_fitGameScreen'],{
    screen:{get windowSize(){return window;}}, gameViewport,fitDesignFrame,UITransform,
    ResolutionPolicy:{SHOW_ALL:2},view:{getVisibleSize:()=>visible,setDesignResolutionSize(w,h,policy){calls.push(policy);visible={width:w,height:h};}},
});
const f=new Flow(); let scale;
const gameNode={isValid:true,getComponent:()=>({width:750,height:1650}),setScale(x,y){assert.equal(x,y);scale=x;}};
f.game={node:gameNode};f._remainingTime=123;f._foundIds=new Set(['diff-1']);
f.resultModal={node:{setScale(){throw Error('Popup must stay independent');}}};
f._refreshViewport();assert.equal(visible.height,750*1000/450);assert.equal(scale,1);
window={width:450,height:700};f._refreshViewport();assert.equal(visible.height,1334);assert.ok(scale<1);
assert.equal(f.game.node,gameNode);assert.equal(f._remainingTime,123);assert.equal(f._foundIds.size,1);
assert.deepEqual(calls,[2,2]);

const Energy=methods('assets/scripts/ui/EnergyDisplay.ts',['lateUpdate'],{UITransform});
const e=new Energy();const header={activeInHierarchy:true,worldPosition:{y:810}};
const parentUI={height:1620,anchorY:0.5,convertToNodeSpaceAR:p=>p};
e.node={parent:{getComponent:()=>parentUI},position:{x:-190,y:610,z:0},setPosition(x,y,z){this.position={x,y,z};}};
e._followHeader=true;
e.findChildDeep=()=>header;e.lateUpdate();assert.deepEqual(e.node.position,{x:-190,y:810,z:0});
header.worldPosition.y=610;e.lateUpdate();assert.equal(e.node.position.y,610);
e.findChildDeep=()=>null;e.lateUpdate();assert.equal(e.node.position.y,753);
e.node.position={x:-190,y:610,z:0};e._followHeader=false;
e.findChildDeep=()=>header;
for(const height of [1334,1500,1620,1800]) {parentUI.height=height;header.worldPosition.y=height/2-57;e.lateUpdate();assert.deepEqual(e.node.position,{x:-190,y:610,z:0});}

const List=methods('assets/scripts/ui/CitySelectScreen.ts',['_layoutListTop','_scrollToTop','_clearCards'],{UITransform,Widget,Layout,ScrollView});
const s=new List(),events=[],queue=[];
const rootUI={width:697,height:1237,anchorX:0.5,anchorY:0.5};
const contentUI={width:0},content={isValid:true,position:{z:0},getComponent:Type=>Type===UITransform?contentUI:{updateLayout(){events.push('layout');}},setPosition(x,y){this.position={x,y,z:0};}};
const scroll={stopAutoScroll(){events.push('stop');},scrollToTop(duration){assert.equal(duration,0);events.push('top');}};
const root={getComponent:Type=>Type===UITransform?rootUI:Type===Widget?{updateAlignment(){events.push('widget');}}:scroll};
s.node={activeInHierarchy:true,getComponent:()=>({updateAlignment(){events.push('page-widget');}})};
s._content=content;s.resolveNode=()=>root;s.unschedule=()=>{};s.scheduleOnce=fn=>queue.push(fn);
s._scrollToTop();assert.deepEqual(events,['page-widget','widget','layout','stop','top']);
assert.equal(content.position.y,1237/2);assert.equal(contentUI.width,697);
rootUI.height=951;queue.pop().call(s);assert.equal(content.position.y,951/2);
let released=0;s.flow={releasePageSpriteFrames(){released++;}};
const old={active:true,destroy(){assert.equal(this.active,false);}};s._cards=[old];s._clearCards();assert.equal(released,1);assert.equal(s._cards.length,0);
console.log('PASS: preview-window ratios, 9:16 minimum frame, two prefab breakpoints, uniform fit, resize without progress reset, popup independence, fixed-menu/header-gameplay energy and post-layout list top');
