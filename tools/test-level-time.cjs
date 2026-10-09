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
for(const [count,seconds] of [[0,120],[4,120],[5,135],[8,180],[10,210],[11,225],[15,285],[30,510]]) assert.equal(flow._timeFor(count),seconds);
flow._grades={timeTiers:[]};assert.equal(flow._timeFor(8),180);
console.log('PASS linear initial time and legacy-config fallback');
