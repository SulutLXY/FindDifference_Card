import { _decorator, BlockInputEvents, Color, EventTouch, Graphics, Input, Label, Node, UITransform, Vec2, view } from 'cc';
import { UIScreen } from './UIScreen';
import { SidebarGift } from './SidebarGift';

const { ccclass } = _decorator;

/** Bind designed lobby anchors without changing their text, size or position. */
@ccclass('LobbyEntries')
export class LobbyEntries extends UIScreen {
    private _panel: Node | null = null;
    private _subscribeButton: Node | null = null;
    private readonly _bindings: Array<{ node: Node; callback: () => void }> = [];
    private _nativeBound = false;
    private _subscriptionModal: Node | null = null;
    private _subscriptionStatus: Label | null = null;
    private _subscriptionBusy = false;
    private _subscriptionChecking = false;
    private _subscriptionVersion = 0;
    private _caller: Node | null = null;
    private _gift: SidebarGift | null = null;

    protected start(): void {
        const lobby = this.flow.lobby?.node ?? this.node;
        const group = this.findChildDeep(lobby, 'Gameflow');
        const gift = group?.getChildByName('Gameflow');
        const rewardEntry = gift ?? group;
        if (rewardEntry) {
            rewardEntry.active = true;
            if (!rewardEntry.getComponent(SidebarGift)) rewardEntry.addComponent(SidebarGift);
            this._gift = rewardEntry.getComponent(SidebarGift);
        }
        this._bind('Subscription', () => { this._caller = lobby; void this._openSubscription(); }, lobby);
        this._bind('AddDesktop', () => { this._caller = lobby; this._openDesktop(); }, lobby);
        const visit = (node: Node) => {
            if (node.name === 'moneyTool') {
                this._bind('Gameflow', () => { this._caller = node; this._gift?.openGift(node); }, node);
                this._bind('Subscription', () => { this._caller = node; void this._openSubscription(); }, node);
                this._bind('AddDesktop', () => { this._caller = node; this._openDesktop(); }, node);
                return;
            }
            for (const child of node.children) visit(child);
        };
        visit(this.node);
        this._bind('Shar', () => {
            if (this.flow.platform.isPcCompanion) this.flow.toast('请在手机抖音中分享游戏');
            else this.flow.share();
        }, lobby);
        this._bind('LiveStreamingCompanion', () => { this._caller = lobby; this._open('PC 直播伴侣', [],
            this.flow.platform.isPcCompanion ? '当前正在 PC 直播伴侣中运行，可直接开始挑战'
                : '主播请在电脑的抖音直播伴侣「游戏玩法」中启动本游戏'); }, lobby);
        const tt = (globalThis as any).tt;
        if (typeof tt?.onTouchEnd === 'function' && typeof tt?.offTouchEnd === 'function') {
            tt.onTouchEnd(this._nativeTouchEnd);
            this._nativeBound = true;
        }
        this.flow.platform.prepareFeedLogin();
    }

    protected update(): void {
        if (this._caller && (!this._caller.isValid || !this._caller.activeInHierarchy)) {
            this._close(); this._closeSubscription(); this._gift?.closeGift(); this._caller = null;
        }
    }

    private _openDesktop(): void {
        this._perform(this.flow.platform.addDesktop());
    }

    /** Native synchronous callback required by full-scene Feed subscriptions. */
    private readonly _nativeTouchEnd = (event: any): void => {
        const button = this._subscribeButton;
        if (!button?.isValid || !button.activeInHierarchy || !this.node.activeInHierarchy) return;
        const tt = (globalThis as any).tt;
        let dpr = 1;
        try { dpr = tt.getSystemInfoSync?.().pixelRatio || 1; } catch { return; }
        const ui = button.getComponent(UITransform);
        if (!ui) return;
        for (const point of event.changedTouches ?? []) {
            const x = point.clientX ?? point.x;
            const y = point.clientY ?? point.y;
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            // Match the engine's native screen coordinates, including the UI camera and masks.
            const location = new Vec2(x * dpr, (view.getFrameSize().height - y) * dpr);
            if (ui.hitTest(location)) {
                this._requestSubscription();
                break;
            }
        }
    };

    private async _openSubscription(): Promise<void> {
        this._close();
        let root = this.node;
        while (root.parent) root = root.parent;
        if (!this._subscriptionModal) {
            this._subscriptionModal = this.findChildDeep(root, 'ADDSubscription');
            if (!this._subscriptionModal) { this.flow.toast('订阅面板尚未配置'); return; }
            const modal = this._subscriptionModal;
            if (!modal.getComponent(BlockInputEvents)) modal.addComponent(BlockInputEvents);
            this._subscribeButton = this.findChildDeep(modal, 'BtnReview');
            this._subscriptionStatus = this.findChildDeep(modal, 'Tips')?.getComponent(Label) ?? null;
            const bind = (node: Node, callback: () => void) => {
                node.on(Input.EventType.TOUCH_END, callback, this);
                this._bindings.push({ node, callback });
            };
            const visit = (node: Node) => {
                if (node.name === 'BtnClose') bind(node, () => this._closeSubscription());
                for (const child of node.children) visit(child);
            };
            visit(modal);
            if (this._subscribeButton) bind(this._subscribeButton, () => {
                if (!this._nativeBound) this._requestSubscription();
            });
        }
        this._subscriptionModal.active = true;
        this._subscriptionModal.setSiblingIndex(this._subscriptionModal.parent!.children.length - 1);
        const version = ++this._subscriptionVersion;
        this._subscriptionChecking = true;
        this._refreshSubscription('正在查询订阅状态…');
        const message = await this.flow.platform.checkFeedStatus();
        if (!this.isValid || version !== this._subscriptionVersion || !this._subscriptionModal?.active) return;
        this._subscriptionChecking = false;
        this._refreshSubscription(message ?? undefined);
        if (message) this.flow.toast(message);
    }

    private _refreshSubscription(message?: string): void {
        const subscribed = this.flow.platform.feedSubscribed === true;
        if (this._subscriptionStatus) {
            this._subscriptionStatus.node.active = subscribed;
            this._subscriptionStatus.string = '已完成订阅';
        }
        if (this._subscribeButton) this._subscribeButton.active = !subscribed;
        const label = this._subscribeButton?.getComponentInChildren(Label);
        if (label) label.string = this._subscriptionBusy ? '订阅中…' : '去订阅';
    }

    private _requestSubscription(): void {
        if (this._subscriptionBusy) return;
        if (this.flow.platform.feedSubscribed === true) { this.flow.toast('已完成订阅'); return; }
        // A slow status query must neither swallow the click nor overwrite its result.
        ++this._subscriptionVersion;
        this._subscriptionChecking = false;
        this._subscriptionBusy = true;
        // Invoke before any await, while still inside the native user gesture.
        const result = this.flow.platform.subscribeFeed();
        this._refreshSubscription();
        void result.then(message => {
            if (!this.isValid) return;
            this._subscriptionBusy = false;
            this._refreshSubscription(message);
            this.flow.toast(message);
        });
    }

    private _closeSubscription(): void {
        ++this._subscriptionVersion;
        if (this._subscriptionModal?.isValid) this._subscriptionModal.active = false;
    }

    private _bind(name: string, callback: () => void, root: Node = this.node): void {
        const node = this.findChildDeep(root, name);
        if (!node) return;
        node.on(Input.EventType.TOUCH_END, callback, this);
        this._bindings.push({ node, callback });
    }

    private _perform(result: Promise<string>): void {
        void result.then(message => { if (this.isValid) this.flow.toast(message); });
    }

    private _open(title: string, actions: Array<[string, () => void]>, note = ''): void {
        this._closeSubscription();
        this._close();
        const panel = this._make(this.node, 'LobbyEntryModal', 2000, 3000);
        panel.addComponent(BlockInputEvents);
        this._fill(panel, 2000, 3000, new Color(0, 0, 0, 160));
        const card = this._make(panel, 'Card', 600, 460);
        this._fill(card, 600, 460, new Color(255, 249, 228));
        this._text(card, 'Title', title, 165, 32);
        if (note) this._text(card, 'Note', note, 60, 25);
        actions.forEach(([text, callback], index) => {
            const button = this._make(card, `Action${index}`, 430, 74);
            button.setPosition(0, actions.length === 1 ? -45 : 40 - index * 100);
            this._fill(button, 430, 74, new Color(51, 155, 245));
            this._text(button, 'Label', text, 0, 28);
            button.on(Input.EventType.TOUCH_END, (event: EventTouch) => { event.propagationStopped = true; callback(); }, this);
        });
        const close = this._make(card, 'Close', 430, 64);
        close.setPosition(0, -165);
        this._text(close, 'Label', '关闭', 0, 26);
        close.on(Input.EventType.TOUCH_END, () => this._close(), this);
        this._panel = panel;
    }

    private _make(parent: Node, name: string, width: number, height: number): Node {
        const node = new Node(name); node.layer = parent.layer; node.parent = parent;
        node.addComponent(UITransform).setContentSize(width, height);
        return node;
    }
    private _fill(node: Node, width: number, height: number, color: Color): void {
        const graphics = node.addComponent(Graphics); graphics.fillColor = color;
        graphics.roundRect(-width / 2, -height / 2, width, height, 16); graphics.fill();
    }
    private _text(parent: Node, name: string, value: string, y: number, size: number): void {
        const node = this._make(parent, name, 540, 100); node.setPosition(0, y);
        const label = node.addComponent(Label); label.string = value; label.fontSize = size; label.lineHeight = size + 8;
        label.color = new Color(113, 68, 29); label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER; label.overflow = Label.Overflow.SHRINK;
    }
    private _close(): void {
        if (this._panel?.isValid) { this._panel.active = false; this._panel.destroy(); }
        this._panel = null;
    }
    protected onDisable(): void { this._close(); this._closeSubscription(); }
    protected onDestroy(): void {
        this._close();
        this._closeSubscription();
        for (const { node, callback } of this._bindings) if (node.isValid) node.off(Input.EventType.TOUCH_END, callback, this);
        if (this._nativeBound) (globalThis as any).tt?.offTouchEnd?.(this._nativeTouchEnd);
    }
}
