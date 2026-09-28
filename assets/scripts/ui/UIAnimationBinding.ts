import { _decorator, Animation, Button, Component, EventTouch, Node } from 'cc';
import { WindowOpenAnimation, WINDOW_OPEN_CLIPS } from './WindowOpenAnimation';

const { ccclass } = _decorator;
const CLICK = 'An_BtnClik_01';

/** 在 UI 根节点捕获按下事件，覆盖静态按钮和运行时生成的列表按钮。 */
@ccclass('UIAnimationBinding')
export class UIAnimationBinding extends Component {
    private readonly _watched = new Set<Node>();

    protected onLoad(): void {
        this._watch(this.node);
        this.node.on(Node.EventType.TOUCH_START, this._onPress, this, true);
    }

    private _watch(node: Node): void {
        if (this._watched.has(node)) return;
        this._watched.add(node);
        const animation = node.getComponent(Animation);
        if (animation?.clips.some(clip => clip && WINDOW_OPEN_CLIPS.some(name => name === clip.name))) {
            animation.playOnLoad = false;
            if (!node.getComponent(WindowOpenAnimation)) node.addComponent(WindowOpenAnimation);
        }
        node.on(Node.EventType.CHILD_ADDED, this._watch, this);
        for (const child of node.children) this._watch(child);
    }

    private _onPress(event: EventTouch): void {
        let node: Node | null = event.target as Node;
        while (node) {
            const button = node.getComponent(Button);
            if (button && !button.interactable) return;
            const animation = node.getComponent(Animation);
            if (animation?.enabledInHierarchy && animation.getState(CLICK)) {
                animation.play(CLICK);
                return;
            }
            if (node === this.node) return;
            node = node.parent;
        }
    }

    protected onDestroy(): void {
        this.node.off(Node.EventType.TOUCH_START, this._onPress, this, true);
        for (const node of this._watched) {
            if (node.isValid) node.off(Node.EventType.CHILD_ADDED, this._watch, this);
        }
        this._watched.clear();
    }
}
