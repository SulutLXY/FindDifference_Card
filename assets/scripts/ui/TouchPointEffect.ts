import { _decorator, Component, EventTouch, input, Input, instantiate, Node, Prefab, resources, UITransform, Vec3 } from 'cc';

const { ccclass } = _decorator;

/** 全屏点击反馈：UI 捕获覆盖按钮，全局输入补充没有 UI 命中的区域。 */
@ccclass('TouchPointEffect')
export class TouchPointEffect extends Component {
    /** 由 GameFlow 注入音效播放，统一遵循音效设置。 */
    public playClickSound: (() => void) | null = null;
    private _prefab: Prefab | null = null;
    private _layer: Node | null = null;
    private readonly _handled = new WeakSet<EventTouch>();
    private readonly _pending: Vec3[] = [];
    private readonly _effects = new Set<Node>();

    protected onLoad(): void {
        const layer = new Node('TouchPointEffects');
        layer.layer = this.node.layer;
        layer.addComponent(UITransform);
        this.node.addChild(layer);
        this._layer = layer;
        resources.load('prefabs/TouchPoint', Prefab, (error, prefab) => {
            if (!this.isValid) return;
            if (error) {
                this._pending.length = 0;
                console.error('[TouchPointEffect] TouchPoint 预设加载失败', error);
                return;
            }
            this._prefab = prefab;
            if (this.enabledInHierarchy) {
                for (const position of this._pending) this._spawn(position);
            }
            this._pending.length = 0;
        });
    }

    protected onEnable(): void {
        this.node.on(Node.EventType.TOUCH_START, this._onPress, this, true);
        input.on(Input.EventType.TOUCH_START, this._onPress, this);
    }

    private _onPress(event: EventTouch): void {
        // Cocos 已将鼠标按下转换为 TOUCH_START；不再额外监听 MOUSE_DOWN。
        if (this._handled.has(event)) return;
        this._handled.add(event);
        this.playClickSound?.();
        const layer = this._layer;
        const transform = layer?.getComponent(UITransform);
        if (!layer || !transform) return;
        layer.setSiblingIndex(this.node.children.length - 1);
        const location = event.getUILocation();
        const position = transform.convertToNodeSpaceAR(new Vec3(location.x, location.y, 0));
        if (this._prefab) this._spawn(position);
        else this._pending.push(position);
    }

    private _spawn(position: Vec3): void {
        if (!this._prefab || !this._layer) return;
        const effect = instantiate(this._prefab);
        effect.setPosition(position);
        this._layer.addChild(effect);
        // 预设内的 Animation.playOnLoad 自动播放，每次按下使用独立实例。
        this._effects.add(effect);
        this.scheduleOnce(() => {
            this._effects.delete(effect);
            if (effect.isValid) effect.destroy();
        }, 1);
    }

    protected onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this._onPress, this, true);
        input.off(Input.EventType.TOUCH_START, this._onPress, this);
        this.unscheduleAllCallbacks();
        this._pending.length = 0;
        for (const effect of this._effects) {
            if (effect.isValid) effect.destroy();
        }
        this._effects.clear();
    }

    protected onDestroy(): void {
        if (this._layer?.isValid) this._layer.destroy();
        this._layer = null;
    }
}
