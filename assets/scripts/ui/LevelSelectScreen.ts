import { _decorator, Color, Graphics, Input, Label, Layout, Mask, Node, ScrollView, Size, Sprite, UITransform, instantiate } from 'cc';
import { LevelConfig } from '../core/GameTypes';
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/**
 * 选关界面（Screens/LevelSelect）。
 *
 * 卡片动态生成：以 Card1（或 cardTemplate 绑定节点）为模板，
 * 按关卡配置实例化任意数量，进入界面时刷新数据，离开时销毁。
 *
 * 列表结构（onLoad 时自动改造 List 节点，无需手动拼）：
 * - List           可视窗口：挂 Mask（遮罩）+ ScrollView（竖向滑动），
 *                  UITransform 尺寸即可视区域，超出部分被裁掉
 * - Content        卡片容器：代码创建，接收 List 上原 Layout 的网格参数，
 *                  resizeMode 设为 CONTAINER，内容高度随卡片自动增长
 *
 * 模板结构约定（Card1）：
 * - CardNumber          Label，「第N关」
 * - CardName            Label，关卡名
 * - CardDetail          星级区域容器（不解锁时整体隐藏）
 *   - CardDetail_star1BG / star2BG / star3BG   灰色星星底
 *     - CardDetail_star                        金星，默认隐藏，按完成星级逐颗点亮
 * - LockIcon            锁图标（仅未解锁时显示，与 CardDetail 互斥）
 * - Thumbnail           关卡缩略图：默认自动填充该关上图（scene-a），
 *                       未解锁时叠加 GrayMask 灰色蒙版（30% 灰）；
 *                       若关卡配置含 thumbnail 字段则优先用专用缩略图
 *
 * 列表末尾固定追加一张「敬请期待」占位卡：使用 levels/level-00 目录的图，
 * 不可选（点击仅提示），无锁、无星级。替换该目录的 scene-a 图片即可更换占位图。
 */
@ccclass('LevelSelectScreen')
export class LevelSelectScreen extends UIScreen {
    @property({ type: Node, tooltip: '返回大厅按钮（命名 BtnBack）' })
    public btnBack: Node | null = null;

    @property({ type: Node, tooltip: '关卡卡片窗口（命名 List）。代码自动为其补 Mask 遮罩与 ScrollView 滑动' })
    public listRoot: Node | null = null;

    @property({ type: Node, tooltip: '卡片模板（可选）。不绑定时自动使用 List 下的 Card1 作为模板' })
    public cardTemplate: Node | null = null;

    private _runtimeCards: Node[] = [];
    private _content: Node | null = null;

    /** 末尾「敬请期待」占位卡使用的图片路径（resources 相对路径）。 */
    private static readonly COMING_SOON_IMAGE = 'levels/level-00/scene-a/spriteFrame';

    protected onLoad(): void {
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.showLobby());
        this._setupScrollContainer();
    }

    protected onOpen(): void {
        this.rebuild();
    }

    protected onClose(): void {
        this._clearRuntimeCards();
    }

    /** 动态生成全部关卡卡片：按模板实例化 → 填充数据 → 隐藏手动参考卡 → 追加敬请期待卡。 */
    public rebuild(): void {
        this._clearRuntimeCards();
        const root = this.resolveNode(this.listRoot, 'List') ?? this.node;
        const container = this._content ?? root;
        const template = this._resolveTemplate(root);

        for (const level of this.flow.levels) {
            let card: Node;
            if (template) {
                card = instantiate(template);
                card.name = `LevelCard-${level.id}`;
            } else {
                card = this._buildFallbackCard();
            }
            this._runtimeCards.push(card);
            card.parent = container;
            card.active = true;
            this._fillCard(card, level);
        }

        this._hideManualCards(root);
        this._appendComingSoonCard(container, template);
        this._scrollToTop();
    }

    /**
     * 把 List 改造成「遮罩 + 滑动」结构（幂等，重复调用安全）：
     * List 自身挂 Mask 和 ScrollView 作为可视窗口；
     * 创建 Content 子节点作为卡片容器，并把 List 上原 Layout 的网格参数转移过去。
     */
    private _setupScrollContainer(): void {
        const root = this.resolveNode(this.listRoot, 'List');
        if (!root) return;
        const rootUi = root.getComponent(UITransform);

        if (!root.getComponent(Mask)) {
            const mask = root.addComponent(Mask);
            mask.type = Mask.Type.GRAPHICS_RECT;
        }

        const scrollView = root.getComponent(ScrollView) ?? root.addComponent(ScrollView);
        scrollView.horizontal = false;
        scrollView.vertical = true;
        scrollView.inertia = true;

        this._content = root.getChildByName('Content');
        if (!this._content) {
            this._content = new Node('Content');
            this._content.parent = root;
            const ui = this._content.addComponent(UITransform);
            const size = rootUi?.contentSize ?? new Size(750, 1334);
            ui.setContentSize(size.width, size.height);
        }

        const oldLayout = root.getComponent(Layout);
        if (oldLayout && oldLayout.enabled) {
            const layout = this._content.getComponent(Layout) ?? this._content.addComponent(Layout);
            layout.type = oldLayout.type;
            layout.resizeMode = Layout.ResizeMode.CONTAINER;
            layout.spacingX = oldLayout.spacingX;
            layout.spacingY = oldLayout.spacingY;
            layout.paddingLeft = oldLayout.paddingLeft;
            layout.paddingRight = oldLayout.paddingRight;
            layout.paddingTop = oldLayout.paddingTop;
            layout.paddingBottom = oldLayout.paddingBottom;
            layout.horizontalDirection = oldLayout.horizontalDirection;
            layout.verticalDirection = oldLayout.verticalDirection;
            layout.enabled = true;
            oldLayout.enabled = false;
        }

        scrollView.content = this._content;
        scrollView.scrollToTop(0);
    }

    private _scrollToTop(): void {
        const root = this.resolveNode(this.listRoot, 'List');
        root?.getComponent(ScrollView)?.scrollToTop(0.1);
    }

    /** 模板来源：优先 cardTemplate 绑定，其次 List 直接子级下的 Card1（手动参考卡不在 Content 下）。 */
    private _resolveTemplate(listRoot: Node): Node | null {
        if (this.cardTemplate && this.cardTemplate.isValid) return this.cardTemplate;
        return listRoot.getChildByName('Card1');
    }

    /** 隐藏 List 直接子级里手动拼装的 Card1..CardN（它们只是模板参考，不参与显示）。 */
    private _hideManualCards(listRoot: Node): void {
        for (const child of listRoot.children) {
            if (/^Card\d+$/.test(child.name)) child.active = false;
        }
    }

    /** 列表末尾追加「敬请期待」占位卡：level-00 的图、不可选、无锁、无星级。 */
    private _appendComingSoonCard(container: Node, template: Node | null): void {
        const card = template ? instantiate(template) : this._buildFallbackCard();
        card.name = 'ComingSoonCard';
        this._runtimeCards.push(card);
        card.parent = container;
        card.active = true;

        this._setCardLabel(card, 'CardNumber', '');
        this._setCardLabel(card, 'CardName', '敬请期待');
        const lock = card.getChildByName('LockIcon');
        if (lock) lock.active = false;
        const detail = card.getChildByName('CardDetail');
        if (detail) detail.active = false;
        this._setGrayMask(card, false);
        void this._loadThumbnailByPath(card, LevelSelectScreen.COMING_SOON_IMAGE);

        card.off(Input.EventType.TOUCH_END);
        card.on(Input.EventType.TOUCH_END, () => this.flow.toast('新关卡即将开放，敬请期待'), this);
    }

    private _fillCard(card: Node, level: LevelConfig): void {
        const unlocked = this.flow.save.isUnlocked(level.id);
        const progress = this.flow.save.data.levels[String(level.id)];

        this._setCardLabel(card, 'CardNumber', `第${level.id}关`);
        this._setCardLabel(card, 'CardName', level.name);

        // 未解锁：显示锁 + 缩略图压 30% 灰；已解锁：显示星级区域
        const lock = card.getChildByName('LockIcon');
        if (lock) lock.active = !unlocked;
        this._setGrayMask(card, !unlocked);

        const detail = card.getChildByName('CardDetail');
        if (detail) {
            detail.active = unlocked;
            if (unlocked) {
                // 星级用图片显示：清空文字，按完成星级逐颗点亮金星
                const label = detail.getComponent(Label);
                if (label) label.string = '';
                const stars = progress?.stars ?? 0;
                for (let i = 1; i <= 3; i++) {
                    const bg = detail.getChildByName(`CardDetail_star${i}BG`);
                    const star = bg?.getChildByName('CardDetail_star');
                    if (star) star.active = i <= stars;
                }
            }
        }

        void this._loadThumbnail(card, level);

        card.off(Input.EventType.TOUCH_END);
        card.on(Input.EventType.TOUCH_END, () => this._selectLevel(level.id), this);
    }

    /** 未解锁卡缩略图叠加 30% 灰蒙版（GrayMask 子节点，随解锁状态显隐）。 */
    private _setGrayMask(card: Node, show: boolean): void {
        const thumbnail = card.getChildByName('Thumbnail');
        if (!thumbnail) return;
        let mask = thumbnail.getChildByName('GrayMask');
        if (!mask) {
            mask = new Node('GrayMask');
            mask.parent = thumbnail;
            const size = thumbnail.getComponent(UITransform)?.contentSize ?? new Size(340, 220);
            const ui = mask.addComponent(UITransform);
            ui.setContentSize(size.width, size.height);
            const graphics = mask.addComponent(Graphics);
            graphics.fillColor = new Color(128, 128, 128, 76);
            graphics.rect(-size.width / 2, -size.height / 2, size.width, size.height);
            graphics.fill();
        }
        mask.active = show;
    }

    /** 加载卡片缩略图：优先用关卡配置的 thumbnail 字段，缺省时用该关上图（scene-a）自动充当。 */
    private async _loadThumbnail(card: Node, level: LevelConfig): Promise<void> {
        await this._loadThumbnailByPath(card, level.thumbnail || level.topImage);
    }

    private async _loadThumbnailByPath(card: Node, path: string): Promise<void> {
        const thumbnail = card.getChildByName('Thumbnail');
        if (!thumbnail || !path) return;
        try {
            const frame = await this.flow.loadSpriteFrame(path);
            const sprite = thumbnail.getComponent(Sprite);
            if (sprite && thumbnail.isValid) sprite.spriteFrame = frame;
        } catch {
            // 缩略图缺失时保留模板自带贴图
        }
    }

    private _setCardLabel(card: Node, name: string, text: string): void {
        const label = card.getChildByName(name)?.getComponent(Label);
        if (label) label.string = text;
    }

    private _selectLevel(id: number): void {
        const level = this.flow.findLevel(id);
        if (!level) return;
        if (!this.flow.save.isUnlocked(id)) {
            this.flow.toast(`通关第${id - 1}关后解锁`);
            return;
        }
        this.flow.startLevel(level);
    }

    private _clearRuntimeCards(): void {
        for (const card of this._runtimeCards) card.destroy();
        this._runtimeCards = [];
    }

    /** 无模板时的内置简易卡，保证流程可运行。 */
    private _buildFallbackCard(): Node {
        const card = new Node('LevelCard');
        const ui = card.addComponent(UITransform);
        ui.setContentSize(650, 150);
        const graphics = card.addComponent(Graphics);
        graphics.fillColor = UIColors.panel;
        graphics.roundRect(-325, -75, 650, 150, 28);
        graphics.fill();
        graphics.lineWidth = 5;
        graphics.strokeColor = UIColors.gold;
        graphics.roundRect(-325, -75, 650, 150, 28);
        graphics.stroke();

        const labelNode = new Node('CardLabel');
        labelNode.parent = card;
        const labelUi = labelNode.addComponent(UITransform);
        labelUi.setContentSize(600, 130);
        const label = labelNode.addComponent(Label);
        label.fontSize = 26;
        label.lineHeight = 36;
        label.color = Color.WHITE;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        return card;
    }
}
