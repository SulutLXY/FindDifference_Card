// Match Creator 3.8's loose spread transform; native ES2018 tests miss Map/Set iterator spreads.
const path = require('node:path');
const modules = path.dirname(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const babel = require(require.resolve('@babel/core', { paths: [modules] }));
const spread = require.resolve('@babel/plugin-transform-spread', { paths: [modules] });
module.exports = source => babel.transformSync(source, {
    babelrc: false, configFile: false, plugins: [[spread, { loose: true }]],
}).code;
