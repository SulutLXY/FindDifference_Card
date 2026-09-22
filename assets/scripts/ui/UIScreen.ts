import { Color, Component, Input, Label, Node, warn } from 'cc';
import type { GameFlow } from '../GameFlow';

/** 界面通用配色，供标记绘制、降级控件等运行时代码使用。 */
export const UIColors = {
    background: new Color(17, 48, 91, 255),
    panel: new Color(24, 82, 148, 255),
    panelDark: new Color(12, 43, 84, 255),
    blue: new Color(42, 137, 225, 255),
    gold: new Color(249, 177, 34, 255),
    goldDark: new Color(166, 91, 13, 255),
    red: new Color(225, 67, 63, 255),
    white: new Color(250, 247, 232, 255),
    muted: new Color(150, 178, 207, 255),
    overlay: new Color(4, 16, 34, 220),
} as const;

let currentFlow: GameFlow | null = null;

/**
 * 由 GameFlow.onLoad 调用，注册全局流程实例。
 * 使用注册表而非直接引用，避免 GameFlow 与界面组件之间的模块循环依赖。
 */
export function registerGameFlow(flow: GameFlow): void {
    currentFlow = flow;
}

/**
 * 界面基类：所有 Screen 组件继承此类。
 *
 * 节点绑定约定（二选一）：
 * 1. 在 Inspector 中将节点/Label 拖拽到组件对应属性上；
 * 2. 不按属性拖拽时，组件会按命名规则在自身子树中自动查找（属性面板有各路径提示）。
 *
 * 子类在 onLoad 中接线事件，在 onOpen 中刷新动态内容。
 */
export abstract class UIScreen extends Component {
    protected get flow(): GameFlow {
        if (!currentFlow) {
            throw new Error('[UIScreen] GameFlow 尚未注册，请确认场景中存在带 GameFlow 组件的节点');
        }
        return currentFlow;
    }

    public open(): void {
        this.node.active = true;
        this.onOpen();
    }

    public close(): void {
        this.node.active = false;
        this.onClose();
    }

    protected onOpen(): void {}

    protected onClose(): void {}

    /** 解析节点：优先使用 Inspector 绑定，其次按命名规则在子树中查找。 */
    protected resolveNode(bound: Node | null, path: string): Node | null {
        if (bound && bound.isValid) return bound;
        const found = this._findByPath(this.node, path);
        if (!found) {
            warn(`[${this.constructor.name}] 节点未绑定且未找到「${path}」，请在 Inspector 拖拽或按命名规则创建`);
        }
        return found;
    }

    /** 解析 Label：规则同 resolveNode。 */
    protected resolveLabel(bound: Label | null, path: string): Label | null {
        if (bound && bound.isValid) return bound;
        const node = this._findByPath(this.node, path);
        const label = node?.getComponent(Label) ?? null;
        if (!label) {
            warn(`[${this.constructor.name}] Label 未绑定且未找到「${path}」`);
        }
        return label;
    }

    /** 设置 Label 文本，节点缺失时静默跳过。 */
    protected setLabel(bound: Label | null, path: string, text: string): void {
        const label = this.resolveLabel(bound, path);
        if (label) label.string = text;
    }

    /** 为按钮节点绑定点击事件（节点缺失时仅告警）。 */
    protected wireButton(bound: Node | null, path: string, callback: () => void): void {
        const node = this.resolveNode(bound, path);
        node?.on(Input.EventType.TOUCH_END, callback, this);
    }

    private _findByPath(root: Node, path: string): Node | null {
        let current: Node | null = root;
        for (const segment of path.split('/')) {
            if (!current) return null;
            current = current.getChildByName(segment);
        }
        return current;
    }
}
