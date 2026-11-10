const fs = require('node:fs');
const path = require('node:path');

const DIRECTORY_URL = 'https://hsy.rewanyouxi.com/games/mishi/ndzdk02/HotNumber/';
const SECONDS_PER_LEVEL = 45;
const iso = value => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));

function beijingTime(date = new Date()) {
    return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19) + '+08:00';
}

function buildConfig(input = {}, generatedAt = beijingTime()) {
    if (!iso(generatedAt)) throw Error('生成时间必须包含时区');
    const kind = input.kind ?? 'period';
    if (kind !== 'period' && kind !== 'baseline') throw Error('记录类型仅支持period或baseline');
    const baseline = kind === 'baseline';
    const fields = baseline ? ['playerCount', 'averagePlayTimeSeconds'] : ['startAt', 'endAt', 'playerCount', 'averagePlayTimeSeconds'];
    const draft = ['kind', 'startAt', 'endAt', 'playerCount', 'averagePlayTimeSeconds'].every(key => input[key] === undefined);
    if (!draft) {
        if (fields.some(key => input[key] === undefined)) throw Error(baseline ? '预设数据必须提供玩家人数和人均游玩时长' : '必须同时提供统计起止时间、玩家人数和人均游玩时长');
        if (baseline && (input.startAt !== undefined || input.endAt !== undefined)) throw Error('上线前预设不填写真实统计区间');
        if (!baseline && (!iso(input.startAt) || !iso(input.endAt) || Date.parse(input.endAt) <= Date.parse(input.startAt)))
            throw Error('统计时间须为包含时区的ISO时间，结束时间必须晚于开始时间');
        if (!Number.isSafeInteger(input.playerCount) || input.playerCount < 0) throw Error('玩家人数须为非负整数');
        if (!Number.isFinite(input.averagePlayTimeSeconds) || input.averagePlayTimeSeconds < 0)
            throw Error('人均游玩时长须为非负秒数');
        if (!Number.isSafeInteger(input.playerCount * Math.ceil(input.averagePlayTimeSeconds / SECONDS_PER_LEVEL)))
            throw Error('估算总关卡游玩数超出安全整数范围');
    }
    const levelsPerPlayer = draft ? null : Math.ceil(input.averagePlayTimeSeconds / SECONDS_PER_LEVEL);
    return {
        schemaVersion: 1,
        type: 'hot-number-statistics',
        recordKind: kind,
        ...(baseline ? { baselineKey: 'prelaunch' } : {}),
        status: draft ? 'draft' : 'ready',
        generatedAt,
        timezone: 'Asia/Shanghai',
        source: baseline ? 'manual-preset' : 'douyin-developer-platform',
        statistics: {
            startAt: draft || baseline ? null : input.startAt,
            endAt: draft || baseline ? null : input.endAt,
            durationSeconds: draft || baseline ? null : (Date.parse(input.endAt) - Date.parse(input.startAt)) / 1000,
            playerCount: draft ? null : input.playerCount,
            averagePlayTimeSeconds: draft ? null : input.averagePlayTimeSeconds,
        },
        estimate: {
            secondsPerLevel: SECONDS_PER_LEVEL,
            levelsPerPlayer,
            totalLevelPlays: draft ? null : input.playerCount * levelsPerPlayer,
        },
    };
}

if (require.main === module) {
    try {
        const names = { '--kind': 'kind', '--start': 'startAt', '--end': 'endAt', '--players': 'playerCount', '--avg-seconds': 'averagePlayTimeSeconds' };
        const input = {}, args = process.argv.slice(2);
        for (let i = 0; i < args.length; i += 2) {
            const key = names[args[i]], value = args[i + 1];
            if (!key || value === undefined || !value.trim() || input[key] !== undefined) throw Error('参数错误：使用 --kind、--start、--end、--players、--avg-seconds，或不传参数生成草稿');
            input[key] = key === 'playerCount' || key === 'averagePlayTimeSeconds' ? Number(value) : value;
        }
        const config = buildConfig(input);
        const filename = config.generatedAt.slice(0, 19).replace('T', '_').replace(/:/g, '') + '.json';
        const directory = path.resolve(__dirname, '../config/HotNumber');
        fs.mkdirSync(directory, { recursive: true });
        const target = path.join(directory, filename);
        fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
        console.log(JSON.stringify({ file: target, uploadUrl: DIRECTORY_URL + filename,
            status: config.status, estimatedTotalLevelPlays: config.estimate.totalLevelPlays }, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { buildConfig };
