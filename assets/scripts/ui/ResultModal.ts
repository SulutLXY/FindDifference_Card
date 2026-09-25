import { _decorator, Color, Label, Node } from 'cc';
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
 * - BtnShare    分享成绩按钮（Node，仅挑战成功时显示）
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

    @property({ type: Node, tooltip: '分享成绩按钮（命名 BtnShare，仅成功时显示）' })
    public btnShare: Node | null = null;

    protected onLoad(): void {
        this.wireButton(this.btnRevive, 'BtnRevive', () => {
            void this.flow.requestReward('revive', () => this.flow.revive());
        });
        this.wireButton(this.btnPrimary, 'BtnPrimary', () => this.flow.resultPrimary());
        this.wireButton(this.btnHome, 'BtnHome', () => this.flow.showLevelSelect());
        this.wireButton(this.btnShare, 'BtnShare', () => this.flow.share());
    }

    public present(payload: ResultModalPayload): void {
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
        if (share) share.active = payload.win;

        const primary = this.resolveNode(this.btnPrimary, 'BtnPrimary');
        const primaryLabel = primary?.getComponentInChildren(Label);
        if (primaryLabel) {
            primaryLabel.string = payload.win && payload.hasNext ? '下一关' : '再玩一次';
        }

        this.open();
    }

}
