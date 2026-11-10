import { _decorator, Animation, Component, EventTouch, input, Input, instantiate, Node, Prefab, UITransform, Vec3 } from 'cc';
import { getGameFlow } from './UIScreen';

const { ccclass } = _decorator;
const MAX_EFFECTS = 8;

/** 全屏点击反馈：UI 捕获覆盖按钮，全局输入补充没有 UI 命中的区域。 */
@ccclass('TouchPointEffect')
export class TouchPointEffect extends Component {
    /** 由 GameFlow 注入音效播放，统一遵循音效设置。 */
    public playClickSound: ((event: EventTouch) => void) | null = null;
    private _prefab: Prefab | null = null;
    private _layer: Node | null = null;
    private readonly _handled = new WeakSet<EventTouch>();
    private readonly _pending: Vec3[] = [];
    private readonly _effects = new Set<Node>();
    private readonly _pool: Node[] = [];

    protected onLoad(): void {
        const layer = new Node('TouchPointEffects');
        layer.layer = this.node.layer;
        layer.addComponent(UITransform);
        this.node.addChild(layer);
        this._layer = layer;
        void getGameFlow().loadCommonPrefab('TouchPoint').then(prefab => {
            if (!this.isValid) return;
            this._prefab = prefab;
            if (this.enabledInHierarchy) {
                for (const position of this._pending) this._spawn(position);
            }
            this._pending.length = 0;
        }).catch(error => {
            this._pending.length = 0;
            if (this.isValid) console.error('[TouchPointEffect] TouchPoint 预设加载失败', error);
        });
    }

    protected onEnable(): void {
        this.node.on(Node.EventType.TOUCH_START, this._onPress, this, true);
        input.on(Input.EventType.TOUCH_START, this._onPress, this);
    }

    /** 特效仍覆盖整个 Canvas，但视觉比例与设计界面一致。 */
    private _syncScale(): void {
        const screens = this.node.getChildByName('Screens');
        const scale = screens?.scale, current = this._layer?.scale;
        if (this._layer && scale && current
            && (current.x !== scale.x || current.y !== scale.y || current.z !== scale.z)) this._layer.setScale(scale);
    }

    protected lateUpdate(): void { this._syncScale(); }

    private _onPress(event: EventTouch): void {
        // Cocos 已将鼠标按下转换为 TOUCH_START；不再额外监听 MOUSE_DOWN。
        if (this._handled.has(event)) return;
        this._handled.add(event);
        this.playClickSound?.(event);
        const layer = this._layer;
        if (!layer) return;
        layer.setSiblingIndex(this.node.children.length - 1);
        const location = event.getUILocation();
        // 保留 UI 坐标，到生成时按当前特效层换算，避免加载/窗口切换后偏移。
        const position = new Vec3(location.x, location.y, 0);
        if (this._prefab) this._spawn(position);
        else {
            if (this._pending.length >= MAX_EFFECTS) this._pending.shift();
            this._pending.push(position);
        }
    }

    private _spawn(position: Vec3): void {
        if (!this._prefab || !this._layer || this._effects.size >= MAX_EFFECTS) return;
        this._syncScale();
        const transform = this._layer.getComponent(UITransform);
        if (!transform) return;
        let effect = this._pool.pop();
        while (effect && !effect.isValid) effect = this._pool.pop();
        if (!effect) {
            effect = instantiate(this._prefab);
            effect.active = false;
            this._layer.addChild(effect);
        }
        effect.setPosition(transform.convertToNodeSpaceAR(position));
        effect.setSiblingIndex(this._layer.children.length - 1);
        effect.active = true;
        // 再次启用会恢复旧动画时间，必须重播并采样首帧，清掉上次的颜色/缩放。
        for (const animation of effect.getComponentsInChildren(Animation)) {
            if (!animation.enabledInHierarchy || !animation.playOnLoad || !animation.defaultClip) continue;
            animation.stop();
            animation.play();
            const state = animation.getState(animation.defaultClip.name);
            if (state) { state.time = 0; state.sample(); }
        }
        this._effects.add(effect);
        const activeEffect = effect;
        this.scheduleOnce(() => this._recycle(activeEffect), 1);
    }

    private _recycle(effect: Node): void {
        if (!this._effects.delete(effect) || !effect.isValid) return;
        for (const animation of effect.getComponentsInChildren(Animation)) animation.stop();
        effect.active = false;
        this._pool.push(effect);
    }

    protected onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this._onPress, this, true);
        input.off(Input.EventType.TOUCH_START, this._onPress, this);
        this.unscheduleAllCallbacks();
        this._pending.length = 0;
        for (const effect of this._effects) this._recycle(effect);
    }

    protected onDestroy(): void {
        if (this._layer?.isValid) this._layer.destroy();
        this._layer = null;
        this._effects.clear();
        this._pool.length = 0;
    }
}
