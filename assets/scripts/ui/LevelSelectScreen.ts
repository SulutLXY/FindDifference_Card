import { _decorator, Color, Graphics, Input, Label, Layout, Node, ScrollView, Sprite, UITransform, instantiate } from 'cc';
import { CityConfig, LevelConfig } from '../core/GameTypes';
import { EnergyDisplay } from './EnergyDisplay';
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/** 未解锁关卡名字颜色 */
const LEVEL_NAME_LOCKED_COLOR = new Color(0x44, 0x59, 0x88, 255);

/**
 * 城市内选关界面（Screens/LevelSelect）。
 *
 * 由 CitySelectScreen 进入，当前城市由 GameFlow.currentCity 提供；
 * 返回键回到城市列表页。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnBack      返回城市列表按钮（Node）
 * - PageTitle    页面标题（Label，运行时刷新为城市名）
 * - PageTitle_BG/Number  可选章节完成进度，缺少时跳过
 * - List         固定网格，每页默认 8 关，不添加滑动容器
 * - Page/PageLaber、button_page_prev、button_page_next  页码与翻页按钮
 * - Card1        卡片模板（可选，结构与动态填充约定见下）
 *
 * 卡片模板结构约定（Card1）：
 * - CardNumber          Label，「第N关」，未解锁灰蓝 #445988
 * - CardName            Label，关卡名（differences.json 的 name），未解锁灰蓝 #445988
 * - CardDetail          星级区域容器（常显）：未解锁显示三颗灰星，按完成星级逐颗点亮金星
 *   - CardDetail_star1BG / star2BG / star3BG   灰色星星底
 *     - CardDetail_star                        金星，默认隐藏
 * - LockIcon            锁图标（仅未解锁时显示）
 * - Thumbnail           关卡封面：未解锁置灰（Sprite 乘法着色），已解锁保持模板默认
 *
 * 专题直接进入，首关免费；锁定小关先打开 EventTips，由玩家确认单关或整章视频解锁。
 */
@ccclass('LevelSelectScreen')
export class LevelSelectScreen extends UIScreen {
    @property({ type: Node, tooltip: '返回城市列表按钮（命名 BtnBack）' })
    public btnBack: Node | null = null;

    @property({ type: Label, tooltip: '页面标题（命名 PageTitle，运行时刷新为城市名）' })
    public pageTitle: Label | null = null;

    @property({ type: Node, tooltip: '关卡卡片窗口（命名 List）' })
    public listRoot: Node | null = null;

    @property({ type: Node, tooltip: '卡片模板（可选）。不绑定时自动使用 List 下的 Card1' })
    public cardTemplate: Node | null = null;

    @property({ type: Label, tooltip: '可选章节进度；未绑定时查找 PageTitle_BG/Number，缺少时跳过' })
    public chapterProgress: Label | null = null;

    @property({ type: Label, tooltip: '页码；未绑定时查找 Page/PageLaber' })
    public pageLabel: Label | null = null;

    @property({ type: Node, tooltip: '上一页；未绑定时查找 Page/button_page_prev' })
    public btnPrevious: Node | null = null;

    @property({ type: Node, tooltip: '下一页；未绑定时查找 Page/button_page_next' })
    public btnNext: Node | null = null;

    @property({ min: 1, step: 1, tooltip: '每页关卡数，默认 8（两列四行）' })
    public pageSize = 8;

    private _runtimeCards: Node[] = [];
    private _unlockPending = false;
    private _selectionVersion = 0;
    private _chapterKey = '';
    private _pageIndex = 0;
    private _pageCount = 0;

    protected onLoad(): void {
        void EnergyDisplay.attach(this.node);
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.returnToChapterSelection());
        this._setupPageContainer();
        this.btnPrevious = this._optionalPageNode(this.btnPrevious, 'button_page_prev');
        this.btnNext = this._optionalPageNode(this.btnNext, 'button_page_next');
        // 按下动画由 Canvas 上的 UIAnimationBinding 播放预制体已绑定的点击片段。
        if (this.btnPrevious) this.wireButton(this.btnPrevious, '', () => this._goToPage(this._pageIndex - 1));
        if (this.btnNext) this.wireButton(this.btnNext, '', () => this._goToPage(this._pageIndex + 1));
    }

    protected onOpen(): void {
        this._selectInitialPage();
        this.rebuild();
    }

    protected onClose(): void {
        this._selectionVersion++;
        this._clearRuntimeCards();
    }

    /** 进入章节时定位最靠前的锁定关卡；全部解锁后定位星级最低的关卡。 */
    private _selectInitialPage(): void {
        const city = this.flow.currentCity;
        if (!city?.levelsLoaded) return;
        const cityIndex = this.flow.cities.indexOf(city);
        let target = city.levelConfigs.findIndex((_, index) => !this.flow.isLevelUnlocked(cityIndex, index));
        if (target < 0) {
            target = 0;
            let lowestStars = Infinity;
            city.levelConfigs.forEach((level, index) => {
                const stars = this.flow.save.progressOf(level.key)?.stars ?? 0;
                // 同星级保留章节配置中更靠前的一关；未游玩按 0 星处理。
                if (stars < lowestStars) {
                    lowestStars = stars;
                    target = index;
                }
            });
        }
        this._chapterKey = city.key;
        this._pageIndex = Math.floor(target / this._effectivePageSize());
    }

    /** 只创建当前页卡片和封面；手动翻页、解锁刷新不重新定位。 */
    public rebuild(): void {
        this._selectionVersion++;
        this._clearRuntimeCards();
        const city = this.flow.currentCity;
        if (!city || !city.levelsLoaded) {
            this._pageCount = 0;
            this._refreshPagination();
            return;
        }

        if (this._chapterKey !== city.key) {
            this._selectInitialPage();
        }
        const pageSize = this._effectivePageSize();
        this._pageCount = Math.ceil(city.levelConfigs.length / pageSize);
        this._pageIndex = Math.max(0, Math.min(this._pageIndex, this._pageCount - 1));

        this.setLabel(this.pageTitle, 'PageTitle', city.name);
        const progress = this.flow.cityProgress(city);
        const progressLabel = this.chapterProgress?.isValid ? this.chapterProgress
            : this.findChildDeep(this.node, 'PageTitle_BG')?.getChildByName('Number')?.getComponent(Label);
        if (progressLabel) progressLabel.string = `${progress.done}/${progress.total}`;

        const root = this.resolveNode(this.listRoot, 'List') ?? this.node;
        const template = this._resolveTemplate(root);
        const cityIndex = this.flow.cities.indexOf(city as CityConfig);
        const start = this._pageIndex * pageSize;
        this._hideManualCards(root);

        city.levelConfigs.slice(start, start + pageSize).forEach((level, index) => {
            let card: Node;
            if (template) {
                card = instantiate(template);
                card.name = `LevelCard-${level.key}`;
            } else {
                card = this._buildFallbackCard();
            }
            this._runtimeCards.push(card);
            card.parent = root;
            card.active = true;
            this._fillCard(card, level, start + index, cityIndex);
        });

        root.getComponent(Layout)?.updateLayout();
        this._refreshPagination();
    }

    /** 保留预制体的网格参数与尺寸，不再创建 Content、Mask 或 ScrollView。 */
    private _setupPageContainer(): void {
        const root = this.resolveNode(this.listRoot, 'List');
        if (!root) return;
        const scrollView = root.getComponent(ScrollView);
        if (scrollView) {
            scrollView.stopAutoScroll();
            scrollView.enabled = false;
        }
        const layout = root.getComponent(Layout);
        if (layout) {
            layout.resizeMode = Layout.ResizeMode.NONE;
            layout.enabled = true;
        }
    }

    private _effectivePageSize(): number {
        return Number.isFinite(this.pageSize) ? Math.max(1, Math.floor(this.pageSize)) : 8;
    }

    private _optionalPageNode(bound: Node | null, name: string): Node | null {
        if (bound?.isValid) return bound;
        const page = this.findChildDeep(this.node, 'Page');
        return page ? this.findChildDeep(page, name) : null;
    }

    private _refreshPagination(): void {
        const label = this.pageLabel?.isValid ? this.pageLabel
            : this._optionalPageNode(null, 'PageLaber')?.getComponent(Label)
                ?? this._optionalPageNode(null, 'PageLabel')?.getComponent(Label);
        if (label) label.string = `${this._pageCount > 0 ? this._pageIndex + 1 : 0}/${this._pageCount}`;
        const previous = this._optionalPageNode(this.btnPrevious, 'button_page_prev');
        const next = this._optionalPageNode(this.btnNext, 'button_page_next');
        if (previous) previous.active = this._pageCount > 0 && this._pageIndex > 0;
        if (next) next.active = this._pageIndex + 1 < this._pageCount;
    }

    private _goToPage(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= this._pageCount || index === this._pageIndex) return;
        this._pageIndex = index;
        this.rebuild();
    }

    /** 模板来源：优先 cardTemplate 绑定，其次 List 直接子级下的 Card1。 */
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

    private _fillCard(card: Node, level: LevelConfig, levelIndex: number, cityIndex: number): void {
        const unlocked = this.flow.isLevelUnlocked(cityIndex, levelIndex);
        const progress = this.flow.save.progressOf(level.key);

        this._setCardLabel(card, 'CardNumber', unlocked ? `第${levelIndex + 1}关` : `第${levelIndex + 1}关 · 看视频解锁`);
        const numberLabel = card.getChildByName('CardNumber')?.getComponent(Label);
        if (numberLabel) {
            numberLabel.enableWrapText = false;
            numberLabel.overflow = Label.Overflow.SHRINK;
        }
        this._setCardLabel(card, 'CardName', level.name);
        // 关卡名：已解锁保持模板默认色，未解锁灰蓝
        if (!unlocked) {
            const numberLabel = card.getChildByName('CardNumber')?.getComponent(Label);
            if (numberLabel) numberLabel.color = LEVEL_NAME_LOCKED_COLOR;
            const nameLabel = card.getChildByName('CardName')?.getComponent(Label);
            if (nameLabel) nameLabel.color = LEVEL_NAME_LOCKED_COLOR;
        }

        // 未解锁：显示锁 + 封面置灰
        const lock = card.getChildByName('LockIcon');
        if (lock) lock.active = !unlocked;
        this._setThumbnailGray(card, !unlocked);

        // 星级区域常显：未解锁三颗灰星（金星不点亮），已解锁按成绩点亮
        const detail = card.getChildByName('CardDetail');
        if (detail) {
            detail.active = true;
            const label = detail.getComponent(Label);
            if (label) label.string = '';
            const stars = unlocked ? progress?.stars ?? 0 : 0;
            for (let i = 1; i <= 3; i++) {
                const bg = detail.getChildByName(`CardDetail_star${i}BG`);
                const star = bg?.getChildByName('CardDetail_star');
                if (star) star.active = i <= stars;
            }
        }

        void this._loadThumbnail(card, level);

        card.off(Input.EventType.TOUCH_END);
        card.on(Input.EventType.TOUCH_END, () => {
            void this._enterLevel(levelIndex);
        }, this);
    }

    private async _enterLevel(levelIndex: number): Promise<void> {
        if (this._unlockPending) return;
        const city = this.flow.currentCity;
        if (!city) return;
        const version = this._selectionVersion;
        this._unlockPending = true;
        try {
            if (!await this.flow.requestLevelUnlock(city, levelIndex)) return;
            if (!this.isValid || !this.node.activeInHierarchy || version !== this._selectionVersion
                || this.flow.currentCity !== city) return;
            // 先刷新永久解锁状态，图片加载失败后返回选关也无需再次看视频。
            this.rebuild();
            await this.flow.startLevel(city, levelIndex);
        } finally {
            this._unlockPending = false;
        }
    }

    /** 未解锁关卡封面灰度化（Thumbnail Sprite 组件 Grayscale，与城市页一致；已解锁恢复彩色）。 */
    private _setThumbnailGray(card: Node, gray: boolean): void {
        const thumbnail = this.findChildDeep(card, 'Thumbnail')?.getComponent(Sprite);
        if (thumbnail) thumbnail.grayscale = gray;
    }

    /** 封面：优先 icon 文件，缺省回退上图。 */
    private async _loadThumbnail(card: Node, level: LevelConfig): Promise<void> {
        await this._loadThumbnailByPath(card, level.icon || level.topImage);
    }

    private async _loadThumbnailByPath(card: Node, path: string): Promise<void> {
        const thumbnail = this.findChildDeep(card, 'Thumbnail');
        if (!thumbnail || !path) return;
        const version = this._selectionVersion;
        try {
            const frame = await this.flow.loadPageSpriteFrame(path, this.node);
            if (version !== this._selectionVersion || !frame?.isValid
                || !this.node.activeInHierarchy || !thumbnail.isValid) return;
            const sprite = thumbnail.getComponent(Sprite);
            if (sprite && thumbnail.isValid) {
                // 按模板默认尺寸（UITransform）显示，避免 RAW 模式下原图过大被裁
                sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                sprite.spriteFrame = frame;
            }
        } catch {
            // 封面缺失时保留模板自带贴图
        }
    }

    private _setCardLabel(card: Node, name: string, text: string): void {
        const label = card.getChildByName(name)?.getComponent(Label);
        if (label) label.string = text;
    }

    private _clearRuntimeCards(): void {
        this.flow.releasePageSpriteFrames(this.node);
        for (const card of this._runtimeCards) {
            // destroy 在帧尾执行，先隐藏，避免旧卡片占用本次网格位置或接受点击。
            card.active = false;
            card.destroy();
        }
        this._runtimeCards = [];
    }

    /** 无模板时的内置简易卡。 */
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
