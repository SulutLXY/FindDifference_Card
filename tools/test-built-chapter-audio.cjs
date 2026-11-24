const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const walk = root => fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? walk(path.join(root, e.name)) : [path.join(root, e.name)]) : [];
const tick = () => new Promise(setImmediate);
async function audit(buildDirectory) {
    const build = path.resolve(buildDirectory), names = new Set(['_chapterSuccessClipRefs', '_successClipCandidates',
        '_nextSuccessClipRef', '_playSuccessSound', '_loadComboClip']);
    const methods = new Map(), aliases = new Set();let script;
    for (const file of walk(build).filter(file => file.endsWith('.js'))) {
        const source = fs.readFileSync(file, 'utf8');if (!source.includes('_chapterSuccessClipRefs')) continue;
        const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        const visit = node => {
            if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left)
                && names.has(node.left.name.text) && ts.isFunctionExpression(node.right)) {
                methods.set(node.left.name.text, node.right.getText(tree));script = file;
                const imports = n => {
                    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
                        && n.expression.name.text === 'load' && n.arguments.length >= 3 && ts.isIdentifier(n.arguments[1])) {
                        aliases.add(n.arguments[1].text);
                    }
                    ts.forEachChild(n, imports);
                };
                imports(node.right);
            }
            ts.forEachChild(node, visit);
        };
        visit(tree);
    }
    assert.equal(methods.size, names.size, 'Expected all five real release audio methods');
    const settingsFiles = fs.readdirSync(path.join(build, 'src')).filter(f => /^settings(?:\.[^.]+)?\.json$/.test(f));
    assert.equal(settingsFiles.length, 1);const settings = read(path.join(build, 'src', settingsFiles[0]));
    class AudioClip { constructor(name) { this.name = name;this.refs=0; } addRef(){this.refs++;} decRef(){this.refs--;} }
    const context = { console, ...Object.fromEntries([...aliases].map(name => [name, AudioClip])) };
    const functions = Object.fromEntries([...methods].map(([name, source]) => [name, vm.runInNewContext(`(${source})`, context)]));
    const result = [];
    for (const chapter of ['qing-hua-ci', 'meng-chong-san-guo']) {
        const relative = `${chapter}/config.${settings.assets.bundleVers[chapter]}.json`;
        const configFile = [path.join(build, 'remote', relative), path.join(path.dirname(build), 'remote', relative)]
            .find(fs.existsSync);assert.ok(configFile, `Missing matching ${chapter} bundle config`);
        const config = read(configFile), paths = Object.values(config.paths)
            .filter(value => config.types[value[1]] === 'cc.AudioClip' && /^Combo _F_type\/.+_0[1-5]$/.test(value[0]))
            .map(value => value[0]).sort();
        assert.equal(paths.length, chapter === 'qing-hua-ci' ? 13 : 11);
        const variants = new Map(), stages = new Map();
        for (const value of paths) {
            const tier = Number(value.slice(-1));if (!variants.has(tier)) variants.set(tier, []);
            variants.get(tier).push(value);if (!stages.has(tier)) stages.set(tier, value);
        }
        const requests = [], played = [];
        const f = { ...functions, isValid: true, save: {data:{soundEnabled:true}}, _comboSoundRequest:0,
            _comboClips:new Map(), _chapterComboClips:new Set(), _successSoundBags:new Map(), _lastSuccessClipKey:null,
            _chapterComboGroup:{name:'actual-build',chapterBundle:chapter,stages,variants},
            _loadGameBundle:()=>assert.fail('Dedicated release playback must not load generic sounds'),
            _discoverComboGroups:()=>assert.fail('Dedicated release playback must not discover generic groups'),
            _contentBundles:{use:async(name,action)=>{
                assert.equal(name,chapter);return action({load(request,Type,done){
                    assert.ok(paths.includes(request),`Nonexistent built audio ${request}`);requests.push(request);
                    done(null,new AudioClip(chapter+':'+request));
                }});
            }},
        };
        f._comboSource={isValid:true,stop(){},clip:null,play(){played.push(this.clip.name);}};
        for(let tier=0;tier<=5;tier++) {
            const candidates=f._successClipCandidates(tier);
            assert.equal(candidates.length,variants.get(Math.max(1,tier)).length,`${chapter} release tier ${tier} must not become empty`);
            assert.ok(candidates.every(ref=>ref.chapterBundle===chapter));
            const start=played.length;
            for(let count=0;count<candidates.length;count++){f._playSuccessSound(tier);await tick();}
            assert.equal(played.length-start,candidates.length,`Actual release ${chapter} tier ${tier} must reach AudioSource.play`);
        }
        assert.equal(new Set(requests).size,paths.length,'Every actual dedicated variant must load from the built manifest');
        result.push({chapter,variants:paths.length,played:played.length});
    }
    return {build:path.relative(process.cwd(),build).replace(/\\/g,'/'),script:path.relative(process.cwd(),script).replace(/\\/g,'/'),chapters:result};
}
if(require.main===module)audit(process.argv[2]||'build/douying').then(result=>console.log('PASS release chapter audio:',JSON.stringify(result)))
    .catch(error=>{console.error(error);process.exitCode=1;});
module.exports={audit};
