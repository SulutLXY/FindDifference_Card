import { _decorator, BlockInputEvents, Color, Graphics, Input, Label, Node, UITransform } from 'cc';
import { SidebarService, sidebarDay } from '../services/SidebarService';
import { UIScreen } from './UIScreen';

const { ccclass } = _decorator;
const INK = new Color(113, 68, 29);
const CREAM = new Color(255, 249, 228);
const BLUE = new Color(51, 155, 245);

/** First-pass gift UI mounted on the user's Lobby/Gameflow anchor. */
@ccclass('SidebarGift')
export class SidebarGift extends UIScreen {
    private _entry: Label | null = null;
    private _modal: Node | null = null;
    private _status: Label | null = null;
    private _action: Label | null = null;
    private _inventory: Label | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _returnPending = false;

    protected onLoad(): void {
        this.node.getComponent(UITransform)!.setContentSize(150, 100);
        this._box(this.node, 150, 100, CREAM);
        this._entry = this._label(this.node, 'GiftLabel', '每日福利', 138, 80, 25, 0);
        this.node.on(Input.EventType.TOUCH_END, this._openGift, this);
        this._unsubscribe = this.flow.platform.sidebar.subscribe(() => {
            if (!this.isValid) return;
            this.refresh();
            if (this._returnPending && this.flow.platform.sidebar.fromSidebarToday
                && this.node.activeInHierarchy) {
                this._returnPending = false;
                this._openGift();
            }
        });
        this.schedule(() => this.refresh(), 1);
        this.refresh();
    }

    public refresh(): void {
        const sidebar = this.flow.platform.sidebar;
        this.node.active = sidebar.supported;
        const claimed = this.flow.save.hasClaimedSidebar(sidebarDay());
        if (this._entry) this._entry.string = claimed ? '每日福利\n已领取'
            : sidebar.fromSidebarToday ? '每日福利\n可领取' : `每日福利\n提示 ×${SidebarService.HINT_REWARD}`;
        if (this._status) this._status.string = claimed ? '今日已领取，明日再来'
            : sidebar.fromSidebarToday ? '已从侧边栏进入，可以领取啦！' : '每天从首页侧边栏进入，即可领取';
        if (this._action) this._action.string = claimed ? '今日已领取'
            : sidebar.navigating ? '正在打开…' : sidebar.fromSidebarToday ? '领取奖励' : '去首页侧边栏';
        if (this._inventory) this._inventory.string = `当前免费提示：${this.flow.save.freeHints} 次`;
    }

    private _openGift(): void {
        if (!this.flow.platform.sidebar.supported) return;
        if (!this._modal) this._createModal();
        this._modal!.active = true;
        this._modal!.setSiblingIndex(this._modal!.parent!.children.length - 1);
        this.refresh();
    }

    private _closeGift(): void { if (this._modal) this._modal.active = false; }

    private async _performAction(): Promise<void> {
        const sidebar = this.flow.platform.sidebar;
        if (sidebar.navigating || this.flow.save.hasClaimedSidebar(sidebarDay())) return;
        if (sidebar.fromSidebarToday) {
            this.flow.claimSidebarReward();
            this.refresh();
            return;
        }
        this._returnPending = true;
        this._closeGift();
        const result = await sidebar.navigate();
        if (!this.isValid) return;
        if (!result.success) {
            this._returnPending = false;
            if (this.node.activeInHierarchy) this._openGift();
            this.flow.toast(result.reason ?? '请稍后重试');
        }
    }

    private _createModal(): void {
        const modal = this._node(this.node.parent!, 'SidebarGiftModal', 2000, 3000);
        modal.addComponent(BlockInputEvents);
        const dimmer = modal.addComponent(Graphics);
        dimmer.fillColor = new Color(0, 0, 0, 165);
        dimmer.rect(-1000, -1500, 2000, 3000);
        dimmer.fill();
        const panel = this._node(modal, 'GiftCard', 600, 580);
        this._box(panel, 600, 580, CREAM);
        this._label(panel, 'Title', '首页侧边栏福利', 480, 60, 34, 220);
        this._label(panel, 'Reward', `每日免费提示 ×${SidebarService.HINT_REWARD}`, 510, 60, 32, 130);
        this._label(panel, 'Steps', '1. 点击「去首页侧边栏」\n2. 在侧边栏找到本游戏并点击进入\n3. 返回游戏，领取免费提示', 530, 135, 25, 20);
        this._status = this._label(panel, 'Status', '', 540, 60, 23, -90);
        const action = this._node(panel, 'ClaimOrNavigate', 420, 76);
        action.setPosition(0, -175);
        this._box(action, 420, 76, BLUE);
        this._action = this._label(action, 'Label', '', 400, 68, 28, 0);
        this._action.color = Color.WHITE;
        action.on(Input.EventType.TOUCH_END, () => { void this._performAction(); }, this);
        this._inventory = this._label(panel, 'Inventory', '', 510, 44, 23, -244);
        const close = this._node(panel, 'Close', 64, 64);
        close.setPosition(257, 250);
        this._label(close, 'Label', '×', 60, 60, 40, 0);
        close.on(Input.EventType.TOUCH_END, this._closeGift, this);
        this._modal = modal;
    }

    private _node(parent: Node, name: string, width: number, height: number): Node {
        const node = new Node(name);
        node.layer = parent.layer;
        node.parent = parent;
        node.addComponent(UITransform).setContentSize(width, height);
        return node;
    }

    private _box(node: Node, width: number, height: number, color: Color): void {
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = color;
        graphics.strokeColor = INK;
        graphics.lineWidth = 3;
        graphics.roundRect(-width / 2, -height / 2, width, height, 16);
        graphics.fill();
        graphics.stroke();
    }

    private _label(parent: Node, name: string, text: string, width: number, height: number,
        fontSize: number, y: number): Label {
        const node = this._node(parent, name, width, height);
        node.setPosition(0, y);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 9;
        label.color = INK;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        return label;
    }

    protected onDisable(): void { this._closeGift(); }

    protected onDestroy(): void {
        this._unsubscribe?.();
        if (this._modal?.isValid) this._modal.destroy();
    }
}
