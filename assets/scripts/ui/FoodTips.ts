import { _decorator, BlockInputEvents, Color, instantiate, Label, Node, Sprite, UITransform } from 'cc';
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

    protected onLoad(): void {
        this.node.addComponent(BlockInputEvents);
        this._box = this.resolveNode(null, 'ReviewTipsBox');
        this._template = this.resolveNode(null, 'ReviewTipsBox/ReviewTipsItem');
        if (this._template) this._template.active = false;
        // 场景保留了旧的同名占位节点，使用后添加的右上角关闭按钮。
        const window = this.resolveNode(null, 'TipsWindow');
        const closeButton = window?.children.slice().reverse().find(child => child.name === 'BtnClose') ?? null;
        this.wireButton(closeButton, 'TipsWindow/BtnClose', () => this.close());
        this.wireButton(null, 'BtnReview', () => this._review());
    }
    public present(level: FoodDetails, unlocked: boolean): void {
        this.close();
        this._level = level;
        this._preferOwn = true;
        this.open();
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
        this._clear();
    }
    private _clear(): void {
        for (const item of this._flying) { item.removeFromParent(); item.destroy(); }
        this._flying = [];
    }
    protected update(dt: number): void {
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
        if (!this._level || this._cancelInput) return;
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
            const text = host.prompt?.('评价美食（最多50字）', this.flow.save.getFoodReview(key));
            if (typeof text === 'string') submit(text);
            return;
        }
        const cleanup = () => {
            sdk.offKeyboardComplete?.(complete);
            this._cancelInput = null;
        };
        const complete = (result: { value?: string }) => { cleanup(); submit(result.value ?? ''); };
        this._cancelInput = () => { cleanup(); sdk.hideKeyboard?.({}); };
        sdk.onKeyboardComplete(complete);
        try {
            sdk.showKeyboard({ defaultValue: this.flow.save.getFoodReview(key), maxLength: 50,
                multiple: false, confirmHold: false, confirmType: 'done',
                fail: () => { cleanup(); this.flow.toast('输入框暂时无法打开'); } });
        } catch { cleanup(); this.flow.toast('输入框暂时无法打开'); }
    }
}
