const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const source=fs.readFileSync('assets/scripts/ui/EnergyDisplay.ts','utf8');
const tree=ts.createSourceFile('EnergyDisplay.ts',source,ts.ScriptTarget.Latest,true);
const names=['_prefab','_loading','_attaching','attach','_loadPrefab'];
const body=tree.statements.find(ts.isClassDeclaration).members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
let loads=0,instances=0,complete,refs=0;
class Host {
 constructor(){this.isValid=true;this.children=[];}
 getComponentInChildren(){return this.children[0]?.display??this.children[0]??null;}
}
const Display=vm.runInNewContext(ts.transpileModule(`class EnergyDisplay {${body}}; EnergyDisplay;`,{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{
 console:{warn(){}},Prefab:class{},getGameFlow:()=>({loadCommonPrefab(name){assert.equal(name,'EnergyDisplay');loads++;return new Promise((resolve,reject)=>{complete=(error,prefab)=>error?reject(error):resolve(prefab);});}}),
 instantiate(prefab){instances++;const display={};return {display,position:{x:-190,y:610},getComponent:()=>display,set parent(host){host.children.push(this);}}},
});
(async()=>{
 const a=new Host(),b=new Host(),gone=new Host();
 const first=Display.attach(a,false),duplicate=Display.attach(a,false),second=Display.attach(b),stale=Display.attach(gone);
 assert.equal(loads,1);assert.equal(first,duplicate);gone.isValid=false;
 const prefab={isValid:true,addRef(){refs++;return this;}};complete(null,prefab);
 await Promise.all([first,second,stale]);assert.equal(instances,2);assert.equal(refs,1);assert.equal(a.children[0].position.y,610);assert.equal(b.children[0].position.y,610);
 assert.equal(a.children[0].display._followHeader,false,'Fixed menu screens must opt out before activation');
 assert.equal(b.children[0].display._followHeader,true,'Gameplay/default header behavior remains available');
 await Display.attach(a);assert.equal(instances,2);assert.equal(a.children[0].position.x,-190,'Existing placement survives repeated attach');
 const authored=new Host();authored.children.push({position:{x:12,y:34},customStyle:true});await Display.attach(authored,false);
 assert.equal(instances,2);assert.equal(authored.children[0].position.x,12,'Editor-authored instance is reused');
 await Display.attach(new Host());assert.equal(loads,1);assert.equal(instances,3);
 Display._prefab=null;const retry=new Host();const failed=Display.attach(retry);complete(Error('failed'));await failed;
 assert.equal(retry.children.length,0);const retried=Display.attach(retry);complete(null,prefab);await retried;assert.equal(retry.children.length,1);
 const data=JSON.parse(fs.readFileSync('assets/PleyGame/Common/prefabs/EnergyDisplay.prefab','utf8'));
 function references(value){if(!value||typeof value!=='object')return;if('__id__' in value)assert.ok(data[value.__id__],`Missing reference ${value.__id__}`);for(const item of Object.values(value))references(item);}
 references(data);assert.equal(data[0].__type__,'cc.Prefab');assert.equal(data[1]._name,'EnergyDisplay');assert.equal(data[1]._active,true);
 const component=data.find(o=>o.energyLabel&&o.rewardButton);assert.ok(component);
 const raw=JSON.parse(fs.readFileSync('assets/scripts/ui/EnergyDisplay.ts.meta','utf8')).uuid.replaceAll('-','');
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let decoded=component.__type__.slice(0,5);
 for(let i=5;i<component.__type__.length;i+=2)decoded+=((alphabet.indexOf(component.__type__[i])<<6)|alphabet.indexOf(component.__type__[i+1])).toString(16).padStart(3,'0');
 assert.equal(decoded,raw,'Prefab component must resolve to EnergyDisplay.ts');
 for(const field of ['energyLabel','countdownLabel'])assert.equal(data[component[field].__id__].__type__,'cc.Label');
 for(const field of ['countdownRoot','rewardButton','videoIcon'])assert.equal(data[component[field].__id__].__type__,'cc.Node');
 assert.equal(data[component.videoIcon.__id__]._name,'icon_videoplay');
 assert.equal(data[1]._lpos.x,-190);assert.equal(data[1]._lpos.y,610);
 const energyButton=data[component.rewardButton.__id__];
 const energyUi=energyButton._components.map(r=>data[r.__id__]).find(c=>c.__type__==='cc.UITransform');
 const energyLeft=data[1]._lpos.x+energyButton._lpos.x-energyUi._anchorPoint.x*energyUi._contentSize.width;
 for(const page of ['CitySelectScreen','LevelSelectScreen']) {
  const graph=JSON.parse(fs.readFileSync(`assets/LobbySources/prefabs/${page}.prefab`,'utf8'));
  const back=graph.find(o=>o.__type__==='cc.Node'&&o._name==='BtnBack');
  const backUi=back._components.map(r=>graph[r.__id__]).find(c=>c.__type__==='cc.UITransform');
  const right=back._lpos.x+(1-backUi._anchorPoint.x)*backUi._contentSize.width;
  assert.ok(right<energyLeft,'Energy hit rectangle must not overlap the restored back button');
  assert.match(fs.readFileSync(`assets/scripts/ui/${page}.ts`,'utf8'),/EnergyDisplay\.attach\(this\.node, false\)/);
 }
 assert.doesNotMatch(source,/\.fontSize\s*=|\.color\s*=|setContentSize\(|new Node\(/,'Runtime must preserve prefab styling');
 console.log('PASS: shared prefab loading, concurrent attach deduplication, destroyed hosts, editor instance preservation, retry, serialized references and editable styling.');
})().catch(error=>{console.error(error);process.exitCode=1;});
