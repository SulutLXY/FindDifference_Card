// Execute selected methods from the actual Cocos release script, with its own Babel helpers.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require(process.env.TYPESCRIPT_PATH||'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
module.exports=function builtMethods(script,moduleName,imports={}) {
    const registry=new Map();
    const host={System:{register(...args) {
        if(Array.isArray(args[0])) args[1](()=>{}).execute(); // Outer register only registers inner modules.
        else registry.set(args[0],{deps:args[1],declare:args[2]});
    }}};
    const build=path.resolve(script,'../../..');
    for(const file of fs.readdirSync(path.join(build,'src/chunks')).filter(f=>f.endsWith('.js'))) {
        vm.runInNewContext(fs.readFileSync(path.join(build,'src/chunks',file),'utf8'),host);
    }
    vm.runInNewContext(fs.readFileSync(script,'utf8'),host);
    const helpersModule=registry.get('chunks:///_virtual/rollupPluginModLoBabelHelpers.js');
    if(!helpersModule) throw Error('Missing actual release Babel helper module');
    const helpers={};
    const definition=helpersModule.declare((key,value)=>{
        if(typeof key==='string') helpers[key]=value;else Object.assign(helpers,key);return value;
    });
    if(definition.setters?.length) throw Error('Unexpected helper dependencies');
    definition.execute();
    const module=registry.get(`chunks:///_virtual/${moduleName}.ts`);
    if(!module)throw Error('Missing built module '+moduleName);
    const source=module.declare.toString(),context={console,...imports};
    for(const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\.(\w+)/g)) {
        if(match[2] in helpers)context[match[1]]=helpers[match[2]];
        if(match[2] in imports)context[match[1]]=imports[match[2]];
    }
    const tree=ts.createSourceFile('release.js','('+source+')',ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const methods=new Map();
    const visit=node=>{
        if(ts.isBinaryExpression(node)&&ts.isPropertyAccessExpression(node.left)&&ts.isFunctionExpression(node.right)) {
            methods.set(node.left.name.text,node.right.getText(tree));
        }
        ts.forEachChild(node,visit);
    };
    visit(tree);
    return (Type,names)=>{
        for(const name of names) {
            if(!methods.has(name))throw Error(`Missing actual release method ${moduleName}.${name}`);
            Type.prototype[name]=vm.runInNewContext('('+methods.get(name)+')',context);
        }
    };
};
