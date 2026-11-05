/** contentID identifies platform content; it is not a consumable subscription token. */
export interface FeedContent {
    contentID: string;
    scene: number | null;
    recommendationText: string;
    subscriptionText: string;
    levelKey?: string;
}

export interface FeedConfig {
    enabled: boolean;
    serverlessEnabled: boolean;
    revisitEnabled: boolean;
    acquisitionEnabled: boolean;
    contents: FeedContent[];
    acquisitionContentID: string;
    acquisitionLevelKey?: string;
}

export interface FeedProgress {
    firstDay: string;
    legacyPlayer: boolean;
    visited: string[];
    offerDay: string;
    offered: string[];
    attemptDay: string;
    attempts: number;
    cycleStart: number;
    planKey: string;
    uploaded: string[];
    energyReadyAt?: number;
    consumed?: string[];
    cleared?: string[];
}

export const FEED_DAY_MS = 24 * 60 * 60 * 1000;
export const FEED_FIRST_DAY_MILESTONES = [1, 2, 3, 5, 8, 10, 15];

/** First three at +2/+4/+6 h, the remaining eighteen at +1 ... +18 d. */
export function feedReadyAt(cycleStart: number, index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= 21) throw new Error('Invalid Feed slot');
    return cycleStart + (index < 3 ? (index + 1) * 2 * 60 * 60 * 1000 : (index - 2) * FEED_DAY_MS);
}

export function feedPlanKey(config: FeedConfig): string | null {
    if (!config.enabled || !config.revisitEnabled || !config.serverlessEnabled
        || !Array.isArray(config.contents) || config.contents.length !== 21) return null;
    const ids = new Set<string>();
    for (const content of config.contents) {
        if (!/^CONTENT\d+$/.test(content.contentID) || ![1, 2, 3].includes(content.scene as number)
            || ids.has(content.contentID)) return null;
        ids.add(content.contentID);
    }
    return config.contents.map(content => `${content.scene}:${content.contentID}`).join('|');
}

export function feedCanOffer(state: FeedProgress, day: string, ordinal: number): boolean {
    const firstDay = !state.legacyPlayer && state.firstDay === day;
    const limit = firstDay ? 6 : 1;
    if (state.attemptDay === day && state.attempts >= limit) return false;
    if (firstDay && !FEED_FIRST_DAY_MILESTONES.includes(ordinal)) return false;
    return state.offerDay !== day || !state.offered.includes(firstDay ? String(ordinal) : 'daily');
}
