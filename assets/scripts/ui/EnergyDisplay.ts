import { _decorator, instantiate, Label, Node, Prefab, resources } from 'cc';
import { UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/** 各页共用体力、下次恢复倒计时及明确标注的视频补充入口。 */
@ccclass('EnergyDisplay')
export class EnergyDisplay extends UIScreen {
    @property({ type: Label, displayName: '体力数值' })
    public energyLabel: Label | null = null;
    @property({ type: Label, displayName: '恢复倒计时' })
    public countdownLabel: Label | null = null;
    @property({ type: Node, displayName: '状态文字容器', tooltip: '始终显示，体力不足显示倒计时，达到 15 点显示体力已满' })
    public countdownRoot: Node | null = null;
    @property({ type: Node, displayName: '体力点击区域', tooltip: '体力不足 15 点时点击观看视频，达到 15 点后点击无效' })
    public rewardButton: Node | null = null;
    @property({ type: Node, displayName: '视频播放图标', tooltip: '仅在体力不足 15 点时显示' })
    public videoIcon: Node | null = null;
    private _elapsed = 0;
    private static _prefab: Prefab | null = null;
    private static _loading: Promise<Prefab> | null = null;
    private static readonly _attaching = new WeakMap<Node, Promise<void>>();

    public static attach(host: Node): Promise<void> {
        // 已由编辑器摆放的实例直接复用，不覆盖其位置或样式。
        if (!host.isValid || host.getComponentInChildren(EnergyDisplay)) return Promise.resolve();
        const pending = this._attaching.get(host);
        if (pending) return pending;
        const task = this._loadPrefab().then(prefab => {
            if (!host.isValid || host.getComponentInChildren(EnergyDisplay)) return;
            const node = instantiate(prefab);
            // 沿用预制体根节点的位置，各页面不再覆盖设计坐标。
            node.parent = host;
        }).catch(error => {
            console.warn('[EnergyDisplay] 体力预制体加载失败', error);
        }).finally(() => { this._attaching.delete(host); });
        this._attaching.set(host, task);
        return task;
    }

    private static _loadPrefab(): Promise<Prefab> {
        if (this._prefab?.isValid) return Promise.resolve(this._prefab);
        if (this._loading) return this._loading;
        this._loading = new Promise<Prefab>((resolve, reject) => {
            resources.load('prefabs/EnergyDisplay', Prefab, (error, prefab) => {
                if (error || !prefab) { reject(error ?? new Error('EnergyDisplay prefab missing')); return; }
                // 常驻公共 UI，只持有一份模板，各页面复用，避免切页反复加载。
                prefab.addRef();
                this._prefab = prefab;
                resolve(prefab);
            });
        }).finally(() => { this._loading = null; });
        return this._loading;
    }

    protected onLoad(): void {
        this.energyLabel ??= this.resolveLabel(null, 'EnergyLabel');
        this.countdownLabel ??= this.resolveLabel(null, 'EnergyCountdown');
        this.countdownRoot ??= this.countdownLabel?.node ?? null;
        this.rewardButton ??= this.resolveNode(null, 'BtnEnergyVideo');
        this.videoIcon ??= this.findChildDeep(this.node, 'icon_videoplay');
        this.wireButton(this.rewardButton, 'BtnEnergyVideo', () => this._onRewardClick());
        this._refresh();
    }

    private _onRewardClick(): void {
        // 点击时重新判断，避免在两次界面刷新之间恰好恢复满体力后仍打开广告。
        if (this.flow.save.energy >= this.flow.save.energyRecoveryLimit) return;
        void this.flow.requestEnergyReward();
    }

    protected onEnable(): void { this._refresh(); }

    protected update(dt: number): void {
        this._elapsed += dt;
        if (this._elapsed < 0.5) return;
        this._elapsed = 0;
        this._refresh();
    }

    private _refresh(): void {
        if (!this.energyLabel) return;
        const save = this.flow.save;
        const energy = save.energy;
        const full = energy >= save.energyRecoveryLimit;
        const text = `体力 ${energy}`;
        if (this.energyLabel.string !== text) this.energyLabel.string = text;
        if (this.countdownRoot) this.countdownRoot.active = true;
        if (this.countdownLabel) {
            const seconds = save.energyRecoverySeconds;
            const remaining = full ? '体力已满' : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
            if (this.countdownLabel.string !== remaining) this.countdownLabel.string = remaining;
        }
        if (this.videoIcon) this.videoIcon.active = !full;
    }
}
