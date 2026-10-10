import { _decorator, BlockInputEvents, Color, EventTouch, instantiate, Label, Node, Sprite, UITransform, Vec3 } from 'cc';
import { FoodDetails } from '../core/GameTypes';
import { UIScreen } from './UIScreen';
const { ccclass } = _decorator;

@ccclass('FoodTips')
export class FoodTips extends UIScreen {
    private _level: FoodDetails | null = null;
    private _template: Node | null = null;
    private _box: Node | null = null;
    private _flying: Node[] = [];
    private _elapsed = 0;
    private _lane = 0;
    private _token = 0;
    private _preferOwn = true;
    private _cancelInput: (() => void) | null = null;
    private _window: Node | null = null;
    private _timeOver: Label | null = null;
    private _closeRemaining = 8;
    private _editing = false;
    private _skipCountdownFrame = false;

    protected onLoad(): void {
        this.node.addComponent(BlockInputEvents);
        this._box = this.resolveNode(null, 'ReviewTipsBox');
        this._template = this.resolveNode(null, 'ReviewTipsBox/ReviewTipsItem');
        if (this._template) this._template.active = false;
        // 场景保留了旧的同名占位节点，两个关闭入口都接线：内层右上角（无图标，纯命中区）+ 外层可见返回箭头。
        const window = this.resolveNode(null, 'TipsWindow');
        this._window = window;
        this._timeOver = this.resolveLabel(null, 'TipsWindow/TimeOver');
        const closeButton = window?.children.slice().reverse().find(child => child.name === 'BtnClose') ?? null;
        this.wireButton(closeButton, 'TipsWindow/BtnClose', () => this.close());
        this.wireButton(null, 'BtnClose', () => this.close());
        // 捕获阶段覆盖遮罩和弹幕；只处理卡片外的点击，阻止穿透到下层。
        this.node.on(Node.EventType.TOUCH_END, this._onOutsideTap, this, true);
        this.wireButton(null, 'BtnReview', () => this._review());
    }
    private _onOutsideTap(event: EventTouch): void {
        const ui = this._window?.getComponent(UITransform);
        if (!ui) return;
        const point = event.getUILocation();
        const local = ui.convertToNodeSpaceAR(new Vec3(point.x, point.y, 0));
        if (local.x >= -ui.width * ui.anchorX && local.x <= ui.width * (1 - ui.anchorX)
            && local.y >= -ui.height * ui.anchorY && local.y <= ui.height * (1 - ui.anchorY)) return;
        event.propagationStopped = true;
        this.close();
    }
    private _refreshCountdown(): void {
        if (this._timeOver) this._timeOver.string = this._editing
            ? '评论中，倒计时暂停' : `弹窗${Math.ceil(this._closeRemaining)}S后关闭`;
    }
    private _finishEditing(): void {
        this._editing = false;
        // 原生输入/H5 prompt 可能阻塞帧更新，恢复时不扣除编辑期间的时间。
        this._skipCountdownFrame = true;
        this._refreshCountdown();
    }
    public present(level: FoodDetails, unlocked: boolean): void {
        this.close();
        this._level = level;
        this._preferOwn = true;
        this.open();
        this._closeRemaining = 8;
        this._editing = false;
        this._skipCountdownFrame = false;
        this._refreshCountdown();
        this.node.setSiblingIndex(this.node.parent!.children.length - 1);
        this.setLabel(null, 'TipsWindow/Title-001', unlocked ? `恭喜解锁美食：${level.foodName || level.name}` : level.foodName || level.name);
        this.setLabel(null, 'TipsWindow/Title-002', level.foodDesc || '美食介绍待补充');
        const sprite = this.resolveNode(null, 'foodicon')?.getComponent(Sprite);
        const token = ++this._token;
        if (sprite) sprite.spriteFrame = null;
        void this.flow.loadSpriteFrame(level.icon).then(frame => {
            if (this.isValid && token === this._token && sprite?.isValid) sprite.spriteFrame = frame;
        }).catch(error => console.warn('[FoodTips] 图片加载失败', error));
        this._elapsed = 2;
    }
    protected onDisable(): void {
        this._token++;
        this._cancelInput?.();
        this._cancelInput = null;
        this._editing = false;
        this._clear();
    }
    private _clear(): void {
        for (const item of this._flying) { item.removeFromParent(); item.destroy(); }
        this._flying = [];
    }
    protected update(dt: number): void {
        if (!this._editing && !this._skipCountdownFrame) {
            this._closeRemaining = Math.max(0, this._closeRemaining - dt);
            this._refreshCountdown();
            if (this._closeRemaining <= 0) { this.close(); return; }
        }
        this._skipCountdownFrame = false;
        const box = this._box?.getComponent(UITransform);
        if (!box) return;
        for (const item of this._flying) item.setPosition(item.position.x - 95 * dt, item.position.y);
        this._flying = this._flying.filter(item => {
            if (item.position.x + (item.getComponent(UITransform)?.width ?? 0) / 2 >= -box.width * box.anchorX) return true;
            item.removeFromParent(); item.destroy(); return false;
        });
        this._elapsed += dt;
        if (this._elapsed >= 2 && this._flying.length < 12) { this._elapsed = 0; this._spawn(); }
    }
    private _spawn(): void {
        if (!this._level || !this._template || !this._box) return;
        const own = this.flow.save.getFoodReview(this._level.key);
        const pool = (this._level.reviews ?? []).filter(text => typeof text === 'string' && text.trim()).map(text => ({ text, own: false }));
        if (own) pool.push({ text: own, own: true });
        if (!pool.length) return;
        const review = this._preferOwn && own ? { text: own, own: true } : pool[Math.floor(Math.random() * pool.length)];
        const box = this._box.getComponent(UITransform)!;
        const item = instantiate(this._template);
        item.parent = this._box;
        const label = this.findChildDeep(item, 'TipsLabel')!.getComponent(Label)!;
        const bg = this.findChildDeep(item, 'TipsBG')!;
        label.overflow = Label.Overflow.NONE;
        label.enableWrapText = false;
        label.string = review.text;
        if (review.own) {
            label.color = new Color(255, 245, 0, 255);
            const sprite = bg.getComponent(Sprite);
            if (sprite) sprite.color = new Color(0, 133, 255, 50);
        }
        item.active = true;
        label.updateRenderData(true);
        const textUI = label.getComponent(UITransform)!;
        textUI.setAnchorPoint(.5, .5);
        item.getComponent(UITransform)!.setAnchorPoint(.5, .5);
        bg.getComponent(UITransform)!.setAnchorPoint(.5, .5);
        const background = bg.getComponent(Sprite);
        if (background) background.sizeMode = Sprite.SizeMode.CUSTOM;
        const width = textUI.width + 32, height = Math.max(textUI.height + 12, 44);
        item.getComponent(UITransform)!.setContentSize(width, height);
        bg.getComponent(UITransform)!.setContentSize(width, height);
        label.node.setPosition(0, 0); bg.setPosition(0, 0);
        const lanes = Math.max(1, Math.floor(box.height / height));
        const lane = this._lane++ % lanes;
        const y = box.height * (1 - box.anchorY) - height * (lane + .5);
        // 同一行的上一条完全进入后才允许下一条，避免长评价相互重叠。
        if (this._flying.some(other => Math.abs(other.position.y - y) < height && other.position.x + other.getComponent(UITransform)!.width / 2 > box.width * (1 - box.anchorX) - 20)) {
            item.destroy(); return;
        }
        item.setPosition(box.width * (1 - box.anchorX) + width / 2, y);
        this._flying.push(item);
        this._preferOwn = false;
    }
    private _review(): void {
        if (!this._level || this._editing) return;
        this._editing = true;
        this._refreshCountdown();
        const key = this._level.key;
        const submit = (value: string) => {
            if (!this.node.activeInHierarchy || this._level?.key !== key) return;
            if (this.flow.save.setFoodReview(key, value)) {
                this._clear(); this._preferOwn = true; this._elapsed = 2;
                this.flow.toast('评价已保存');
            }
        };
        const host = globalThis as any;
        const sdk = this.flow.platform.kind === 'douyin' ? host.tt : host.wx;
        if (!sdk?.showKeyboard) {
            try {
                const text = host.prompt?.('评价美食（最多50字）', this.flow.save.getFoodReview(key));
                if (typeof text === 'string') submit(text);
            } finally { this._finishEditing(); }
            return;
        }
        const cleanup = () => {
            sdk.offKeyboardComplete?.(complete);
            this._cancelInput = null;
            this._finishEditing();
        };
        const complete = (result: { value?: string }) => { cleanup(); submit(result.value ?? ''); };
        this._cancelInput = () => { cleanup(); sdk.hideKeyboard?.({}); };
        try {
            sdk.onKeyboardComplete(complete);
            sdk.showKeyboard({ defaultValue: this.flow.save.getFoodReview(key), maxLength: 50,
                multiple: false, confirmHold: false, confirmType: 'done',
                fail: () => { cleanup(); this.flow.toast('输入框暂时无法打开'); } });
        } catch { cleanup(); this.flow.toast('输入框暂时无法打开'); }
    }
}
