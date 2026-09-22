import { _decorator, Label, Node } from 'cc';
import { LevelConfig } from '../core/GameTypes';
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

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
 * - Title       结算标题（Label）
 * - Summary     星级与用时摘要（Label）
 * - BtnRevive   看广告复活按钮（Node，失败时按需显示）
 * - BtnPrimary  主按钮（Node，文案自动切换「下一关 / 再玩一次」）
 * - BtnHome     返回选关按钮（Node）
 * - BtnShare    分享成绩按钮（Node）
 */
@ccclass('ResultModal')
export class ResultModal extends UIScreen {
    @property({ type: Label, tooltip: '结算标题（命名 Title）' })
    public titleLabel: Label | null = null;

    @property({ type: Label, tooltip: '星级与用时摘要（命名 Summary）' })
    public summaryLabel: Label | null = null;

    @property({ type: Node, tooltip: '看广告复活按钮（命名 BtnRevive）' })
    public btnRevive: Node | null = null;

    @property({ type: Node, tooltip: '主按钮（命名 BtnPrimary，文案自动切换）' })
    public btnPrimary: Node | null = null;

    @property({ type: Node, tooltip: '返回选关按钮（命名 BtnHome）' })
    public btnHome: Node | null = null;

    @property({ type: Node, tooltip: '分享成绩按钮（命名 BtnShare）' })
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
            ? `${'★'.repeat(payload.stars)}${'☆'.repeat(3 - payload.stars)}\n用时 ${payload.elapsedSeconds} 秒`
            : '时间或生命已经耗尽';
        this.setLabel(this.summaryLabel, 'Summary', summary);

        const title = this.resolveLabel(this.titleLabel, 'Title');
        if (title) title.color = payload.win ? UIColors.gold : UIColors.red;

        const revive = this.resolveNode(this.btnRevive, 'BtnRevive');
        if (revive) revive.active = payload.canRevive;

        const primary = this.resolveNode(this.btnPrimary, 'BtnPrimary');
        const primaryLabel = primary?.getComponentInChildren(Label);
        if (primaryLabel) {
            primaryLabel.string = payload.win && payload.hasNext ? '下一关' : '再玩一次';
        }

        this.open();
    }

}
