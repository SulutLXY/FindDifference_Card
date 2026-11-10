const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ts=require('D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function methods(file,names,extra={}){
 const text=fs.readFileSync(file,'utf8'), tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 const cls=tree.statements.find(ts.isClassDeclaration);
 const body=cls.members.filter(m=>names.includes(m.name?.getText(tree))).map(m=>m.getText(tree)).join('\n');
 return vm.runInNewContext(ts.transpileModule('class Test {'+body+'}\nTest;',{compilerOptions:{target:ts.ScriptTarget.ES2018}}).outputText,{console:{error(){}},...extra});
}

const Flow=methods('assets/scripts/GameFlow.ts',['_timeFor']);const flow=new Flow();
flow._grades=JSON.parse(fs.readFileSync('assets/resources/configs/levels.json','utf8'));
for(const [count,seconds] of [[0,150],[4,150],[9,150],[10,150],[11,165],[15,225],[17,255],[19,285],[20,300],[21,300],[30,300],[100,300]]) assert.equal(flow._timeFor(count),seconds);
flow._grades={timeTiers:[]};assert.equal(flow._timeFor(10),150);assert.equal(flow._timeFor(11),165);assert.equal(flow._timeFor(30),300);
flow._grades={baseTimeSeconds:150,baseDifferenceCount:10,secondsPerExtraDifference:15};assert.equal(flow._timeFor(30),300,'Missing cap defaults to five minutes');
flow._grades={baseTimeSeconds:150,baseDifferenceCount:10,secondsPerExtraDifference:15,maxTimeSeconds:240};assert.equal(flow._timeFor(30),240,'Cap remains configurable');
console.log('PASS initial time: 150-second base, ten-difference threshold, fifteen-second increments, five-minute cap and config fallback');
