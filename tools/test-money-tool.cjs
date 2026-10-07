const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('D:/Cocos/cocoseditors/Creator/3.8.8/resources/resources/3d/engine/node_modules/typescript');
class Node {
 constructor(name){this.name=name;this.children=[];this.parts=new Map();this.events={};this.active=true;this.isValid=true;}
 add(child){child.parent=this;this.children.push(child);return child;}
 getChildByName(name){return this.children.find(c=>c.name===name)||null;}
 getComponent(type){return this.parts.get(type)||null;}
 addComponent(type){const c=new type();c.node=this;this.parts.set(type,c);return c;}
 get activeInHierarchy(){return this.active&&(!this.parent||this.parent.activeInHierarchy);}
 on(event,callback,owner){this.events[event]=()=>callback.call(owner);}
 off(event){delete this.events[event];}
 setSiblingIndex(){}
}
class UIScreen {
 findChildDeep(root,name){for(const c of root.children){if(c.name===name)return c;const n=this.findChildDeep(c,name);if(n)return n;}return null;}
 resolveNode(bound,name){return bound||this.findChildDeep(this.node,name);}
 resolveLabel(){return null;}setLabel(){}open(){this.node.active=true;}
}
class Gift{openGift(owner){this.owner=owner;}closeGift(){this.closed=true;}}
const decorator=()=>()=>{};
const cc={_decorator:{ccclass:decorator,property:decorator},Input:{EventType:{TOUCH_END:'click'}},Node,Color:class{},Label:class{},Toggle:class{}};
function load(file,deps){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2018,experimentalDecorators:true}}).outputText,{exports,require:n=>deps[n]||{},globalThis:{},console});return exports;}
const {LobbyEntries}=load('assets/scripts/ui/LobbyEntries.ts',{cc,'./UIScreen':{UIScreen},'./SidebarGift':{SidebarGift:Gift}});
const canvas=new Node('Canvas'),lobby=canvas.add(new Node('Lobby')),group=lobby.add(new Node('Gameflow')),homeGift=group.add(new Node('Gameflow'));
for(const n of ['Subscription','AddDesktop','Shar','LiveStreamingCompanion'])lobby.add(new Node(n));
const tools=[canvas.add(new Node('ResultModal')).add(new Node('moneyTool')),canvas.add(new Node('Settings')).add(new Node('moneyTool'))];
for(const tool of tools)for(const n of ['Gameflow','AddDesktop','Subscription'])tool.add(new Node(n));
const entries=new LobbyEntries();entries.node=canvas;entries.flow={lobby:{node:lobby},platform:{prepareFeedLogin(){}}};entries.start();
let desktop=0,subscribe=0;entries._openDesktop=()=>desktop++;entries._openSubscription=()=>subscribe++;
lobby.active=false;
for(const tool of tools){tool.getChildByName('Gameflow').events.click();assert.equal(homeGift.getComponent(Gift).owner,tool);tool.getChildByName('AddDesktop').events.click();tool.getChildByName('Subscription').events.click();}
assert.equal(desktop,2);assert.equal(subscribe,2);
let closed=0;entries._close=()=>closed++;entries._closeSubscription=()=>closed++;tools[1].active=false;entries.update();assert.equal(closed,2);assert.equal(homeGift.getComponent(Gift).closed,true);
const {ResultModal}=load('assets/scripts/ui/ResultModal.ts',{cc,'./UIScreen':{UIScreen,UIColors:{red:{}}}});
const result=new ResultModal();result.node=new Node('ResultModal');const resultShare=result.node.add(new Node('BtnShare'));resultShare.active=false;const resultTool=result.node.add(new Node('moneyTool'));result.present({win:false,stars:0,elapsedSeconds:1,canRevive:true});assert.equal(resultTool.active,true);assert.equal(resultShare.active,true);result.present({win:true,stars:1,elapsedSeconds:1});assert.equal(resultTool.active,true);assert.equal(resultShare.active,true);
const {SettingsModal}=load('assets/scripts/ui/SettingsModal.ts',{cc,'./UIScreen':{UIScreen}});
const settings=new SettingsModal();settings.node=canvas.add(new Node('SettingsModal'));const settingsTool=settings.node.add(new Node('moneyTool'));settings.flow={save:{data:{}}};settings.present(true);assert.equal(settingsTool.active,true);settings.present(false);assert.equal(settingsTool.active,false);
console.log('PASS: both moneyTool groups bind shared actions while lobby inactive; caller-close cleanup; failure/success and in-game/home visibility.');
