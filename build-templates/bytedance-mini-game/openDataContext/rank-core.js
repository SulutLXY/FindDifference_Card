'use strict';
const LIMIT = 99;
const PAGE_SIZE = 30;

function sameUser(a, b) {
    return !!(a && b && ((a.openid && b.openid && a.openid === b.openid)
        || (a.sec_uid && b.sec_uid && a.sec_uid === b.sec_uid)));
}

function normalize(item, selfUser) {
    return { name: String(item.nick_name || '玩家'), avatarUrl: String(item.user_img || ''),
        passed: Math.max(0, Math.floor(Number(item.value) || 0)),
        openid: item.openid, sec_uid: item.sec_uid, isSelf: sameUser(item, selfUser), isNpc: false };
}

/** 分页取前99个真实玩家；本人字段单独保留，不以昵称判断身份。 */
async function fetchRank(tt, tab) {
    if (typeof tt.getImRankData !== 'function') throw new Error('当前基础库不支持排行榜');
    const rows = [];
    let selfUser = null, selfItem = null;
    for (let page = 1; page <= 4 && rows.length < LIMIT; page++) {
        const response = await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error, value) => {
                if (settled) return;
                settled = true; clearTimeout(timer);
                if (error) reject(error); else resolve(value);
            };
            const timer = setTimeout(() => finish(new Error('排行榜响应超时，请点击页签重试')), 10000);
            try {
                tt.getImRankData({ dataType: 0, relationType: tab === 'friend' ? 'friend' : 'all',
                    rankType: 'all', pageNum: page, pageSize: PAGE_SIZE, zoneId: 'default',
                    success: value => finish(null, value),
                    fail: error => finish(new Error(`${error.errMsg || '排行榜获取失败'}${error.errNo != null ? ` (${error.errNo})` : ''}`)) });
            } catch (error) { finish(error); }
        });
        const data = response && response.data;
        if (!data || !Array.isArray(data.items)) throw new Error('排行榜返回数据格式异常');
        if (data.self_user_info) selfUser = data.self_user_info;
        if (data.self_item) selfItem = data.self_item;
        rows.push(...data.items);
        if (data.items.length < PAGE_SIZE || (data.total_num > 0 && page * PAGE_SIZE >= data.total_num)) break;
    }
    const unique = [];
    for (const item of rows) {
        if (!unique.some(existing => sameUser(existing, item))) unique.push(item);
    }
    return { rows: unique.slice(0, LIMIT).map(item => normalize(item, selfUser)), selfUser, selfItem };
}

function mergeRank(data, tab, npcPool, localPassed, profile) {
    const rows = data.rows.slice(0, LIMIT);
    const selfItem = data.selfItem;
    const selfUser = data.selfUser || {};
    // rank=0代表未上榜；不能把本地成绩强行插入真实榜。
    const ranked = selfItem && Number(selfItem.rank) > 0 && Number(selfItem.rank) <= LIMIT;
    if (ranked && selfItem.item && !rows.some(row => row.isSelf)) {
        const self = normalize(selfItem.item, selfUser);
        self.isSelf = true;
        rows.splice(Math.min(Number(selfItem.rank) - 1, rows.length), 0, self);
    }
    const hasNpcs = tab === 'global' && rows.length < LIMIT;
    if (hasNpcs) rows.push(...npcPool.slice(0, 50).map(row => ({ ...row,
        passed: Math.max(0, Math.min(45, Math.floor(Number(row.passed) || 0))), isSelf: false, isNpc: true })));
    const entries = rows.map((row, order) => ({ row, order }))
        .sort((a, b) => b.row.passed - a.row.passed || Number(!!a.row.isNpc) - Number(!!b.row.isNpc) || a.order - b.order)
        .slice(0, LIMIT).map(item => item.row);
    const index = entries.findIndex(row => row.isSelf);
    const self = { name: selfUser.nick_name || (profile && profile.nickName) || '我',
        avatarUrl: selfUser.user_img || (profile && profile.avatarUrl) || '',
        passed: selfItem && selfItem.item ? Math.max(0, Number(selfItem.item.value) || 0) : localPassed };
    return { entries, self, selfRank: index >= 0 ? index + 1 : 0, hasNpcs };
}

module.exports = { LIMIT, PAGE_SIZE, fetchRank, mergeRank, sameUser };
