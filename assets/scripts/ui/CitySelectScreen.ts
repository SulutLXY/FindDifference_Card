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
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/** 未解锁城市名颜色 */
const CITY_NAME_LOCKED_COLOR = new Color(0x44, 0x59, 0x88, 255);
/** 未解锁卡片底色（已解锁保持模板默认白） */
const CARD_BG_LOCKED_COLOR = new Color(0xd6, 0xe6, 0xf0, 255);

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
 * - Levelnumber   Label，关卡范围「第X-Y关」（按全局关卡编号）
 * - rank_row      进度条底槽 + 子节点 rank_row-001 填充条（锚点靠左，代码按进度改宽度）
 * - CityBanner    Sprite，城市横幅图（可选，city.json 配 banner 时加载）
 * - LockIcon      锁图标（未解锁时显示；模板里直接用 CityLockTip 当锁也可以）
 *
 * 解锁规则：第一城始终解锁，其余需前一城全部关卡通关。
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
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.showLobby());
        this._setupScrollContainer();
    }

    protected onOpen(): void {
        this.setLabel(this.pageTitle, 'PageTitle', '选择城市');
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

        this.flow.cities.forEach((city, index) => {
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
            this._fillCard(card, city, index);
        });

        // 隐藏手动参考卡
        for (const child of root.children) {
            if (/^CityCard\d*$/.test(child.name)) child.active = false;
        }
        this._scrollToTop();
    }

    private _fillCard(card: Node, city: CityConfig, cityIndex: number): void {
        const unlocked = this.flow.isCityUnlocked(cityIndex);
        const progress = this.flow.cityProgress(city);

        // 全局关卡编号：前序城市关卡数累加 + 1
        let levelStart = 1;
        for (let i = 0; i < cityIndex; i++) levelStart += this.flow.cities[i].levels.length;

        this._setCardLabel(card, 'CityName', city.name);
        // 城市名：已解锁保持模板默认色，未解锁灰蓝
        const nameLabel = card.getChildByName('CityName')?.getComponent(Label);
        if (nameLabel && !unlocked) nameLabel.color = CITY_NAME_LOCKED_COLOR;
        // 进度始终显示「完成/总数」，未解锁即为 0/15
        this._setCardLabel(card, 'CityProgress', `${progress.done}/${progress.total}`);
        this._setCardLabel(card, 'Levelnumber', progress.total > 0 ? `第${levelStart}-${levelStart + progress.total - 1}关` : '');

        // 卡片底色：已解锁保持模板默认，未解锁淡蓝灰
        const cardBg = card.getChildByName('CityCard_BG')?.getComponent(Sprite);
        if (cardBg && !unlocked) cardBg.color = CARD_BG_LOCKED_COLOR;

        // 进度条：rank_row 底槽 + rank_row-001 填充（锚点已靠左，按完成比例改宽度）
        const barRoot = card.getChildByName('rank_row');
        const barRootUi = barRoot?.getComponent(UITransform);
        const fillUi = barRoot?.getChildByName('rank_row-001')?.getComponent(UITransform);
        if (barRootUi && fillUi) {
            const ratio = progress.total > 0 ? Math.min(1, Math.max(0, progress.done / progress.total)) : 0;
            fillUi.width = barRootUi.width * ratio;
        }

        // 锁：LockIcon 优先，兼容模板里直接用 CityLockTip 当锁图标
        const lock = card.getChildByName('LockIcon') ?? card.getChildByName('CityLockTip');
        if (lock) lock.active = !unlocked;

        // 城市横幅置灰：同步设置（与选关页同一模式，grayscale 是组件属性与帧无关）
        const bannerSprite = this.findChildDeep(card, 'CityBanner')?.getComponent(Sprite);
        if (bannerSprite) {
            bannerSprite.grayscale = !unlocked;
            console.log(`[CitySelect] sync-gray city=${city.key} unlocked=${unlocked} grayscale=${bannerSprite.grayscale}`);
        }

        // 城市横幅：固定读取城市资源目录下的 icon-city
        void this._loadBanner(card, `levels/${city.key}/icon-city`, unlocked);

        card.off(Input.EventType.TOUCH_END);
        card.on(Input.EventType.TOUCH_END, () => {
            if (!this.flow.isCityUnlocked(cityIndex)) {
                const prev = this.flow.cities[cityIndex - 1];
                this.flow.toast(prev ? `通关${prev.name}后解锁` : '尚未解锁');
                return;
            }
            void this.flow.enterCity(city);
        }, this);
    }

    private async _loadBanner(card: Node, path: string, unlocked: boolean): Promise<void> {
        const banner = this.findChildDeep(card, 'CityBanner');
        if (!banner) return;
        try {
            const frame = await this.flow.loadSpriteFrame(path);
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
        const label = card.getChildByName(name)?.getComponent(Label);
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
