import { sys } from 'cc';
import { LevelProgress, SaveData } from '../core/GameTypes';

const SAVE_KEY = 'find-difference.save.v3';
/** v2 旧档 key，启动时读取并迁移后删除 */
const LEGACY_KEY = 'find-difference.save.v2';

const DEFAULT_SAVE: SaveData = {
    version: 3,
    completed: {},
    totalScore: 0,
    achievements: {},
    musicEnabled: true,
    soundEnabled: true,
};

/**
 * 存档服务：通关集合 + 积分制。
 * 解锁判定（依赖关卡顺序）由 GameFlow 负责，本服务只存取数据。
 */
export class SaveService {
    private _data: SaveData;

    constructor() {
        this._data = this._load();
        this._normalize();
    }

    public get data(): Readonly<SaveData> {
        return this._data;
    }

    /** 积分 = 已通关关卡数 */
    public get totalScore(): number {
        return this._data.totalScore;
    }

    public isCompleted(key: string): boolean {
        return (this._data.completed[key]?.stars ?? 0) > 0;
    }

    public progressOf(key: string): LevelProgress | undefined {
        return this._data.completed[key];
    }

    /** 通关一关：+1 积分（重复通关不重复加分），星级与最佳时间取最优。 */
    public completeLevel(key: string, stars: number, elapsedSeconds: number): void {
        const previous = this._data.completed[key];
        this._data.completed[key] = {
            stars: Math.max(previous?.stars ?? 0, stars),
            bestTime: previous && previous.bestTime > 0
                ? Math.min(previous.bestTime, elapsedSeconds)
                : elapsedSeconds,
        };
        this._recountScore();
        this._persist();
    }

    public recordAchievement(id: string): void {
        if (this._data.achievements[id]) return;
        this._data.achievements[id] = Date.now();
        this._persist();
    }

    /**
     * 迁移 v2 旧档：旧档按全局关卡号顺序记录，keys 为按同样顺序排好的新关卡 key 列表。
     * 迁移成功返回 true（旧档随后删除），无旧档返回 false。
     */
    public migrateLegacy(keys: string[]): boolean {
        try {
            const raw = sys.localStorage.getItem(LEGACY_KEY);
            if (!raw) return false;
            const legacy = JSON.parse(raw) as { unlockedLevel?: number; levels?: Record<string, { stars: number; bestTime: number }> };
            const unlocked = Math.min(Math.max(legacy.unlockedLevel ?? 0, 0), keys.length);
            for (let i = 0; i < unlocked; i++) {
                const progress = legacy.levels?.[String(i + 1)];
                this._data.completed[keys[i]] = {
                    stars: Math.max(1, progress?.stars ?? 1),
                    bestTime: progress?.bestTime ?? 0,
                };
            }
            sys.localStorage.removeItem(LEGACY_KEY);
            this._recountScore();
            this._persist();
            console.log(`[SaveService] v2 存档已迁移：${unlocked} 关进度`);
            return true;
        } catch (error) {
            console.warn('[SaveService] v2 存档迁移失败', error);
            return false;
        }
    }

    public reset(): void {
        this._data = { ...DEFAULT_SAVE, completed: {}, achievements: {} };
        this._persist();
    }

    /** 启动校准：积分与实际通关集合对齐（防御冗余字段漂移）。 */
    private _normalize(): void {
        this._recountScore();
    }

    private _recountScore(): void {
        this._data.totalScore = Object.values(this._data.completed)
            .filter(progress => progress.stars > 0).length;
    }

    private _load(): SaveData {
        try {
            const raw = sys.localStorage.getItem(SAVE_KEY);
            if (!raw) return { ...DEFAULT_SAVE, completed: {}, achievements: {} };
            const parsed = JSON.parse(raw) as Partial<SaveData>;
            return {
                ...DEFAULT_SAVE,
                ...parsed,
                completed: parsed.completed ?? {},
                achievements: parsed.achievements ?? {},
            };
        } catch (error) {
            console.warn('Save data is invalid; a new save will be used.', error);
            return { ...DEFAULT_SAVE, completed: {}, achievements: {} };
        }
    }

    private _persist(): void {
        try {
            sys.localStorage.setItem(SAVE_KEY, JSON.stringify(this._data));
        } catch (error) {
            console.warn('Unable to persist save data.', error);
        }
    }
}
