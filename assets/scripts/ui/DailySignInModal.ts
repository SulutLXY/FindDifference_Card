import { _decorator, Animation, BlockInputEvents, Button, game, Game, JsonAsset, Label, Node, Sprite, Tween, tween, UIOpacity, UITransform, Vec2, Vec3, view } from 'cc';
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
    @property({ type: Node, tooltip: '同时添加桌面选项，默认勾选，可由玩家取消' }) public desktopChoice: Node | null = null;
    private _config: DailySignInConfig | null = null;
    private _pending = false;
    private _elapsed = 0;
    private _resolve: (() => void) | null = null;
    private _closed: Promise<void> | null = null;
    private _desktopChecked = true;
    private _nativeTouchHost: any = null;
    private _normalAnimation: Animation | null = null;
    private _normalScale: Vec3 | null = null;
    private _doubleAnimation: Animation | null = null;
    private _doubleScale: Vec3 | null = null;
    private _doubleOpacity: UIOpacity | null = null;
    private _doubleBaseOpacity = 255;
    private _doubleBlink: Tween<UIOpacity> | null = null;
    private _doublePulsing = false;

    protected onLoad(): void {
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        this._prepareButtonAnimations();
        // 普通领取保留原生点击上下文；视频领取在奖励保存成功后自动请求桌面授权。
        this.wireButton(this.btnNormal, 'ResultCard/BtnNormal', () => { if (!this._nativeTouchHost) void this._claim(false); });
        this.wireButton(this.btnDouble, 'ResultCard/BtnDouble', () => { if (!this._nativeTouchHost) void this._claim(true); });
        this.wireButton(this.btnClose, 'ResultCard/BtnClose', () => this.close());
        this.wireButton(this.desktopChoice, 'ResultCard/AddDesktopChoice', () => {
            if (this._pending) return;
            this._desktopChecked = !this._desktopChecked;
            this._syncDesktopChoice();
            this._refresh();
        });
        const tt = (globalThis as any).tt;
        if (this.flow.platform.kind === 'douyin' && typeof tt?.onTouchEnd === 'function' && typeof tt?.offTouchEnd === 'function') {
            this._nativeTouchHost = tt;
            tt.onTouchEnd(this._nativeTouchEnd);
        }
        game.on(Game.EVENT_SHOW, this._refresh, this);
    }

    public present(config: DailySignInConfig): Promise<void> {
        if (this.node.activeInHierarchy && this._closed) return this._closed;
        this._config = config;
        this._desktopChecked = true;
        this._closed = new Promise(resolve => { this._resolve = resolve; });
        this.open();
        this.node.setSiblingIndex(this.node.parent!.children.length - 1);
        this._refresh();
        return this._closed;
    }

    public close(): void { super.close(); this._settle(); }
    private _settle(): void { this._resolve?.(); this._resolve = null; this._closed = null; }
    protected onDisable(): void { this._stopButtonAnimations(); this._settle(); super.onDisable(); }
    protected onDestroy(): void {
        this._stopButtonAnimations();
        this._nativeTouchHost?.offTouchEnd(this._nativeTouchEnd);
        this._nativeTouchHost = null;
        game.off(Game.EVENT_SHOW, this._refresh, this); this._settle(); super.onDestroy();
    }
    protected update(dt: number): void { this._elapsed += dt; if (this._elapsed >= 1) { this._elapsed = 0; this._refresh(); } }

    private _refresh(): void {
        const config = this._config ?? this.rewardConfig?.json as DailySignInConfig | null;
        if (!config || !this.node.activeInHierarchy) return;
        this._syncDesktopChoice();
        const status = this.flow.save.dailyStatus(sidebarDay(), config);
        this._setDoublePulse(!this._pending && status.canClaim);
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
        this.setLabel(null, 'ResultCard/BtnDouble/Label', status.claimed ? '今日已领取' : this._pending ? '请稍候…' : '双倍领取');
    }

    private _syncDesktopChoice(): void {
        const choice = this.resolveNode(this.desktopChoice, 'ResultCard/AddDesktopChoice');
        const check = choice && this.findChildDeep(choice, 'Checkmark');
        if (check) check.active = this._desktopChecked;
    }

    private _prepareButtonAnimations(): void {
        const normal = this.resolveNode(this.btnNormal, 'ResultCard/BtnNormal');
        const double = this.resolveNode(this.btnDouble, 'ResultCard/BtnDouble');
        this._normalAnimation = normal?.getComponent(Animation) ?? null;
        this._normalScale = normal?.scale?.clone() ?? null;
        this._doubleAnimation = double?.getComponent(Animation) ?? null;
        this._doubleScale = double?.scale?.clone() ?? null;
        // 动画和透明度作用于按钮根节点，背景、图标、文字作为整体呼吸。
        if (double && this._doubleAnimation) {
            this._doubleOpacity = double.getComponent(UIOpacity) ?? double.addComponent(UIOpacity);
            this._doubleBaseOpacity = this._doubleOpacity.opacity;
        }
        if (this._normalAnimation) this._normalAnimation.playOnLoad = false;
        if (this._doubleAnimation) this._doubleAnimation.playOnLoad = false;
    }

    private _setDoublePulse(playing: boolean): void {
        if (playing === this._doublePulsing) return;
        const animation = this._doubleAnimation;
        if (playing) {
            const clip = animation?.defaultClip;
            if (!animation?.isValid || !clip) return;
            this._doublePulsing = true;
            animation.play(clip.name);
            if (this._doubleOpacity) {
                const half = Math.max(0.1, clip.duration / 2);
                this._doubleBlink = tween(this._doubleOpacity).repeatForever(tween<UIOpacity>()
                    .to(half, { opacity: this._doubleBaseOpacity * 0.75 }, { easing: 'sineInOut' })
                    .to(half, { opacity: this._doubleBaseOpacity }, { easing: 'sineInOut' })).start();
            }
        } else {
            this._doublePulsing = false;
            this._doubleBlink?.stop(); this._doubleBlink = null;
            if (animation?.isValid) {
                animation.stop();
                if (this._doubleScale) animation.node.setScale(this._doubleScale);
            }
            if (this._doubleOpacity?.isValid) this._doubleOpacity.opacity = this._doubleBaseOpacity;
        }
    }

    private _playNormalClick(): void {
        const animation = this._normalAnimation;
        const state = animation?.getState('An_BtnClik_01');
        // 全局 TOUCH_START 已播时不重复重启；原生领取触摸路径在此补播。
        if (animation?.isValid && state && !state.isPlaying) animation.play('An_BtnClik_01');
    }

    private _stopButtonAnimations(): void {
        this._setDoublePulse(false);
        if (this._normalAnimation?.isValid) {
            this._normalAnimation.stop();
            if (this._normalScale) this._normalAnimation.node.setScale(this._normalScale);
        }
    }

    private readonly _nativeTouchEnd = (event: any): void => {
        if (!this._nativeTouchHost || !this.isValid || !this.node.activeInHierarchy || this._pending || this.flow.feed?.isPreview) return;
        let dpr = 1;
        try { dpr = this._nativeTouchHost.getSystemInfoSync?.().pixelRatio || 1; } catch { return; }
        for (const [bound, path, double] of [
            [this.btnNormal, 'ResultCard/BtnNormal', false], [this.btnDouble, 'ResultCard/BtnDouble', true],
        ] as const) {
            const node = this.resolveNode(bound, path);
            if (!node?.isValid || !node.activeInHierarchy) continue;
            const button = node.getComponent(Button);
            if (button && (!button.enabledInHierarchy || !button.interactable)) continue;
            const ui = node.getComponent(UITransform);
            if (!ui) continue;
            for (const point of event.changedTouches ?? []) {
                const x = point.clientX ?? point.x, y = point.clientY ?? point.y;
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                if (ui.hitTest(new Vec2(x * dpr, (view.getFrameSize().height - y) * dpr))) {
                    this.flow.platform.recoverInterstitialOnTouch();
                    void this._claim(double, true);
                    return;
                }
            }
        }
    };

    private async _claim(double: boolean, nativeGesture = false): Promise<void> {
        const config = this._config ?? this.rewardConfig?.json as DailySignInConfig | null;
        if (this._pending || !config || !this.node.activeInHierarchy) return;
        const day = sidebarDay();
        const status = this.flow.save.dailyStatus(day, config);
        if (!status.canClaim) return;
        if (!double) this._playNormalClick();
        this._pending = true; this._refresh();
        const wantsDesktop = nativeGesture && this._desktopChecked && this.flow.platform.kind === 'douyin';
        let claimed = false;
        const claim = () => {
            if (sidebarDay() !== day) { this.flow.toast('日期已更新，请领取今天的签到奖励'); return; }
            const before = status.reward.kind === 'hint' ? this.flow.save.freeHints : this.flow.save.energy;
            if (this.flow.save.claimDailySignIn(day, config, double ? 2 : 1, status.dayIndex)) {
                claimed = true;
                const after = status.reward.kind === 'hint' ? this.flow.save.freeHints : this.flow.save.energy;
                this.flow.toast(`签到成功：${status.reward.kind === 'hint' ? '提示' : '体力'} +${after - before}`);
            } else this.flow.toast(status.reward.kind === 'energy' && this.flow.save.energy >= this.flow.save.energyLimit
                ? '体力储存已满，消耗后可再领取' : '奖励保存失败或今日已领取，请重试');
        };
        try {
            if (double) {
                if (!this.isValid || !this.node.activeInHierarchy) return;
                await this.flow.requestReward('daily-sign-in', claim);
            }
            else claim();
            if (claimed && wantsDesktop && this.isValid && this.node.activeInHierarchy && !this.flow.feed?.isPreview) {
                try {
                    // 领取与保存完成后只自动请求一次，不让玩家再次点击领取按钮。
                    // 视频后的调用可能被宿主以21500（缺少原生手势）拒绝，不能影响已保存奖励。
                    await this.flow.platform.addDesktop();
                } catch (error) { console.warn('[DailySignIn] 领取后自动添加桌面未完成，签到奖励已保留', error); }
            }
        } finally { this._pending = false; if (this.isValid) this._refresh(); }
    }
}
