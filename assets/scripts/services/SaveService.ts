import { sys } from 'cc';
import { SaveData } from '../core/GameTypes';

const SAVE_KEY = 'find-difference.save.v2';

const DEFAULT_SAVE: SaveData = {
    version: 2,
    unlockedLevel: 1,
    levels: {},
    musicEnabled: true,
    soundEnabled: true,
};

export class SaveService {
    private _data: SaveData;

    constructor() {
        this._data = this._load();
    }

    public get data(): Readonly<SaveData> {
        return this._data;
    }

    public isUnlocked(levelId: number): boolean {
        return levelId <= this._data.unlockedLevel;
    }

    public completeLevel(levelId: number, stars: number, elapsedSeconds: number): void {
        const key = String(levelId);
        const previous = this._data.levels[key];
        this._data.levels[key] = {
            stars: Math.max(previous?.stars ?? 0, stars),
            bestTime: previous && previous.bestTime > 0
                ? Math.min(previous.bestTime, elapsedSeconds)
                : elapsedSeconds,
        };
        this._data.unlockedLevel = Math.min(5, Math.max(this._data.unlockedLevel, levelId + 1));
        this._persist();
    }

    public reset(): void {
        this._data = { ...DEFAULT_SAVE, levels: {} };
        this._persist();
    }

    private _load(): SaveData {
        try {
            const raw = sys.localStorage.getItem(SAVE_KEY);
            if (!raw) return { ...DEFAULT_SAVE, levels: {} };
            const parsed = JSON.parse(raw) as Partial<SaveData>;
            return {
                ...DEFAULT_SAVE,
                ...parsed,
                levels: parsed.levels ?? {},
            };
        } catch (error) {
            console.warn('Save data is invalid; a new save will be used.', error);
            return { ...DEFAULT_SAVE, levels: {} };
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
