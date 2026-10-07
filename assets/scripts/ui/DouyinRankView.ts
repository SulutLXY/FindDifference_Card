import { _decorator, Component, EventTouch, Label, Node, SubContextView, UITransform, Vec3 } from 'cc';
import { createNpcRankPool } from '../services/rank/NpcRankPool';
import type { PlayerProfile } from '../services/PlayerInfoService';
import type { RankTab } from '../services/rank/RankProvider';

const { ccclass } = _decorator;

/** 只向开放域发消息；其他玩家的资料始终留在开放域画布内。 */
@ccclass('DouyinRankView')
export class DouyinRankView extends Component {
    private _context: any = null;
    private _view: Node | null = null;
    private _list: Node | null = null;
    private _hidden: Node[] = [];

    public initialize(list: Node): boolean {
        try {
            const tt = (globalThis as any).tt;
            if (typeof tt?.getOpenDataContext !== 'function') return false;
            this._context = tt.getOpenDataContext();
            if (!this._context?.canvas || typeof this._context.postMessage !== 'function') return false;
            this._list = list;
            const rootUI = this.node.getComponent(UITransform)!;
            const overlay = new Node('DouyinRankCanvas');
            overlay.layer = this.node.layer;
            overlay.active = false;
            const ui = overlay.addComponent(UITransform);
            ui.setContentSize(rootUI.contentSize);
            ui.setAnchorPoint(rootUI.anchorPoint);
            this.node.addChild(overlay);
            const view = overlay.addComponent(SubContextView);
            // 配置在组件首次 onLoad 前完成，避免使用默认640×960导致画布留白。
            view.designResolutionSize.set(rootUI.width, rootUI.height);
            view.fps = 15;
            this._view = overlay;
            list.on(Node.EventType.TOUCH_MOVE, this._onMove, this, true);
            return true;
        } catch (error) {
            console.warn('[DouyinRankView] 开放域初始化失败', error);
            this.hide();
            return false;
        }
    }

    private _rect(node: Node): { x: number; y: number; width: number; height: number; fontSize?: number; bold?: boolean; color?: string } {
        const root = this.node.getComponent(UITransform)!;
        const ui = node.getComponent(UITransform)!;
        const corners = [new Vec3(-ui.width * ui.anchorX, -ui.height * ui.anchorY),
            new Vec3(ui.width * (1 - ui.anchorX), ui.height * (1 - ui.anchorY))]
            .map(point => root.convertToNodeSpaceAR(ui.convertToWorldSpaceAR(point)));
        const label = node.getComponent(Label);
        return { x: corners[0].x + root.width * root.anchorX,
            y: root.height * (1 - root.anchorY) - corners[1].y,
            width: corners[1].x - corners[0].x, height: corners[1].y - corners[0].y,
            fontSize: label?.fontSize, bold: label?.isBold,
            color: label ? '#' + [label.color.r, label.color.g, label.color.b].map(value => value.toString(16).padStart(2, '0')).join('') : undefined };
    }

    public show(tab: RankTab, passed: number, profile: PlayerProfile | null, message = ''): void {
        if (!this._view || !this._list) return;
        this._view.active = true;
        this._view.setSiblingIndex(this.node.children.length - 1);
        const footer = this.node.getChildByName('MyRank');
        const fields: Record<string, unknown> = {};
        for (const [field, name] of [['rank', 'Rank'], ['score', 'Label-001'], ['name', 'playerName'], ['avatar', 'Icon _head']]) {
            const node = footer?.getChildByName(name);
            if (!node) continue;
            fields[field] = this._rect(node);
            if (node.active) { node.active = false; this._hidden.push(node); }
        }
        this._context.postMessage({ type: 'rank', action: 'show', tab, passed, profile,
            width: this.node.getComponent(UITransform)!.width,
            height: this.node.getComponent(UITransform)!.height,
            list: this._rect(this._list), fields, npcPool: createNpcRankPool(), message });
    }

    public updateProfile(profile: PlayerProfile | null): void {
        this._context?.postMessage({ type: 'rank', action: 'profile', profile });
    }

    private _onMove(event: EventTouch): void {
        if (this._view?.active) this._context?.postMessage({ type: 'rank', action: 'scroll', delta: event.getUIDelta().y });
    }

    public hide(): void {
        this._context?.postMessage({ type: 'rank', action: 'hide' });
        if (this._view) this._view.active = false;
        for (const node of this._hidden) if (node.isValid) node.active = true;
        this._hidden.length = 0;
    }

    protected onDestroy(): void {
        this._list?.off(Node.EventType.TOUCH_MOVE, this._onMove, this, true);
        this.hide();
        if (this._view?.isValid) this._view.destroy();
    }
}
