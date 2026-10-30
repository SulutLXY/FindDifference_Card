import { sys } from 'cc';
import { ChapterRulesConfig, CityConfig, LevelProgress, SaveData } from '../core/GameTypes';

const SAVE_KEY = 'find-difference.save.v3';
/** v2 旧档 key，启动时读取并迁移后删除 */
const LEGACY_KEY = 'find-difference.save.v2';

const DEFAULT_SAVE: SaveData = {
    version: 3,
    energy: 15,
    chapterRulesVersion: 2,
    completed: {},
    totalScore: 0,
    achievements: {},
    musicEnabled: true,
    soundEnabled: true,
    freeHints: 2,
    freeAddTimes: 2,
};

/**
 * 存档服务：通关集合 + 积分制。
 * 解锁判定（依赖关卡顺序）由 GameFlow 负责，本服务只存取数据。
 */
export class SaveService {
    public readonly energyLimit = 99;
    public readonly energyRecoveryLimit = 15;
    private readonly _energyInterval = 8 * 60 * 1000;
    private _data: SaveData;

    constructor() {
        this._data = this._load();
        this._normalize();
        this._recoverEnergy();
    }

    public get data(): Readonly<SaveData> {
        return this._data;
    }

    public get energy(): number {
        this._recoverEnergy();
        return this._data.energy ?? 0;
    }

    public get energyRecoverySeconds(): number {
        if (this.energy >= this.energyRecoveryLimit) return 0;
        return Math.max(0, Math.ceil(((this._data.energyUpdatedAt ?? Date.now()) + this._energyInterval - Date.now()) / 1000));
    }

    /** 保留不足 8 分钟的余量；达到自动恢复上限后不累计时间，也不削减额外体力。 */
    private _recoverEnergy(now = Date.now()): void {
        const previous = this._data;
        let energy = Number.isSafeInteger(previous.energy) ? Math.max(0, Math.min(this.energyLimit, previous.energy!)) : 0;
        let updated = previous.energyUpdatedAt;
        if (!Number.isSafeInteger(updated) || updated! < 0 || updated! > now) updated = now;
        if (energy < this.energyRecoveryLimit) {
            const restored = Math.floor((now - updated!) / this._energyInterval);
            energy = Math.min(this.energyRecoveryLimit, energy + restored);
            updated = energy === this.energyRecoveryLimit ? now : updated! + restored * this._energyInterval;
        }
        if (energy === previous.energy && updated === previous.energyUpdatedAt) return;
        this._data = { ...previous, energy, energyUpdatedAt: updated };
        if (!this._persist()) this._data = previous;
    }

    /** 完整看完广告才原子保存体力；每日次数不限，计数仅作记录，失败时不扣。 */
    public claimEnergyAd(day: string): boolean {
        const energy = this.energy;
        if (energy >= this.energyLimit) return false;
        const previous = this._data;
        const used = previous.energyAdDay === day && Number.isSafeInteger(previous.energyAdsUsed)
            ? previous.energyAdsUsed! : 0;
        const next = Math.min(this.energyLimit, energy + 5);
        this._data = { ...previous, energy: next, energyAdDay: day, energyAdsUsed: used + 1,
            energyUpdatedAt: next >= this.energyRecoveryLimit ? Date.now() : previous.energyUpdatedAt };
        if (this._persist()) return true;
        this._data = previous;
        return false;
    }

    /** 仅在关卡已准备好、即将开始时扣除，保存失败则不允许开始。 */
    public consumeEnergy(): boolean {
        const energy = this.energy;
        if (energy < 1) return false;
        const previous = this._data;
        this._data = { ...previous, energy: energy - 1,
            energyUpdatedAt: energy >= this.energyRecoveryLimit ? Date.now() : previous.energyUpdatedAt };
        if (this._persist()) return true;
        this._data = previous;
        return false;
    }

    public hasLevelSelectAccess(now = Date.now()): boolean {
        const expires = this._data.levelSelectExpiresAt;
        return typeof expires === 'number' && Number.isSafeInteger(expires) && expires > now;
    }

    public grantLevelSelectAccess(now = Date.now()): boolean {
        if (!Number.isSafeInteger(now) || now < 0) return false;
        const previous = this._data;
        this._data = { ...previous, levelSelectExpiresAt: now + 24 * 60 * 60 * 1000 };
        if (this._persist()) return true;
        this._data = previous;
        return false;
    }

    /** 积分 = 已通关关卡数 */
    public get totalScore(): number {
        return this._data.totalScore;
    }

    public isCompleted(key: string): boolean {
        return (this._data.completed[key]?.stars ?? 0) > 0;
    }

    public setLastPlayedCity(key: string): void {
        if (this._data.lastPlayedCityKey === key) return;
        this._data = { ...this._data, lastPlayedCityKey: key, lastPlayedLevelKey: undefined };
        this._persist();
    }

    public setLastPlayedLevel(cityKey: string, levelKey: string): boolean {
        const previous = this._data;
        this._data = { ...previous, lastPlayedCityKey: cityKey, lastPlayedLevelKey: levelKey };
        if (this._persist()) return true;
        this._data = previous;
        return false;
    }

    public isLevelUnlocked(key: string): boolean {
        return Array.isArray(this._data.unlockedLevels) && this._data.unlockedLevels.includes(key);
    }

    /** 广告只授予目标关卡游玩资格；保存失败不得解锁。 */
    public unlockLevel(key: string): boolean {
        return this.unlockLevels([key]);
    }

    /** 整章解锁一次性保存全部小关资格；不写通关成绩，失败时整体回滚。 */
    public unlockLevels(keys: string[]): boolean {
        if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== 'string' || !key)) return false;
        if (keys.every(key => this.isLevelUnlocked(key))) return true;
        const previous = this._data;
        const levels = Array.isArray(previous.unlockedLevels) ? previous.unlockedLevels : [];
        this._data = { ...previous, unlockedLevels: Array.from(new Set([...levels, ...keys])) };
        if (this._persist()) return true;
        this._data = previous;
        return false;
    }

    /** 仅旧玩家执行：先恢复旧顺序下的资格，再一次性提交新规则版本。 */
    public migrateChapterRules(config: ChapterRulesConfig, cities: CityConfig[], forceLegacy = false): boolean {
        if (!forceLegacy && (this._data.chapterRulesVersion ?? 1) >= config.version) return true;
        const previous = this._data;
        const unlocked = new Set(previous.unlockedCities ?? []);
        const byKey = new Map(cities.map(city => [city.key, city]));
        for (const order of config.legacyOrders) {
            for (let index = 0; index < order.length; index++) {
                const city = byKey.get(order[index]);
                if (!city?.levels.length) continue;
                const before = index > 0 ? byKey.get(order[index - 1]) : undefined;
                if (index === 0 || (before?.levels.length
                    && before.levels.every(dir => this.isCompleted(`${before.key}/${dir}`)))) unlocked.add(city.key);
            }
        }
        for (const city of cities) {
            if (city.levels.some(dir => this.isCompleted(`${city.key}/${dir}`))) unlocked.add(city.key);
        }
        const available = cities.filter(city => unlocked.has(city.key));
        const incomplete = (city: CityConfig) => city.levels.some(dir => !this.isCompleted(`${city.key}/${dir}`));
        const resume = available.find(city => incomplete(city)
            && city.levels.some(dir => this.isCompleted(`${city.key}/${dir}`)))
            ?? available.find(incomplete) ?? available[0];
        const lastCity = byKey.get(previous.lastPlayedCityKey ?? '');
        this._data = {
            ...previous, unlockedCities: Array.from(unlocked), chapterRulesVersion: config.version,
            lastPlayedCityKey: lastCity && unlocked.has(lastCity.key) ? lastCity.key : resume?.key,
        };
        if (this._persist()) return true;
        this._data = previous;
        return false;
    }

    public isCityUnlocked(key: string): boolean {
        return Array.isArray(this._data.unlockedCities) && this._data.unlockedCities.includes(key);
    }

    public unlockCity(key: string): boolean {
        if (typeof key !== 'string' || !key) return false;
        if (this.isCityUnlocked(key)) return true;
        const previous = this._data;
        const cities = Array.isArray(previous.unlockedCities) ? previous.unlockedCities : [];
        this._data = { ...previous, unlockedCities: [...cities, key] };
        if (this._persist()) return true;
        this._data = previous;
        return false;
    }

    public progressOf(key: string): LevelProgress | undefined {
        return this._data.completed[key];
    }

    public get freeHints(): number {
        const value = this._data.freeHints;
        return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
    }

    public get freeAddTimes(): number {
        const value = this._data.freeAddTimes;
        return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
    }

    /** 奖励、收集统一写入玩家库存，失败时回滚。 */
    public grantAssist(kind: 'hint' | 'add-time', amount = 1): boolean {
        const field = kind === 'hint' ? 'freeHints' : 'freeAddTimes';
        const count = kind === 'hint' ? this.freeHints : this.freeAddTimes;
        if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(count + amount)) return false;
        const previous = this._data;
        this._data = { ...previous, [field]: count + amount };
        if (this._persist()) return true;
        this._data = previous;
        return false;
    }

    public consumeAddTime(): boolean {
        if (!this.freeAddTimes) return false;
        const previous = this._data;
        this._data = { ...previous, freeAddTimes: this.freeAddTimes - 1 };
        if (this._persist()) return true;
        this._data = previous;
        return false;
    }

    /** 在开局时登记，保护本日首局（包括失败、复活及退出）。 */
    public beginDailyFirstRound(day: string): boolean {
        if (this._data.firstPlayedDay === day) return false;
        this._data = { ...this._data, firstPlayedDay: day };
        this._persist();
        return true;
    }

    public completeTutorial(): void {
        this._data.tutorialCompleted = true;
        this._persist();
    }

    /** 分时引导只展示一次，无论玩家点击高亮还是跳过都登记。 */
    public markAssistTutorialShown(kind: 'hint' | 'zoom' | 'add-time'): void {
        if (kind === 'hint') this._data.tutorialHintShown = true;
        else if (kind === 'zoom') this._data.tutorialZoomShown = true;
        else this._data.tutorialAddTimeShown = true;
        this._persist();
    }

    public hasClaimedSidebar(day: string): boolean {
        return typeof this._data.sidebarClaimDay === 'string' && this._data.sidebarClaimDay >= day;
    }

    /** Consume the first-failure protection even if ads are unavailable or cooling down. */
    public protectFirstFailure(day: string): boolean {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true;
        if (typeof this._data.firstFailureInterstitialDay === 'string'
            && this._data.firstFailureInterstitialDay >= day) return false;
        this._data = { ...this._data, firstFailureInterstitialDay: day };
        // Keep the protection in memory on a failed write; a new session will protect again.
        this._persist();
        return true;
    }

    public hasClaimedFavorite(day: string): boolean {
        return typeof this._data.favoriteClaimDay === 'string' && this._data.favoriteClaimDay >= day;
    }

    public claimFavorite(day: string, amount = 2): 'claimed' | 'already-claimed' | 'storage-error' {
        if (this.hasClaimedFavorite(day)) return 'already-claimed';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(amount) || amount <= 0
            || !Number.isSafeInteger(this.freeHints + amount)) return 'storage-error';
        const previous = this._data;
        this._data = { ...previous, freeHints: this.freeHints + amount, favoriteClaimDay: day };
        if (this._persist()) return 'claimed';
        this._data = previous;
        return 'storage-error';
    }

    /** Save the reward and claim marker together; don't grant on a failed write. */
    public claimSidebar(day: string, amount: number): 'claimed' | 'already-claimed' | 'storage-error' {
        if (this.hasClaimedSidebar(day)) return 'already-claimed';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(amount) || amount <= 0
            || !Number.isSafeInteger(this.freeHints + amount)) return 'storage-error';
        const previous = this._data;
        this._data = { ...previous, freeHints: this.freeHints + amount, sidebarClaimDay: day };
        if (this._persist()) return 'claimed';
        this._data = previous;
        return 'storage-error';
    }

    public consumeFreeHint(): boolean {
        if (this.freeHints === 0) return false;
        const previous = this._data;
        this._data = { ...previous, freeHints: this.freeHints - 1 };
        if (this._persist()) return true;
        this._data = previous;
        return false;
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

    public getFoodReview(key: string): string {
        const value = this._data.foodReviews?.[key];
        return typeof value === 'string' ? value : '';
    }
    public setFoodReview(key: string, value: string): string {
        const text = Array.from(value.replace(/[\r\n]+/g, ' ').trim()).slice(0, 50).join('');
        if (!text) return '';
        this._data.foodReviews = { ...this._data.foodReviews, [key]: text };
        this._persist();
        return text;
    }

    public reset(): void {
        this._data = { ...DEFAULT_SAVE, completed: {}, achievements: {} };
        this._persist();
    }

    public setMusicEnabled(enabled: boolean): void {
        this._data.musicEnabled = enabled;
        this._persist();
    }

    public setSoundEnabled(enabled: boolean): void {
        this._data.soundEnabled = enabled;
        this._persist();
    }

    /** 启动校准：积分与实际通关集合对齐（防御冗余字段漂移）。 */
    private _normalize(): void {
        // 插入 2026 热梗后，原城市目录编号顺延；同时保留通关、解锁和评价。
        const oldCities = ['beijing', 'shanghai', 'nanjing', 'xiamen', 'changsha', 'guangzhou', 'chengdu', 'xian'];
        const rename = (key: string): string => {
            for (let i = 0; i < oldCities.length; i++) {
                const oldKey = `city-${String(i + 1).padStart(2, '0')}-${oldCities[i]}`;
                if (key === oldKey || key.startsWith(oldKey + '/') || key.startsWith(oldKey + '-')) {
                    return `city-${String(i + 2).padStart(2, '0')}-${oldCities[i]}` + key.slice(oldKey.length);
                }
            }
            return key;
        };
        for (const key of Object.keys(this._data.completed)) {
            const next = rename(key);
            if (next === key) continue;
            const old = this._data.completed[key];
            const current = this._data.completed[next];
            const times = [old.bestTime, current?.bestTime].filter(t => typeof t === 'number' && t > 0);
            this._data.completed[next] = {
                stars: Math.max(old.stars, current?.stars ?? 0),
                bestTime: times.length ? Math.min(...times) : 0,
            };
            delete this._data.completed[key];
        }
        const unlockedCities = new Set<string>(Array.isArray(this._data.unlockedCities)
            ? this._data.unlockedCities
                .filter((key): key is string => typeof key === 'string' && key.length > 0)
                .map(rename)
            : []);
        // 旧构建错误地将 Set 展开为 [{}]，有通关记录的大关卡可据此恢复解锁。
        // 只读取原位置的有效通关，不移动或修改完成记录。
        for (const key of Object.keys(this._data.completed)) {
            if (!(this._data.completed[key]?.stars > 0)) continue;
            const city = /^(city-[^/]+)\//.exec(key);
            if (city) unlockedCities.add(city[1]);
        }
        // Creator 的 loose 转译会把 [...Set] 编成 [].concat(Set)，必须显式转数组。
        this._data.unlockedCities = Array.from(unlockedCities);
        if (this._data.foodReviews) {
            for (const key of Object.keys(this._data.foodReviews)) {
                const next = rename(key);
                if (next === key) continue;
                this._data.foodReviews[next] ??= this._data.foodReviews[key];
                delete this._data.foodReviews[key];
            }
        }
        this._recountScore();
        // 首次赠送写入存档，库存耗尽后不会在下次启动重新赠送。
        this._persist();
    }

    private _recountScore(): void {
        let score = 0;
        const completed = this._data.completed;
        for (const key of Object.keys(completed)) {
            if (completed[key].stars > 0) score++;
        }
        this._data.totalScore = score;
    }

    private _load(): SaveData {
        try {
            const raw = sys.localStorage.getItem(SAVE_KEY);
            if (!raw) return { ...DEFAULT_SAVE, completed: {}, achievements: {} };
            const parsed = JSON.parse(raw) as Partial<SaveData>;
            return {
                ...DEFAULT_SAVE,
                ...parsed,
                chapterRulesVersion: parsed.chapterRulesVersion ?? 1,
                completed: parsed.completed ?? {},
                achievements: parsed.achievements ?? {},
            };
        } catch (error) {
            console.warn('Save data is invalid; a new save will be used.', error);
            return { ...DEFAULT_SAVE, completed: {}, achievements: {} };
        }
    }

    private _persist(): boolean {
        try {
            sys.localStorage.setItem(SAVE_KEY, JSON.stringify(this._data));
            return true;
        } catch (error) {
            console.warn('Unable to persist save data.', error);
            return false;
        }
    }
}
