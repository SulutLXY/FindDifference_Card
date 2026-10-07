import { _decorator, BlockInputEvents, Input, Label, Node } from 'cc';
import { sidebarDay } from '../services/SidebarService';
import { UIScreen } from './UIScreen';

const { ccclass } = _decorator;

/** Favorites education and an independent daily return reward. */
@ccclass('FavoriteGift')
export class FavoriteGift extends UIScreen {
    private _modal: Node | null = null;
    private _status: Label | null = null;
    private _entry: Node | null = null;
    private _unsubscribe: (() => void) | null = null;
    private readonly _bindings: Array<{ node: Node; callback: () => void }> = [];

    protected start(): void {
        const lobby = this.flow.lobby?.node;
        if (lobby) this._entry = this.findChildDeep(lobby, 'CollectGame');
        if (this._entry) this._bind(this._entry, () => this._open());
        this._unsubscribe = this.flow.platform.sidebar.subscribe(() => this.refresh());
        this.refresh();
    }

    public refresh(): void {
        const day = sidebarDay();
        let storageError = false;
        if (this.flow.platform.fromFavoriteToday && !this.flow.save.hasClaimedFavorite(day)) {
            const result = this.flow.save.claimFavorite(day, 2);
            storageError = result === 'storage-error';
            if (result === 'claimed') {
                this.flow.toast('收藏进入奖励：免费提示 ×2');
                this.flow.game?.refreshHud();
            }
        }
        if (this._status) this._status.string = storageError ? '保存失败，请重新打开面板重试'
            : this.flow.save.hasClaimedFavorite(day) ? '今日已获得提示 ×2，明日再来'
                : '每日从我的收藏进入游戏，可获得提示 ×2';
    }

    private _open(): void {
        if (!this._modal) {
            this._modal = this.findChildDeep(this.node, 'ADDCollectGame');
            if (!this._modal) { this.flow.toast('收藏游戏面板尚未配置'); return; }
            if (!this._modal.getComponent(BlockInputEvents)) this._modal.addComponent(BlockInputEvents);
            this._status = this.findChildDeep(this._modal, 'Tips')?.getComponent(Label) ?? null;
            const visit = (node: Node) => {
                if (node.name === 'BtnClose') this._bind(node, () => this._close());
                for (const child of node.children) visit(child);
            };
            visit(this._modal);
        }
        this._modal.active = true;
        this._modal.setSiblingIndex(this._modal.parent!.children.length - 1);
        this.refresh();
    }

    private _bind(node: Node, callback: () => void): void {
        node.on(Input.EventType.TOUCH_END, callback, this);
        this._bindings.push({ node, callback });
    }

    private _close(): void { if (this._modal?.isValid) this._modal.active = false; }

    protected update(): void {
        if (this._entry && !this._entry.activeInHierarchy) this._close();
    }

    protected onDisable(): void { this._close(); }

    protected onDestroy(): void {
        this._close(); this._unsubscribe?.();
        for (const { node, callback } of this._bindings) {
            if (node.isValid) node.off(Input.EventType.TOUCH_END, callback, this);
        }
    }
}
