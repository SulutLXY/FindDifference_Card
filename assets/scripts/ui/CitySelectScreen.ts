import {
    _decorator,
    Color,
    Graphics,
    Input,
    Label,
    Layout,
    Mask,
    Node,
    Prefab,
    ScrollView,
    Size,
    Sprite,
    UITransform,
    instantiate,
} from 'cc';
import { CityConfig } from '../core/GameTypes';
import { EnergyDisplay } from './EnergyDisplay';
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/**
 * 城市选择界面（Screens/CitySelect）。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnBack     返回大厅按钮（Node）
 * - PageTitle   页面标题（Label，可选）
 * - List        城市卡片窗口：代码自动补 Mask 遮罩 + ScrollView 竖向滑动
 *
 * 城市卡片：按以下优先级实例化，填充结构约定：
 * 1. Inspector 绑定 cardPrefab（Prefab 预制体，推荐，素材做好后直接拖入）
 * 2. Inspector 绑定 cardTemplate 或 List 下的 CityCard（旧名 CityCard1）节点
 * 3. 无模板时使用内置简易卡片
 * - CityName      Label，城市名
 * - CityProgress  Label，进度「X/Y」，前方固定文本（如「已完成：」）由模板自带 Label 承担
 * - Levelnumber   Label，关卡范围（按本章编号）
 * - rank_row      进度条底槽 + 子节点 rank_row-001 填充条（锚点靠左，代码按进度改宽度）
 * - CityBanner    Sprite，章节封面包中的 banner，由首包章节索引指定
 * - LockIcon      旧模板锁图标，运行时隐藏
 *
 * 所有专题可直接进入；显示 ProgressPoint，隐藏旧模板的 BtnUnlock。
 */
@ccclass('CitySelectScreen')
export class CitySelectScreen extends UIScreen {
    @property({ type: Node, tooltip: '返回大厅按钮（命名 BtnBack）' })
    public btnBack: Node | null = null;

    @property({ type: Label, tooltip: '页面标题（命名 PageTitle，可选）' })
    public pageTitle: Label | null = null;

    @property({ type: Node, tooltip: '城市卡片窗口（命名 List）' })
    public listRoot: Node | null = null;

    @property({ type: Node, tooltip: '卡片模板（可选）。不绑定时自动使用 List 下的 CityCard' })
    public cardTemplate: Node | null = null;

    @property({ type: Prefab, tooltip: '城市卡片预制体（可选）。绑定后优先使用，无需在场景 List 下摆放 CityCard1' })
    public cardPrefab: Prefab | null = null;

    private _cards: Node[] = [];
    private _content: Node | null = null;

    protected onLoad(): void {
        void EnergyDisplay.attach(this.node);
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.returnToLobby());
        this._setupScrollContainer();
    }

    protected onOpen(): void {
        this.setLabel(this.pageTitle, 'PageTitle', '关卡选择');
        this.rebuild();
    }

    protected onClose(): void {
        this._clearCards();
    }

    public rebuild(): void {
        this._clearCards();
        const root = this.resolveNode(this.listRoot, 'List') ?? this.node;
        const container = this._content ?? root;
        const template = this.cardTemplate
            ?? root.getChildByName('CityCard')
            ?? root.getChildByName('CityCard1');

        this.flow.cities.forEach(city => {
            let card: Node;
            if (this.cardPrefab) {
                card = instantiate(this.cardPrefab);
                card.name = `CityCard-${city.key}`;
            } else if (template) {
                card = instantiate(template);
                card.name = `CityCard-${city.key}`;
            } else {
                card = this._buildFallbackCard();
            }
            this._cards.push(card);
            card.parent = container;
            card.active = true;
            this._fillCard(card, city);
        });

        // 隐藏手动参考卡
        for (const child of root.children) {
            if (/^CityCard\d*$/.test(child.name)) child.active = false;
        }
        this._scrollToTop();
    }

    private _fillCard(card: Node, city: CityConfig): void {
        const progress = this.flow.cityProgress(city);
        const progressPoint = this.findChildDeep(card, 'ProgressPoint');
        const unlockButton = this.findChildDeep(card, 'BtnUnlock');
        if (progressPoint) progressPoint.active = true;
        if (unlockButton) {
            unlockButton.active = false;
            unlockButton.off(Input.EventType.TOUCH_END, undefined, this);
        }

        this._setCardLabel(card, 'CityName', city.name);
        this._setCardLabel(card, 'CityProgress', `${progress.done}/${progress.total}`);
        this._setCardLabel(card, 'Levelnumber', progress.total > 0 ? `${city.name}1-${progress.total}关` : '');
        const rangeLabel = this.findChildDeep(card, 'Levelnumber')?.getComponent(Label);
        if (rangeLabel) {
            rangeLabel.enableWrapText = false;
            rangeLabel.overflow = Label.Overflow.SHRINK;
        }
        const cityAim = this.findChildDeep(card, 'Cityaim')?.getComponent(Sprite);
        if (cityAim) cityAim.grayscale = false;

        // 进度条：rank_row 底槽 + rank_row-001 填充（锚点已靠左，按完成比例改宽度）
        const barRoot = this.findChildDeep(card, 'rank_row');
        const barRootUi = barRoot?.getComponent(UITransform);
        const fillUi = barRoot?.getChildByName('rank_row-001')?.getComponent(UITransform);
        if (barRootUi && fillUi) {
            const ratio = progress.total > 0 ? Math.min(1, Math.max(0, progress.done / progress.total)) : 0;
            fillUi.width = barRootUi.width * ratio;
        }

        // 兼容旧模板，隐藏所有专题锁定提示。
        for (const name of ['LockIcon', 'CityLockTip']) {
            const lock = this.findChildDeep(card, name);
            if (lock) lock.active = false;
        }
        const bannerSprite = this.findChildDeep(card, 'CityBanner')?.getComponent(Sprite);
        if (bannerSprite) bannerSprite.grayscale = false;
        void this._loadBanner(card, city.banner || `chapter-covers/${city.key}-icon/spriteFrame`);

        card.off(Input.EventType.TOUCH_END);
        card.on(Input.EventType.TOUCH_END, () => {
            void this.flow.enterCity(city);
        }, this);
    }

    private async _loadBanner(card: Node, path: string): Promise<void> {
        const banner = this.findChildDeep(card, 'CityBanner');
        if (!banner) return;
        try {
            const frame = await this.flow.loadPageSpriteFrame(path, this.node);
            if (!frame?.isValid || !this.node.activeInHierarchy || !banner.isValid) return;
            let sprite = banner.getComponent(Sprite);
            if (!sprite) sprite = banner.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            if (banner.isValid) {
                sprite.spriteFrame = frame;
                console.log(`[CitySelect] banner-loaded path=${path}`);
            }
        } catch {
            // 横幅缺失时保持模板原样
        }
    }

    private _setCardLabel(card: Node, name: string, text: string): void {
        const label = this.findChildDeep(card, name)?.getComponent(Label);
        if (label) label.string = text;
    }

    /** 同选关：List 改造为 Mask + ScrollView，Content 竖向排列。 */
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
            const layout = this._content.addComponent(Layout);
            layout.type = Layout.Type.VERTICAL;
            layout.resizeMode = Layout.ResizeMode.CONTAINER;
            layout.spacingY = 16;
            layout.paddingTop = 10;
            layout.paddingBottom = 10;
        }

        scrollView.content = this._content;
        scrollView.scrollToTop(0);
    }

    private _scrollToTop(): void {
        this.resolveNode(this.listRoot, 'List')?.getComponent(ScrollView)?.scrollToTop(0.1);
    }

    private _clearCards(): void {
        this.flow.releasePageSpriteFrames(this.node);
        for (const card of this._cards) card.destroy();
        this._cards = [];
    }

    /** 无模板时的内置简易城市卡。 */
    private _buildFallbackCard(): Node {
        const card = new Node('CityCard');
        const ui = card.addComponent(UITransform);
        ui.setContentSize(660, 220);
        const graphics = card.addComponent(Graphics);
        graphics.fillColor = UIColors.panel;
        graphics.roundRect(-330, -110, 660, 220, 24);
        graphics.fill();
        graphics.lineWidth = 5;
        graphics.strokeColor = UIColors.gold;
        graphics.roundRect(-330, -110, 660, 220, 24);
        graphics.stroke();

        const addLabel = (name: string, x: number, y: number, w: number, h: number, size: number): Label => {
            const node = new Node(name);
            node.parent = card;
            node.setPosition(x, y);
            const nodeUi = node.addComponent(UITransform);
            nodeUi.setContentSize(w, h);
            const label = node.addComponent(Label);
            label.fontSize = size;
            label.color = Color.WHITE;
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            label.overflow = Label.Overflow.SHRINK;
            return label;
        };

        addLabel('CityName', -180, 30, 280, 70, 40);
        addLabel('CityProgress', 200, 30, 200, 60, 30);
        addLabel('CityLockTip', 0, -60, 560, 50, 24);
        return card;
    }
}
