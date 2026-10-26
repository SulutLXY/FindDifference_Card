const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const source=fs.readFileSync('assets/scripts/ui/EnergyDisplay.ts','utf8');
const tree=ts.createSourceFile('EnergyDisplay.ts',source,ts.ScriptTarget.Latest,true);
const names=['_prefab','_loading','_attaching','attach','_loadPrefab'];
const body=tree.statements.find(ts.isClassDeclaration).members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
let loads=0,instances=0,complete,refs=0;
class Host {
 constructor(){this.isValid=true;this.children=[];}
 getComponentInChildren(){return this.children.length?{}:null;}
}
const Display=vm.runInNewContext(ts.transpileModule(`class EnergyDisplay {${body}}; EnergyDisplay;`,{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{
 console:{warn(){}},Prefab:class{},resources:{load(path,type,callback){assert.equal(path,'prefabs/EnergyDisplay');loads++;complete=callback;}},
 instantiate(prefab){instances++;return {position:{x:-200,y:600},set parent(host){host.children.push(this);}}},
});
(async()=>{
 const a=new Host(),b=new Host(),gone=new Host();
 const first=Display.attach(a),duplicate=Display.attach(a),second=Display.attach(b),stale=Display.attach(gone);
 assert.equal(loads,1);assert.equal(first,duplicate);gone.isValid=false;
 const prefab={isValid:true,addRef(){refs++;return this;}};complete(null,prefab);
 await Promise.all([first,second,stale]);assert.equal(instances,2);assert.equal(refs,1);assert.equal(a.children[0].position.y,600);assert.equal(b.children[0].position.y,600);
 await Display.attach(a);assert.equal(instances,2);assert.equal(a.children[0].position.x,-200,'Existing placement survives repeated attach');
 const authored=new Host();authored.children.push({position:{x:12,y:34},customStyle:true});await Display.attach(authored);
 assert.equal(instances,2);assert.equal(authored.children[0].position.x,12,'Editor-authored instance is reused');
 await Display.attach(new Host());assert.equal(loads,1);assert.equal(instances,3);
 Display._prefab=null;const retry=new Host();const failed=Display.attach(retry);complete(Error('failed'));await failed;
 assert.equal(retry.children.length,0);const retried=Display.attach(retry);complete(null,prefab);await retried;assert.equal(retry.children.length,1);
 const data=JSON.parse(fs.readFileSync('assets/resources/prefabs/EnergyDisplay.prefab','utf8'));
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
 assert.equal(data[1]._lpos.x,-200);assert.equal(data[1]._lpos.y,600);
 assert.doesNotMatch(source,/\.fontSize\s*=|\.color\s*=|setContentSize\(|new Node\(/,'Runtime must preserve prefab styling');
 console.log('PASS: shared prefab loading, concurrent attach deduplication, destroyed hosts, editor instance preservation, retry, serialized references and editable styling.');
})().catch(error=>{console.error(error);process.exitCode=1;});
