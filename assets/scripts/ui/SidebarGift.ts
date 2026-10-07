import { _decorator, BlockInputEvents, Input, Label, Node } from 'cc';
import { sidebarDay } from '../services/SidebarService';
import { UIScreen } from './UIScreen';

const { ccclass } = _decorator;

/** Single sidebar reward entry backed by the designed ADDGameflow panel. */
@ccclass('SidebarGift')
export class SidebarGift extends UIScreen {
    private _modal: Node | null = null;
    private _status: Label | null = null;
    private _action: Label | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _returnPending = false;
    private _designedAction: Node | null = null;
    private readonly _modalBindings: Array<{ node: Node; callback: () => void }> = [];

    private _caller: Node | null = null;
    public openGift(caller: Node = this.node): void { this._caller = caller; this._openGift(); }
    public closeGift(): void { this._closeGift(); this._caller = null; }

    private get _callerVisible(): boolean { return (this._caller ?? this.node).activeInHierarchy; }

    protected onLoad(): void {
        this.node.on(Input.EventType.TOUCH_END, this._openGift, this);
        this._unsubscribe = this.flow.platform.sidebar.subscribe(() => {
            if (!this.isValid) return;
            this.refresh();
            if (this._returnPending && this.flow.platform.sidebar.fromSidebarToday
                && this._callerVisible) {
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
        if (this._status) this._status.string = claimed ? '今日已领取，明日再来'
            : sidebar.fromSidebarToday ? '已从侧边栏进入，可以领取啦！' : '每天从首页侧边栏进入，即可领取';
        if (this._action) this._action.string = claimed ? '今日已领取'
            : sidebar.navigating ? '正在打开…' : sidebar.fromSidebarToday ? '领取奖励' : '去侧边栏';
        if (this._designedAction) this._designedAction.active = !claimed;
    }

    private _openGift(): void {
        if (!this.flow.platform.sidebar.supported) return;
        if (!this._modal) this._createModal();
        if (!this._modal) { this.flow.toast('入口有奖面板尚未配置'); return; }
        this._modal.active = true;
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
            if (this._callerVisible) this._openGift();
            this.flow.toast(result.reason ?? '请稍后重试');
        }
    }

    private _createModal(): void {
        let root = this.node;
        while (root.parent) root = root.parent;
        const designed = this.findChildDeep(root, 'ADDGameflow');
        if (designed) {
            this._modal = designed;
            if (!designed.getComponent(BlockInputEvents)) designed.addComponent(BlockInputEvents);
            this._status = this.findChildDeep(designed, 'Tips')?.getComponent(Label) ?? null;
            if (this._status) {
                this._status.fontSize = 22; this._status.lineHeight = 26;
                this._status.isItalic = false; this._status.isUnderline = false;
            }
            const title = this.findChildDeep(designed, 'RewardTitle');
            if (title) title.active = false;
            this._designedAction = this.findChildDeep(designed, 'BtnReview');
            this._action = this._designedAction?.getComponentInChildren(Label) ?? null;
            const bind = (node: Node, callback: () => void) => {
                node.on(Input.EventType.TOUCH_END, callback, this);
                this._modalBindings.push({ node, callback });
            };
            const visit = (node: Node) => {
                if (node.name === 'BtnClose') bind(node, () => this._closeGift());
                for (const child of node.children) visit(child);
            };
            visit(designed);
            if (this._designedAction) bind(this._designedAction, () => { void this._performAction(); });
            const step = this.findChildDeep(designed, 'Title-003')?.getComponent(Label);
            if (step) step.string = '第三步：领取奖励';
            return;
        }
    }

    protected onDisable(): void { this._closeGift(); }

    protected onDestroy(): void {
        this._unsubscribe?.();
        for (const { node, callback } of this._modalBindings) {
            if (node.isValid) node.off(Input.EventType.TOUCH_END, callback, this);
        }
        this.node.off(Input.EventType.TOUCH_END, this._openGift, this);
        this._closeGift();
    }
}
