import { _decorator, BlockInputEvents, Input, Label, Node } from 'cc';
import { sidebarDay } from '../services/SidebarService';
import { UIScreen } from './UIScreen';

const { ccclass } = _decorator;

/** 官方收藏入口、不可用时的教学引导，以及独立的每日收藏回访奖励。 */
@ccclass('FavoriteGift')
export class FavoriteGift extends UIScreen {
    private _modal: Node | null = null;
    private _status: Label | null = null;
    private _entry: Node | null = null;
    private _favoritePending = false;
    private _favoriteRequest = 0;
    private _favoriteCaller: Node | null = null;
    private _unsubscribe: (() => void) | null = null;
    private readonly _bindings: Array<{ node: Node; callback: () => void }> = [];

    protected start(): void {
        this.bindLobby();
        this._unsubscribe = this.flow.platform.sidebar.subscribe(() => this.refresh());
        this.refresh();
    }

    public bindLobby(): void {
        const lobby = this.flow.lobby?.node;
        const entry = lobby ? this.findChildDeep(lobby, 'CollectGame') : null;
        if (entry && entry !== this._entry) { this._entry = entry; this._bind(entry, () => this._requestFavorite()); }
    }

    private _requestFavorite(): void {
        if (this._favoritePending) return;
        const entry = this._entry;
        if (!entry?.isValid || !entry.activeInHierarchy) return;
        this._favoritePending = true;
        this._favoriteCaller = entry;
        const request = ++this._favoriteRequest;
        const active = () => this.isValid && this.node.activeInHierarchy && entry.isValid
            && entry.activeInHierarchy && this._entry === entry && request === this._favoriteRequest;
        let guideShown = false;
        this._close();
        // 不等待登录、动画或定时器，保留本次用户点击的同步调用链。
        void this.flow.platform.favoriteGame(() => { guideShown = true; }).then(message => {
            if (!active()) return;
            this.flow.toast(message);
            // 未收藏也属于正常回调，不再追加第二个弹窗。
            if (!guideShown) this._open();
        }).catch(() => {
            if (!active()) return;
            this.flow.toast('收藏暂不可用，请按引导手动收藏');
            this._open();
        }).finally(() => {
            this._favoritePending = false;
            this._favoriteCaller = null;
        });
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
        const handler = this.buttonTouchHandler(node, callback);
        node.on(Input.EventType.TOUCH_END, handler, this);
        this._bindings.push({ node, callback: handler });
    }

    private _close(): void { if (this._modal?.isValid) this._modal.active = false; }

    protected update(): void {
        if (this._entry && !this._entry.activeInHierarchy) this._close();
        if (this._favoriteCaller && !this._favoriteCaller.activeInHierarchy) {
            this._favoriteCaller = null;
            this._favoriteRequest++;
        }
    }

    protected onDisable(): void { this._favoriteRequest++; this._close(); }

    protected onDestroy(): void {
        this._favoriteRequest++;
        this._close(); this._unsubscribe?.();
        for (const { node, callback } of this._bindings) {
            if (node.isValid) node.off(Input.EventType.TOUCH_END, callback, this);
        }
    }
}
