import { _decorator, Graphics, Label, Node, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { LevelConfig } from '../core/GameTypes';
import { UIColors, UIScreen } from './UIScreen';
import { LobbyEntries } from './LobbyEntries';

const { ccclass, property } = _decorator;

export interface ResultModalPayload {
    win: boolean;
    stars: number;
    elapsedSeconds: number;
    foundCount: number;
    failReason?: 'time' | 'lives';
    level: LevelConfig;
    canRevive: boolean;
    hasNext: boolean;
}

/**
 * 结算弹窗（ResultModal，独立于 Screens 之外的顶层节点）。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - Title/WIN、Title/Lose 成败标题；Lose/Number 显示剩余差异数
 * - Title、Summary 的旧文本占位清空，保留预制体图案与样式
 * - Summary 下 icon_starL-001/002/003 为灰星底图（常显），其子节点 icon_starW 为金星，
 *   按评级激活（1~3 颗），失败时全灭
 * - level_card_selected/icon_fangda 显示找到数量/总数
 * - level_card_selected/icon_Time 成功显示用时，失败显示复活增加的秒数
 * - BtnRevive   看广告复活按钮（Node，失败时按需显示）
 * - BtnPrimary  主按钮（Node，文案自动切换「下一关 / 再玩一次」）
 * - BtnHome     返回主页按钮（Node）
 * - BtnShare    分享成绩按钮（Node，仅成功时显示）
 * - BtnClose    右上角关闭按钮（Node，场景缺失时代码构建，成功/失败都回主页）
 */
@ccclass('ResultModal')
export class ResultModal extends UIScreen {
    @property({ type: Label, tooltip: '旧标题文本占位（清空文字，标题显示由 Title/WIN、Lose 控制）' })
    public titleLabel: Label | null = null;

    @property({ type: Label, tooltip: '旧摘要文本占位（清空文字，用时改由数据条显示）' })
    public summaryLabel: Label | null = null;

    @property({ type: Node, tooltip: '第 1 颗金星（命名 Summary/icon_starL-001/icon_starW）' })
    public star1: Node | null = null;

    @property({ type: Node, tooltip: '第 2 颗金星（命名 Summary/icon_starL-002/icon_starW）' })
    public star2: Node | null = null;

    @property({ type: Node, tooltip: '第 3 颗金星（命名 Summary/icon_starL-003/icon_starW）' })
    public star3: Node | null = null;

    @property({ type: Node, tooltip: '看广告复活按钮（命名 BtnRevive）' })
    public btnRevive: Node | null = null;

    @property({ type: Node, tooltip: '主按钮（命名 BtnPrimary，文案自动切换）' })
    public btnPrimary: Node | null = null;

    @property({ type: Node, tooltip: '返回主页按钮（命名 BtnHome）' })
    public btnHome: Node | null = null;

    @property({ type: Node, tooltip: '分享成绩按钮（命名 BtnShare，仅成功时显示）' })
    public btnShare: Node | null = null;

    @property({ type: Node, tooltip: '右上角关闭按钮（命名 BtnClose，场景缺失时代码构建）' })
    public btnClose: Node | null = null;

    private _reviveTween: Tween<Node> | null = null;
    private _reviveFade: Tween<UIOpacity> | null = null;
    private _reviveNode: Node | null = null;
    private _reviveScale: Vec3 | null = null;
    private _reviveOpacity = 255;
    private _shareWin = false;
    private _shareVersion = 0;

    private async _refreshShareVisibility(): Promise<void> {
        const version = ++this._shareVersion;
        await this.flow.platform?.detectHarmony?.();
        if (!this.isValid || !this.node.activeInHierarchy || version !== this._shareVersion) return;
        const share = this.resolveNode(this.btnShare, 'BtnShare');
        if (share) share.active = this._shareWin && this.flow.platform?.supportsSharing !== false;
    }

    private _stopRevivePulse(): void {
        this._reviveTween?.stop();
        this._reviveFade?.stop();
        this._reviveTween = null;
        this._reviveFade = null;
        if (this._reviveNode?.isValid && this._reviveScale) {
            this._reviveNode.setScale(this._reviveScale);
            const opacity = this._reviveNode.getComponent(UIOpacity);
            if (opacity) opacity.opacity = this._reviveOpacity;
        }
        this._reviveNode = null;
    }

    private _startRevivePulse(node: Node): void {
        this._stopRevivePulse();
        this._reviveNode = node;
        const scale = this._reviveScale = node.scale.clone();
        const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        this._reviveOpacity = opacity.opacity;
        this._reviveTween = tween(node).repeatForever(tween<Node>()
            .to(0.65, { scale: new Vec3(scale.x * 1.06, scale.y * 1.06, scale.z) }, { easing: 'sineInOut' })
            .to(0.65, { scale }, { easing: 'sineInOut' })).start();
        this._reviveFade = tween(opacity).repeatForever(tween<UIOpacity>()
            .to(0.65, { opacity: this._reviveOpacity * 0.72 }, { easing: 'sineInOut' })
            .to(0.65, { opacity: this._reviveOpacity }, { easing: 'sineInOut' })).start();
    }

    protected onDisable(): void { this._shareVersion++; this._stopRevivePulse(); super.onDisable(); }
    protected onDestroy(): void { this._shareVersion++; this._stopRevivePulse(); super.onDestroy(); }

    protected onLoad(): void {
        this._ensureCloseButton();
        this.wireButton(this.btnRevive, 'BtnRevive', () => {
            void this.flow.requestReward('revive', () => this.flow.revive());
        });
        this.wireButton(this.btnPrimary, 'BtnPrimary', () => this.flow.resultPrimary());
        this.wireButton(this.btnHome, 'BtnHome', () => this.flow.returnToLobby());
        this.wireButton(this.btnShare, 'BtnShare', () => this.flow.share());
        this.wireButton(this.btnClose, 'BtnClose', () => this.flow.returnToLobby());
    }

    public present(payload: ResultModalPayload): void {
        this._stopRevivePulse();
        const host = this.flow.node.parent;
        const entries = host?.getComponent(LobbyEntries) ?? host?.addComponent(LobbyEntries);
        entries?.bindRewardEntries(this.node);
        const moneyTool = this.findChildDeep(this.node, 'moneyTool');
        if (moneyTool) moneyTool.active = true;
        this._refreshResultDetails(payload);

        // 金星按评级激活：Summary 下 icon_starL-00X 灰星底常显，盖住它的 icon_starW 金星按星级点亮，失败全灭
        const stars = payload.win ? Math.min(3, Math.max(0, payload.stars)) : 0;
        [this.star1, this.star2, this.star3].forEach((bound, index) => {
            const star = this.resolveNode(bound, `Summary/icon_starL-00${index + 1}/icon_starW`);
            if (star) star.active = index < stars;
        });

        const revive = this.resolveNode(this.btnRevive, 'BtnRevive');
        if (revive) {
            revive.active = !payload.win && payload.canRevive;
        }

        const share = this.resolveNode(this.btnShare, 'BtnShare');
        this._shareWin = payload.win;
        if (share) share.active = payload.win && this.flow.platform?.supportsSharing !== false;

        const primary = this.resolveNode(this.btnPrimary, 'BtnPrimary');
        const primaryLabel = primary?.getComponentInChildren(Label);
        if (primaryLabel) {
            primaryLabel.string = payload.win && payload.hasNext ? '下一关' : '再玩一次';
        }

        this.open();
        void this._refreshShareVisibility();
        if (revive?.active) this._startRevivePulse(revive);
    }

    /** 只给新版数据节点赋值，不覆盖设计稿的颜色、位置和静态按钮文案。 */
    private _refreshResultDetails(payload: ResultModalPayload): void {
        const title = this.findChildDeep(this.node, 'Title');
        const summary = this.findChildDeep(this.node, 'Summary');
        const oldTitle = this.titleLabel ?? title?.getComponent(Label);
        const oldSummary = this.summaryLabel ?? summary?.getComponent(Label);
        if (oldTitle) oldTitle.string = '';
        if (oldSummary) oldSummary.string = '';
        // Summary 同时承载灰星和入场动画，成败都保留，只清空旧摘要文字。
        if (summary) summary.active = true;
        const setText = (root: Node | null, name: string, text: string) => {
            const label = root && this.findChildDeep(root, name)?.getComponent(Label);
            if (label) label.string = text;
        };
        const total = payload.level.differences.length;
        const found = Math.min(total, Math.max(0, Math.floor(payload.foundCount)));
        const winTitle = title && this.findChildDeep(title, 'WIN');
        const loseTitle = title && this.findChildDeep(title, 'Lose');
        if (winTitle) winTitle.active = payload.win;
        if (loseTitle) loseTitle.active = !payload.win;
        setText(loseTitle, 'Number', String(total - found));
        const reason = payload.failReason === 'lives' ? '生命耗尽' : '时间到';
        setText(loseTitle, 'Label-002', `${reason}，${payload.canRevive ? '复活可保留游玩进度' : '本局复活机会已用完'}`);

        const details = this.findChildDeep(this.node, 'level_card_selected');
        const foundGroup = details && this.findChildDeep(details, 'icon_fangda');
        const timeGroup = details && this.findChildDeep(details, 'icon_Time');
        setText(foundGroup, 'tips_found', payload.win ? '找到' : '已找到');
        setText(foundGroup, 'Number', `${found}/${total}`);
        const seconds = Math.max(0, Math.floor(payload.elapsedSeconds));
        const duration = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        setText(timeGroup, 'tips_Time', payload.win ? '用时' : payload.canRevive ? '复活增加' : '复活已用完');
        setText(timeGroup, 'Time', payload.win ? duration : payload.canRevive ? `${this.flow.reviveBonusSeconds}秒` : '—');
    }

    /** 场景未摆放 BtnClose 时自动创建右上角圆形 X 关闭键。 */
    private _ensureCloseButton(): void {
        if (this.btnClose?.isValid) return;
        const found = this.node.getChildByName('BtnClose');
        if (found) {
            this.btnClose = found;
            return;
        }
        const button = new Node('BtnClose');
        button.parent = this.node;
        button.setPosition(288, 298);
        const ui = button.addComponent(UITransform);
        ui.setContentSize(72, 72);
        const graphics = button.addComponent(Graphics);
        graphics.fillColor = UIColors.white;
        graphics.circle(0, 0, 36);
        graphics.fill();
        graphics.lineWidth = 5;
        graphics.strokeColor = UIColors.blue;
        graphics.circle(0, 0, 36);
        graphics.stroke();
        const labelNode = new Node('Label');
        labelNode.parent = button;
        const labelUi = labelNode.addComponent(UITransform);
        labelUi.setContentSize(72, 72);
        const label = labelNode.addComponent(Label);
        label.string = '×';
        label.fontSize = 48;
        label.color = UIColors.blue;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        this.btnClose = button;
    }

}
