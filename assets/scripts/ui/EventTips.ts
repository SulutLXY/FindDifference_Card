import { _decorator, BlockInputEvents, Button, EventTouch, Label, Node, UITransform } from 'cc';
import { CityConfig } from '../core/GameTypes';
import { UIScreen } from './UIScreen';

const { ccclass } = _decorator;

/** 场景 Canvas/EventTips：单关/整章解锁确认，未完成的整章进度只属于本次弹窗。 */
@ccclass('EventTips')
export class EventTips extends UIScreen {
    private _city: CityConfig | null = null;
    private _levelIndex = -1;
    private _watched = 0;
    private _pending = false;
    private _session = 0;
    private _resolve: ((unlocked: boolean) => void) | null = null;
    private _card: Node | null = null;

    protected onLoad(): void {
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        this._card = this.resolveNode(null, 'ResultCard');
        this.wireButton(null, 'BtnClose', () => this.close());
        this.wireButton(null, 'ResultCard/BtnUnlock', () => { void this._unlockSingle(); });
        this.wireButton(null, 'ResultCard/BtnUnlockAll', () => { void this._unlockAll(); });
        // 捕获遮罩点击；面板内留给按钮处理，背景点击关闭且不穿透选关卡片。
        this.node.on(Node.EventType.TOUCH_END, this._onOutsideTap, this, true);
    }

    public present(city: CityConfig, levelIndex: number): Promise<boolean> {
        if (this._resolve) return Promise.resolve(false);
        this._city = city;
        this._levelIndex = levelIndex;
        this._watched = 0;
        this._pending = false;
        ++this._session;
        return new Promise(resolve => {
            this._resolve = resolve;
            this.open();
            this.node.setSiblingIndex(this.node.parent!.children.length - 1);
            this._refresh();
        });
    }

    public close(): void { this._finish(false); }

    private _settle(unlocked: boolean): void {
        const done = this._resolve;
        this._resolve = null;
        this._city = null;
        this._levelIndex = -1;
        this._watched = 0;
        this._pending = false;
        ++this._session;
        done?.(unlocked);
    }

    private _finish(unlocked: boolean): void {
        this._settle(unlocked);
        super.close();
    }

    protected onDisable(): void {
        this._settle(false);
        super.onDisable();
    }

    protected onDestroy(): void {
        this._settle(false);
        this.node.off(Node.EventType.TOUCH_END, this._onOutsideTap, this, true);
        super.onDestroy();
    }

    private _onOutsideTap(event: EventTouch): void {
        const card = this._card?.getComponent(UITransform);
        if (card?.hitTest(event.getLocation(), event.windowId)) return;
        event.propagationStopped = true;
        this.close();
    }

    private _active(session: number): boolean {
        return this.isValid && this.node.activeInHierarchy && this._session === session
            && this._city !== null && this.flow.currentCity === this._city;
    }

    private _refresh(): void {
        this.setLabel(null, 'ResultCard/label', `观看1个视频解锁第${this._levelIndex + 1}关\n观看3个视频解锁本章全部关卡\n关闭弹窗后，未完成进度清零`);
        this.setLabel(null, 'ResultCard/BtnUnlock/Label', this._pending ? '请稍候…' : '看1个视频解锁');
        this.setLabel(null, 'ResultCard/BtnUnlockAll/Label', this._pending ? '请稍候…'
            : this._watched >= 3 ? '重试保存解锁' : `全部解锁（${this._watched}/3）`);
        for (const name of ['ResultCard/label', 'ResultCard/BtnUnlock/Label', 'ResultCard/BtnUnlockAll/Label']) {
            const label = this.resolveLabel(null, name);
            if (label) label.overflow = Label.Overflow.SHRINK;
        }
        for (const name of ['ResultCard/BtnUnlock', 'ResultCard/BtnUnlockAll']) {
            const button = this.resolveNode(null, name)?.getComponent(Button);
            if (button) button.interactable = !this._pending;
        }
    }

    private async _unlockSingle(): Promise<void> {
        if (this._pending || !this._city || !this._active(this._session)) return;
        const session = this._session;
        const city = this._city;
        this._pending = true;
        this._refresh();
        try {
            const unlocked = await this.flow.watchLevelUnlockVideo(city, this._levelIndex);
            if (this._active(session) && unlocked) this._finish(true);
        } finally {
            if (this._active(session)) { this._pending = false; this._refresh(); }
        }
    }

    private async _unlockAll(): Promise<void> {
        if (this._pending || !this._city || !this._active(this._session)) return;
        const session = this._session;
        const city = this._city;
        this._pending = true;
        this._refresh();
        try {
            if (this._watched < 3) {
                const completed = await this.flow.watchChapterUnlockVideo(city);
                // 关闭或切章后回来的广告结果不能计入新弹窗，也不能授予整章资格。
                if (!this._active(session) || !completed) return;
                ++this._watched;
            }
            if (this._watched === 3) {
                if (this.flow.save.unlockLevels(city.levels.map(dir => `${city.key}/${dir}`))) {
                    this._finish(true);
                } else {
                    // 三次已完成，保留本次计数；重试存档不再要求额外观看。
                    this.flow.toast('章节解锁保存失败，请点击重试');
                }
            }
        } finally {
            if (this._active(session)) { this._pending = false; this._refresh(); }
        }
    }
}
