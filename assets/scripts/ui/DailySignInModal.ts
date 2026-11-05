import { _decorator, BlockInputEvents, Button, game, Game, JsonAsset, Label, Node, Sprite } from 'cc';
import { DailySignInConfig } from '../core/DailySignIn';
import { sidebarDay } from '../services/SidebarService';
import { UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/** 独立可编辑预制体；布局、美术和字体由 prefab 维护，逻辑只更新状态。 */
@ccclass('DailySignInModal')
export class DailySignInModal extends UIScreen {
    @property({ type: JsonAsset, tooltip: '七日奖励配置，可单独编辑 JSON' })
    public rewardConfig: JsonAsset | null = null;
    @property({ type: Node }) public btnNormal: Node | null = null;
    @property({ type: Node }) public btnDouble: Node | null = null;
    @property({ type: Node }) public btnClose: Node | null = null;
    private _config: DailySignInConfig | null = null;
    private _pending = false;
    private _elapsed = 0;
    private _resolve: (() => void) | null = null;
    private _closed: Promise<void> | null = null;

    protected onLoad(): void {
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        this.wireButton(this.btnNormal, 'ResultCard/BtnNormal', () => { void this._claim(false); });
        this.wireButton(this.btnDouble, 'ResultCard/BtnDouble', () => { void this._claim(true); });
        this.wireButton(this.btnClose, 'ResultCard/BtnClose', () => this.close());
        game.on(Game.EVENT_SHOW, this._refresh, this);
    }

    public present(config: DailySignInConfig): Promise<void> {
        if (this.node.activeInHierarchy && this._closed) return this._closed;
        this._config = config;
        this._closed = new Promise(resolve => { this._resolve = resolve; });
        this.open();
        this.node.setSiblingIndex(this.node.parent!.children.length - 1);
        this._refresh();
        return this._closed;
    }

    public close(): void { super.close(); this._settle(); }
    private _settle(): void { this._resolve?.(); this._resolve = null; this._closed = null; }
    protected onDisable(): void { this._settle(); super.onDisable(); }
    protected onDestroy(): void { game.off(Game.EVENT_SHOW, this._refresh, this); this._settle(); super.onDestroy(); }
    protected update(dt: number): void { this._elapsed += dt; if (this._elapsed >= 1) { this._elapsed = 0; this._refresh(); } }

    private _refresh(): void {
        const config = this._config ?? this.rewardConfig?.json as DailySignInConfig | null;
        if (!config || !this.node.activeInHierarchy) return;
        const status = this.flow.save.dailyStatus(sidebarDay(), config);
        this.setLabel(null, 'ResultCard/Subtitle', `连续签到第 ${status.dayIndex} 天 · 漏签从第1天重新开始`);
        config.days.forEach((reward, index) => {
            const path = `ResultCard/Days/Day${index + 1}`;
            this.setLabel(null, `${path}/Reward`, `${reward.kind === 'hint' ? '提示' : '体力'} ×${reward.amount}`);
            const claimed = index + 1 < status.dayIndex || (status.claimed && index + 1 === status.dayIndex);
            this.setLabel(null, `${path}/State`, claimed ? '已领取' : index + 1 === status.dayIndex ? '今日可领取' : '未开启');
            const check = this.findChildDeep(this.node, `Day${index + 1}`)?.getChildByName('Claimed');
            if (check) check.active = claimed;
            const current = this.findChildDeep(this.node, `Day${index + 1}`)?.getChildByName('Current');
            if (current) current.active = !status.claimed && index + 1 === status.dayIndex;
        });
        for (const [node, path] of [[this.btnNormal, 'ResultCard/BtnNormal'], [this.btnDouble, 'ResultCard/BtnDouble']] as const) {
            const root = this.resolveNode(node, path);
            const button = root?.getComponent(Button);
            if (button) button.interactable = !this._pending && status.canClaim;
            const sprite = root?.getComponent(Sprite);
            if (sprite) sprite.grayscale = status.claimed;
        }
        this.setLabel(null, 'ResultCard/BtnNormal/Label', status.claimed ? '已领取' : this._pending ? '请稍候…' : '普通领取');
        this.setLabel(null, 'ResultCard/BtnDouble/Label', status.claimed ? '今日已领取' : this._pending ? '请稍候…' : '视频双倍领取');
    }

    private async _claim(double: boolean): Promise<void> {
        const config = this._config ?? this.rewardConfig?.json as DailySignInConfig | null;
        if (this._pending || !config || !this.node.activeInHierarchy) return;
        const day = sidebarDay();
        const status = this.flow.save.dailyStatus(day, config);
        if (!status.canClaim) return;
        this._pending = true; this._refresh();
        const claim = () => {
            if (sidebarDay() !== day) { this.flow.toast('日期已更新，请领取今天的签到奖励'); return; }
            const before = status.reward.kind === 'hint' ? this.flow.save.freeHints : this.flow.save.energy;
            if (this.flow.save.claimDailySignIn(day, config, double ? 2 : 1, status.dayIndex)) {
                const after = status.reward.kind === 'hint' ? this.flow.save.freeHints : this.flow.save.energy;
                this.flow.toast(`签到成功：${status.reward.kind === 'hint' ? '提示' : '体力'} +${after - before}`);
            } else this.flow.toast(status.reward.kind === 'energy' && this.flow.save.energy >= this.flow.save.energyLimit
                ? '体力储存已满，消耗后可再领取' : '奖励保存失败或今日已领取，请重试');
        };
        try {
            if (double) await this.flow.requestReward('daily-sign-in', claim);
            else claim();
        } finally { this._pending = false; if (this.isValid) this._refresh(); }
    }
}
