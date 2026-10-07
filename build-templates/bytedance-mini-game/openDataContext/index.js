'use strict';
const { fetchRank, mergeRank } = require('./rank-core');
const canvas = tt.getSharedCanvas();
const ctx = canvas.getContext('2d');
const images = Object.create(null);
let state = null;
let generation = 0;
let scroll = 0;
const ROW_HEIGHT = 92;

function image(url) {
    if (!url) return null;
    if (!images[url]) {
        const entry = images[url] = { ready: false, image: tt.createImage() };
        entry.image.onload = () => { entry.ready = true; draw(); };
        entry.image.onerror = () => { entry.ready = false; };
        entry.image.src = url;
    }
    return images[url].ready ? images[url].image : null;
}

function text(value, rect, fontSize, color) {
    if (!rect) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
    ctx.font = `${rect.bold ? 'bold ' : ''}${rect.fontSize || fontSize}px sans-serif`; ctx.fillStyle = rect.color || color || '#513412';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(value), rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width - 4);
    ctx.restore();
}

function avatar(row, x, y, radius) {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.clip();
    const picture = image(row.avatarUrl);
    if (picture) ctx.drawImage(picture, x - radius, y - radius, radius * 2, radius * 2);
    else {
        const hue = Array.from(row.name || '我').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
        ctx.fillStyle = `hsl(${hue},35%,73%)`; ctx.fillRect(x-radius, y-radius, radius*2, radius*2);
        ctx.fillStyle = '#fff'; ctx.font = `${radius}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText((row.name || '我').slice(0, 1), x, y);
    }
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state) return;
    ctx.save(); ctx.scale(canvas.width / state.width, canvas.height / state.height);
    const list = state.list;
    const statusHeight = 34;
    const visibleHeight = list.height - statusHeight;
    const maxScroll = Math.max(0, state.result.entries.length * ROW_HEIGHT - visibleHeight);
    scroll = Math.max(0, Math.min(maxScroll, scroll));
    text(state.status, { x:list.x, y:list.y, width:list.width, height:statusHeight }, 20, '#967b50');
    ctx.save(); ctx.beginPath(); ctx.rect(list.x, list.y + statusHeight, list.width, visibleHeight); ctx.clip();
    state.result.entries.forEach((row, index) => {
        const y = list.y + statusHeight + index * ROW_HEIGHT - scroll;
        if (y + ROW_HEIGHT < list.y + statusHeight || y > list.y + list.height) return;
        ctx.fillStyle = row.isSelf ? '#ffe7a0' : '#fff4d5';
        ctx.fillRect(list.x + 5, y + 4, list.width - 10, ROW_HEIGHT - 10);
        const rankColor = ['#ce8a16','#8e9ba9','#b77946'][index] || '#73502c';
        text(index + 1, { x:list.x+8, y:y+10, width:74, height:64 }, 28, rankColor);
        avatar(row, list.x+125, y+ROW_HEIGHT/2, 28);
        text(row.name, { x:list.x+170, y:y+10, width:list.width-310, height:64 }, 25);
        text(`${row.passed}关`, { x:list.x+list.width-135, y:y+10, width:125, height:64 }, 26);
        if (row.isNpc) text('NPC', { x:list.x+90, y:y+70, width:70, height:16 }, 13, '#99815c');
    });
    if (!state.result.entries.length) text(state.loading ? '正在获取排行榜…' : '暂无好友上榜',
        { x:list.x, y:list.y+list.height/2-30, width:list.width, height:60 }, 26, '#967b50');
    ctx.restore();
    if (maxScroll > 0) {
        const barHeight = Math.max(28, visibleHeight * visibleHeight / (state.result.entries.length * ROW_HEIGHT));
        ctx.fillStyle = '#d2b377';
        ctx.fillRect(list.x+list.width-5, list.y+statusHeight+(visibleHeight-barHeight)*scroll/maxScroll, 4, barHeight);
    }
    const fields = state.fields;
    text(state.result.selfRank > 0 ? state.result.selfRank : '未上榜', fields.rank, 28);
    text(`${state.result.self.passed}关`, fields.score, 28);
    text(state.result.self.name, fields.name, 25);
    if (fields.avatar) avatar(state.result.self, fields.avatar.x+fields.avatar.width/2,
        fields.avatar.y+fields.avatar.height/2, Math.min(fields.avatar.width,fields.avatar.height)/2);
    ctx.restore();
}

tt.onMessage(message => {
    if (!message || message.type !== 'rank') return;
    if (message.action === 'hide') { generation++; state=null; draw(); return; }
    if (message.action === 'scroll' && state) { scroll += Number(message.delta) || 0; draw(); return; }
    if (message.action === 'profile' && state) {
        if (message.profile) {
            state.result.self.name = message.profile.nickName;
            state.result.self.avatarUrl = message.profile.avatarUrl;
        }
        draw(); return;
    }
    if (message.action !== 'show') return;
    const request = ++generation;
    scroll = 0;
    const empty = { rows:[], selfItem:null, selfUser:null };
    state = { ...message, loading:true,
        result:mergeRank(empty, message.tab, message.npcPool, message.passed, message.profile),
        status:'正在获取排行榜…' };
    draw();
    fetchRank(tt, message.tab).then(data => {
        if (!state || request !== generation) return;
        state.loading = false;
        state.result = mergeRank(data, message.tab, message.npcPool, message.passed, message.profile);
        state.status = message.message || (state.result.hasNpcs ? '总榜含模拟玩家' : '仅展示前99位');
        draw();
    }).catch(error => {
        if (!state || request !== generation) return;
        state.loading = false;
        state.status = message.tab === 'global' ? '取数失败，暂显示模拟玩家；点击全服重试' : '好友取数失败，点击好友重试';
        console.warn('[DouyinRankOpenData]', error.message || error);
        draw();
    });
});
