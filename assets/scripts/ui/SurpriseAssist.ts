import { Animation, EventTouch, Input, instantiate, Label, Node, Prefab, Sprite, SpriteFrame, UITransform } from 'cc';
import type { LevelConfig, SurpriseAssistKind } from '../core/GameTypes';
import type { GameFlow } from '../GameFlow';

type Gift = { readonly kind: SurpriseAssistKind; readonly amount: number };
type Flight = { node: Node; gift: Gift; elapsed: number; duration: number; leftToRight: boolean; height: number; phase: number };

/** 局内惊喜道具：只按有效游玩时间计时，不阻塞关卡加载。 */
export class SurpriseAssist {
    private _level: LevelConfig | null = null;
    private _prefab: Prefab | null = null;
    private _hintFrame: SpriteFrame | null = null;
    private _lifeFrame: SpriteFrame | null = null;
    private _loading: Promise<void> | null = null;
    private _flight: Flight | null = null;
    private _clock = 0;
    private _rollElapsed = 0;
    private _lastAppearance = -Infinity;
    private _appearances = 0;
    private _claiming = false;
    private _pressedTouch: { flight: Flight; id: number | null } | null = null;
    private _version = 0;
    private _disposed = false;

    constructor(private readonly root: Node, private readonly flow: GameFlow,
        private readonly random = () => Math.random()) {}

    public start(level: LevelConfig): void {
        this.clear();
        this._level = level;
        void this._prepare();
    }

    private _prepare(): Promise<void> {
        if (this._loading) return this._loading;
        if (this._prefab && this._hintFrame && this._lifeFrame) return Promise.resolve();
        this._loading = Promise.all([
            this.flow.loadGamePrefab('Item_Tips_surprise'),
            this.flow.loadGameSpriteFrame('Common/textures/UI_Sprite/V3/icons/icon_Idea/spriteFrame'),
            this.flow.loadGameSpriteFrame('Texture/icons/icon_heart_filled/spriteFrame'),
        ]).then(([prefab, frame, lifeFrame]) => {
            if (!this._disposed) { this._prefab = prefab; this._hintFrame = frame; this._lifeFrame = lifeFrame; }
        }).catch(error => console.warn('[SurpriseAssist] 惊喜道具素材暂未就绪', error))
            .finally(() => { this._loading = null; });
        return this._loading;
    }

    public update(dt: number): void {
        if (!this._level || this._disposed || !Number.isFinite(dt) || dt <= 0) return;
        if (this.flow.isGameOver) { this._removeFlight(); return; }
        if (this._flight?.gift.kind === 'life' && !this._canDropLife()) this._removeFlight();
        if (this.flow.isPaused || this.flow.platform.interstitialBusy || this._claiming || this._pressedTouch) return;
        this._clock += dt;
        if (this._flight) {
            this._flight.elapsed += dt;
            if (this._flight.elapsed >= this._flight.duration) this._removeFlight();
            else this._position(this._flight);
        }
        const total = this._level.differences.length;
        const remaining = Math.max(0, total - this.flow.foundIds.size);
        // 加时回到半程以上时暂停抽取，已经出现的道具仍按原轨迹走完。
        if (this.flow.remainingTime >= this._level.timeLimit * 0.5 || remaining === 0 || total === 0) {
            this._rollElapsed = 0;
            return;
        }
        this._rollElapsed += dt;
        if (this._rollElapsed < 5) return;
        this._rollElapsed %= 5; // 卡顿恢复只抽一次，不补刷多次。
        if (this._flight || this._appearances >= 3 || this._clock - this._lastAppearance < 10) return;
        if (!this._prefab || !this._hintFrame || !this._lifeFrame) { void this._prepare(); return; }
        // 先抽取候选奖励，再按免费/视频两类分别判断出现；显示后不再改奖励。
        const kinds: SurpriseAssistKind[] = this._canDropLife() ? ['hint', 'add-time', 'life'] : ['hint', 'add-time'];
        const kind = kinds[Math.floor(this.random() * kinds.length)];
        const gift: Gift = { kind, amount: kind === 'life' ? 1 : 1 + Math.floor(this.random() * 3) };
        const remainingRatio = Math.min(1, remaining / total);
        const urgency = Math.min(1, Math.max(0, 1 - this.flow.remainingTime / (this._level.timeLimit * 0.5)));
        const probability = gift.amount === 1 ? 0.2 + 0.6 * (1 - remainingRatio)
            : 0.2 + 0.6 * remainingRatio * urgency;
        if (this.random() >= probability) return;
        this._spawn(gift);
    }

    private _canDropLife(): boolean {
        return Number.isFinite(this.flow.lives) && this.flow.lives > 0 && this.flow.lives < (this._level?.maxLives ?? 0);
    }

    private _spawn(gift: Gift): void {
        if (!this._prefab || !this.root.isValid || !this.root.getComponent(UITransform)) return;
        const node = instantiate(this._prefab);
        node.parent = this.root;
        node.active = true;
        node.setSiblingIndex(this.root.children.length - 1);
        const setLayer = (target: Node) => {
            target.layer = this.root.layer;
            target.children.forEach(setLayer);
        };
        setLayer(node);
        const icon = node.getChildByName('icon_Time')?.getComponent(Sprite);
        if (icon && gift.kind === 'hint') { icon.sizeMode = Sprite.SizeMode.CUSTOM; icon.spriteFrame = this._hintFrame; }
        if (icon && gift.kind === 'life') { icon.sizeMode = Sprite.SizeMode.CUSTOM; icon.spriteFrame = this._lifeFrame; }
        const number = node.getChildByName('Number')?.getComponent(Label);
        if (number) number.string = `x${gift.amount}`;
        const video = node.getChildByName('icon_videoplay');
        if (video) video.active = gift.amount >= 2;
        const flight: Flight = { node, gift, elapsed: 0, duration: gift.amount === 1 ? 2.5 : gift.amount === 2 ? 3.5 : 5,
            leftToRight: this.random() < 0.5, height: this.random(), phase: this.random() * Math.PI * 2 };
        this._flight = flight;
        this._appearances++;
        this._lastAppearance = this._clock;
        this._rollElapsed = 0;
        this._position(flight);
        this._bindTouch(flight);
    }

    private _bindTouch(flight: Flight): void {
        const node = flight.node;
        const clickBox = node.getChildByName('ClikBox');
        // 透明 UITransform 只有绑定触摸监听后才成为独立命中目标。
        if (clickBox) clickBox.setSiblingIndex(node.children.length - 1);
        const stop = (event: EventTouch) => { event.propagationStopped = true; };
        const ownsTouch = (event: EventTouch) => this._pressedTouch?.flight === flight && this._pressedTouch.id === event.getID();
        for (const target of clickBox ? [node, clickBox] : [node]) {
            target.on(Input.EventType.TOUCH_START, (event: EventTouch) => {
                stop(event);
                if (this._flight !== flight || this._pressedTouch || this._claiming || this.flow.isPaused
                    || this.flow.isGameOver || this.flow.platform.interstitialBusy) return;
                // 保持命中框在手指下，避免松手时移动出框被引擎转换成 TOUCH_CANCEL。
                this._pressedTouch = { flight, id: event.getID() };
            });
            target.on(Input.EventType.TOUCH_MOVE, stop);
            target.on(Input.EventType.TOUCH_CANCEL, (event: EventTouch) => {
                stop(event);
                if (ownsTouch(event)) this._pressedTouch = null;
            });
            target.on(Input.EventType.TOUCH_END, (event: EventTouch) => {
                stop(event);
                if (!ownsTouch(event)) return;
                this._pressedTouch = null;
                void this._claim(flight);
            });
        }
    }

    private _position(flight: Flight): void {
        const ui = this.root.getComponent(UITransform);
        const item = flight.node.getComponent(UITransform);
        if (!ui || !item) return;
        const halfWidth = item.width * Math.abs(flight.node.scale.x) / 2;
        const halfHeight = item.height * Math.abs(flight.node.scale.y) / 2;
        const left = -ui.width * ui.anchorX - halfWidth;
        const right = ui.width * (1 - ui.anchorX) + halfWidth;
        const inset = Math.min(halfHeight, ui.height * 0.15);
        const lower = ui.height * (0.5 - ui.anchorY) + inset;
        const upper = ui.height * (0.8 - ui.anchorY) - inset;
        const range = Math.max(0, upper - lower);
        const amplitude = Math.min(48, range / 2);
        const baseHeight = lower + amplitude + (range - amplitude * 2) * flight.height;
        const y = baseHeight + amplitude * Math.sin(flight.phase + flight.elapsed * Math.PI * 2 / 1.2);
        const fraction = Math.min(1, flight.elapsed / flight.duration);
        const x = flight.leftToRight ? left + (right - left) * fraction : right - (right - left) * fraction;
        flight.node.setPosition(x, y, 0);
    }

    private async _claim(flight: Flight): Promise<void> {
        if (this._flight !== flight || this._claiming || this.flow.isPaused || this.flow.isGameOver
            || this.flow.platform.interstitialBusy) return;
        this._claiming = true;
        const version = this._version;
        const animation = flight.node.getComponent(Animation);
        if (animation?.defaultClip) animation.play(animation.defaultClip.name);
        try {
            const granted = await this.flow.claimSurpriseAssist(flight.gift.kind, flight.gift.amount);
            if (version === this._version && this._flight === flight && granted) this._removeFlight();
        } catch (error) { console.warn('[SurpriseAssist] 领取失败', error); }
        finally { if (version === this._version) this._claiming = false; }
    }

    private _removeFlight(): void {
        this._pressedTouch = null;
        if (this._flight?.node.isValid) this._flight.node.destroy();
        this._flight = null;
    }

    public clear(): void {
        this._version++;
        this._removeFlight();
        this._level = null;
        this._clock = this._rollElapsed = this._appearances = 0;
        this._lastAppearance = -Infinity;
        this._claiming = false;
    }

    public dispose(): void { this.clear(); this._disposed = true; this._prefab = null; this._hintFrame = null; this._lifeFrame = null; }
}
