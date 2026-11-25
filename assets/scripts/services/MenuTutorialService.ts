import type { Node } from 'cc';
import type { MenuTutorialKind, MenuTutorialStep } from '../core/GameTypes';

export interface MenuTutorialTarget {
    node: Node;
    activate: () => boolean | Promise<boolean>;
}

interface MenuTutorialHost {
    page: () => 'lobby' | 'chapters' | 'collection' | 'other';
    blocked: () => boolean;
    state: (kind: MenuTutorialKind) => MenuTutorialStep | undefined;
    save: (kind: MenuTutorialKind, step: MenuTutorialStep) => boolean;
    hasCollectible: () => boolean;
    target: (kind: MenuTutorialKind, step: 'entry' | 'target') => MenuTutorialTarget | null;
    show: (target: Node, message: string, done: (hit: boolean) => void) => boolean;
    dismiss: () => void;
    notify: (message: string) => void;
}

/** Two independent, resumable menu guides. No automatic navigation or rewards. */
export class MenuTutorialService {
    private _armed = false;
    private _collectionReady = false;
    private _disposed = false;
    private _acting = false;
    private _elapsed = 0;
    private _active: { kind: MenuTutorialKind; step: 'entry' | 'target'; target: MenuTutorialTarget;
        page: string } | null = null;

    constructor(private readonly host: MenuTutorialHost) {}

    private _state(kind: MenuTutorialKind): MenuTutorialStep | undefined {
        const value = this.host.state(kind);
        return value === 'entry' || value === 'target' || value === 'done' ? value : undefined;
    }

    private _eligible(kind: MenuTutorialKind): boolean {
        return kind !== 'collection' || (this._collectionReady && this.host.hasCollectible());
    }

    public get hasPending(): boolean {
        return !this._disposed && (this._acting || !!this._active
            || (this._armed && (this._state('chapters') !== 'done'
                || (this._state('collection') !== 'done' && this.host.hasCollectible())))
            || ['chapters', 'collection'].some(kind => {
                const step = this._state(kind as MenuTutorialKind);
                return this._eligible(kind as MenuTutorialKind) && (step === 'entry' || step === 'target');
            }));
    }

    /** Arm before opening home so an automatic sign-in cannot win the first frame. */
    public armHomeReturn(): void { if (!this._disposed) this._armed = true; }

    public onReturnedHome(): void {
        if (this._disposed || this.host.page() !== 'lobby') return;
        this._armed = false;
        // 获得收藏后仍需真实回到主页；旧的 entry/target 不能在启动或领取当帧自动触发。
        this._collectionReady = this.host.hasCollectible();
        for (const kind of ['chapters', 'collection'] as const) {
            if (this._state(kind) === 'done' || !this._eligible(kind)) continue;
            if (!this.host.save(kind, 'entry')) this.host.notify('引导进度保存失败，请稍后重试');
        }
    }

    public onPageChanged(): void {
        if (this._active) this.host.dismiss();
        this._active = null;
    }

    public update(dt: number): void {
        if (this._disposed) return;
        this._elapsed += dt;
        if (this._elapsed < 0.15) return;
        this._elapsed = 0;
        const page = this.host.page();
        if (this._active) {
            const active = this._active;
            if (!this._eligible(active.kind) || this.host.blocked() || page !== active.page || !active.target.node.isValid
                || !active.target.node.activeInHierarchy || this._state(active.kind) !== active.step) this.onPageChanged();
            return;
        }
        if (this._acting || this.host.blocked()) return;
        for (const kind of ['chapters', 'collection'] as const) {
            if (!this._eligible(kind)) continue;
            let step = this._state(kind);
            // Back/relaunch or a failed lazy page load resumes from the home button.
            if (step === 'target' && page === 'lobby') {
                if (!this.host.save(kind, 'entry')) return;
                step = 'entry';
            }
            if (step !== 'entry' && step !== 'target') continue;
            const destination = kind === 'chapters' ? 'chapters' : 'collection';
            if ((step === 'entry' && page !== 'lobby') || (step === 'target' && page !== destination)) continue;
            const target = this.host.target(kind, step);
            if (!target?.node.isValid || !target.node.activeInHierarchy) return;
            const active = { kind, step, target, page };
            const message = kind === 'chapters'
                ? step === 'entry' ? '点击“选择关卡”，看看其他专题' : '点击这里，进入第二个专题'
                : step === 'entry' ? '点击“收藏册”，查看获得的物品' : '点击第一件收藏，打开详情';
            this._active = active;
            if (!this.host.show(target.node, message, hit => {
                if (this._disposed || this._active !== active) return;
                this._active = null;
                this.host.dismiss();
                if (!hit) {
                    if (!this.host.save(kind, 'done')) this.host.notify('引导进度保存失败，请重试');
                    return;
                }
                if (!this._eligible(kind) || this.host.blocked() || this.host.page() !== page || !target.node.isValid || !target.node.activeInHierarchy) return;
                if (step === 'entry' && !this.host.save(kind, 'target')) {
                    this.host.notify('引导进度保存失败，请重试'); return;
                }
                this._acting = true;
                void Promise.resolve().then(() => {
                    if (this._disposed || !this._eligible(kind) || this.host.blocked() || this.host.page() !== page
                        || !target.node.isValid || !target.node.activeInHierarchy) return false;
                    return target.activate();
                }).then(opened => {
                    if (!this._disposed && opened && step === 'target' && this._state(kind) === 'target' && !this.host.save(kind, 'done'))
                        this.host.notify('引导进度保存失败，请重试');
                }).catch(error => console.warn('[MenuTutorial] 导航未完成，保留引导进度', error))
                    .finally(() => { this._acting = false; });
            })) this._active = null;
            else console.info(`[MenuTutorial] show kind=${kind} step=${step}`);
            return;
        }
    }

    public dispose(): void {
        this.onPageChanged();
        this._disposed = true;
        this._armed = false;
        this._collectionReady = false;
    }
}
