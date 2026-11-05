const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2018,module:ts.ModuleKind.CommonJS,experimentalDecorators:true}}).outputText;
const project=JSON.parse(fs.readFileSync('settings/v2/packages/project.json'));assert.equal(project.general.designResolution.fitWidth??true,true);assert.equal(project.general.designResolution.fitHeight,true);
// Reproduce the size restoration using Cocos 3.8.8's actual Widget setter,
// rather than a plain-property mock that hides the original regression.
const enginePath=process.env.COCOS_WIDGET_SOURCE||'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/cocos/ui/widget.ts';
const source=fs.readFileSync(enginePath,'utf8'),tree=ts.createSourceFile(enginePath,source,ts.ScriptTarget.Latest,true);
const widget=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='Widget');
const setter=widget.members.find(n=>n.name?.getText(tree)==='_setAlign').getText(tree);
const Widget=vm.runInNewContext(compile(`class TestWidget {
 constructor(){this._alignFlags=45;this._originalWidth=this._originalHeight=100;this.ui={width:750,height:1334};this.node={_getUITransformComp:()=>this.ui};}
 get isStretchWidth(){return (this._alignFlags&40)===40;}
 get isStretchHeight(){return (this._alignFlags&5)===5;}
 ${setter}
};TestWidget;`),{EDITOR:false,AlignFlags:{LEFT:8,RIGHT:32,TOP:1,BOT:4},LEFT_RIGHT:40});
const legacy=new Widget();legacy._setAlign(1,false);legacy._setAlign(8,false);assert.equal(legacy.ui.width,100);assert.equal(legacy.ui.height,100);
const out={};vm.runInNewContext(compile(fs.readFileSync('assets/scripts/ui/ResponsiveLayout.ts','utf8')),{exports:out,require:name=>({_decorator:{ccclass:()=>Type=>Type},Component:class{}})});
const untouched=new Widget(),layout=new out.ResponsiveLayout();layout.node={getComponent:()=>untouched,children:[],scale:{x:1,y:1,z:1}};
const before=JSON.stringify(untouched);for(let i=0;i<10;i++)layout.refresh();assert.equal(JSON.stringify(untouched),before);
const flow=fs.readFileSync('assets/scripts/GameFlow.ts','utf8');assert.ok(!flow.includes('addComponent(ResponsiveLayout)'));assert.ok(!flow.includes('setDesignResolutionSize'));
// Current art is editable; test current snapshots, not frozen migration coordinates.
for(const file of ['assets/LobbySources/prefabs/CitySelectScreen.prefab','assets/LobbySources/prefabs/LevelSelectScreen.prefab','assets/LobbySources/prefabs/LobbyScreen.prefab','assets/LobbySources/prefabs/DailySignInModal.prefab']){
 const graph=JSON.parse(fs.readFileSync(file));layout.node=graph;const snapshot=JSON.stringify(graph);layout.refresh();assert.equal(JSON.stringify(graph),snapshot);
}
console.log('PASS: real Cocos stretch-cancel regression reproduced; custom runtime layout is inert, Creator framing preserved, editable pages and popup transforms untouched.');
