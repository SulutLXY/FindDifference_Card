import { _decorator, Color, Graphics, Label, Node, UITransform } from 'cc';
import { LevelConfig } from '../core/GameTypes';
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/** 成功标题字体色（与场景 Title 默认值一致） */
const TITLE_COLOR_WIN = new Color(0x79, 0x4b, 0x26, 255);

export interface ResultModalPayload {
    win: boolean;
    stars: number;
    elapsedSeconds: number;
    level: LevelConfig;
    canRevive: boolean;
    hasNext: boolean;
}

/**
 * 结算弹窗（ResultModal，独立于 Screens 之外的顶层节点）。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - Title       结算标题（Label），成功用默认色 #794B26，失败红色
 * - Summary     用时摘要（Label），成功「用时 X 秒」，失败「时间或生命已经耗尽」
 * - Summary 下 icon_starL-001/002/003 为灰星底图（常显），其子节点 icon_starW 为金星，
 *   按评级激活（1~3 颗），失败时全灭
 * - BtnRevive   看广告复活按钮（Node，失败时按需显示）
 * - BtnPrimary  主按钮（Node，文案自动切换「下一关 / 再玩一次」）
 * - BtnHome     返回选关按钮（Node）
 * - BtnShare    分享成绩按钮（Node，成功和失败均显示）
 * - BtnClose    右上角关闭按钮（Node，场景缺失时代码构建，成功/失败都回关卡选择页）
 */
@ccclass('ResultModal')
export class ResultModal extends UIScreen {
    @property({ type: Label, tooltip: '结算标题（命名 Title）' })
    public titleLabel: Label | null = null;

    @property({ type: Label, tooltip: '用时摘要（命名 Summary）' })
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

    @property({ type: Node, tooltip: '返回选关按钮（命名 BtnHome）' })
    public btnHome: Node | null = null;

    @property({ type: Node, tooltip: '分享成绩按钮（命名 BtnShare，成功和失败均显示）' })
    public btnShare: Node | null = null;

    @property({ type: Node, tooltip: '右上角关闭按钮（命名 BtnClose，场景缺失时代码构建）' })
    public btnClose: Node | null = null;

    protected onLoad(): void {
        this._ensureCloseButton();
        this.wireButton(this.btnRevive, 'BtnRevive', () => {
            void this.flow.requestReward('revive', () => this.flow.revive());
        });
        this.wireButton(this.btnPrimary, 'BtnPrimary', () => this.flow.resultPrimary());
        this.wireButton(this.btnHome, 'BtnHome', () => this.flow.showLevelSelect());
        this.wireButton(this.btnShare, 'BtnShare', () => this.flow.share());
        // 关闭按钮：成功/失败统一回关卡选择页（showLevelSelect 会自行关闭本弹窗）
        this.wireButton(this.btnClose, 'BtnClose', () => void this.flow.showLevelSelect());
    }

    public present(payload: ResultModalPayload): void {
        const moneyTool = this.findChildDeep(this.node, 'moneyTool');
        if (moneyTool) moneyTool.active = true;
        this.setLabel(this.titleLabel, 'Title', payload.win ? '挑战成功！' : '挑战失败');

        const summary = payload.win
            ? `用时 ${payload.elapsedSeconds} 秒`
            : '时间或生命已经耗尽';
        this.setLabel(this.summaryLabel, 'Summary', summary);

        // 金星按评级激活：Summary 下 icon_starL-00X 灰星底常显，盖住它的 icon_starW 金星按星级点亮，失败全灭
        const stars = payload.win ? Math.min(3, Math.max(0, payload.stars)) : 0;
        [this.star1, this.star2, this.star3].forEach((bound, index) => {
            const star = this.resolveNode(bound, `Summary/icon_starL-00${index + 1}/icon_starW`);
            if (star) star.active = index < stars;
        });

        const title = this.resolveLabel(this.titleLabel, 'Title');
        if (title) title.color = payload.win ? TITLE_COLOR_WIN : UIColors.red;

        const revive = this.resolveNode(this.btnRevive, 'BtnRevive');
        if (revive) revive.active = payload.canRevive;

        const share = this.resolveNode(this.btnShare, 'BtnShare');
        if (share) share.active = true;

        const primary = this.resolveNode(this.btnPrimary, 'BtnPrimary');
        const primaryLabel = primary?.getComponentInChildren(Label);
        if (primaryLabel) {
            primaryLabel.string = payload.win && payload.hasNext ? '下一关' : '再玩一次';
        }

        this.open();
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
