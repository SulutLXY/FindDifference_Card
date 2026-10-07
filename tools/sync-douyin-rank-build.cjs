// Disable the retired custom rank context without changing other build settings.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.resolve(root, process.argv[2] || 'build/douyin');
if (!target.startsWith(root + path.sep)) throw new Error('构建目录必须位于项目内');
const configFile = path.join(target, 'game.json');
if (!fs.existsSync(configFile)) throw new Error('请先用Cocos构建字节跳动小游戏');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
delete config.openDataContext;
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
console.log(`已停用 ${target} 的自定义排行榜开放域；原生排行榜主域脚本仍需由Cocos重新构建。`);
