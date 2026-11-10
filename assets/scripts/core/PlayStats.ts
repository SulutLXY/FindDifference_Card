export interface PlayStatsConfig {
    enabled: boolean;
    initialCounts?: Record<string, number>;
    newChapters?: string[];
}

/** Display is abbreviated; the service retains the exact integer count. */
export function formatPlayCount(count: number): string {
    if (!Number.isSafeInteger(count) || count < 0) return '';
    if (count < 1000) return String(count);
    const unit = count < 1000000 ? 1000 : count < 1000000000 ? 1000000 : 1000000000;
    return `${Math.floor(count / (unit / 100)) / 100}${unit === 1000 ? 'K' : unit === 1000000 ? 'M' : 'B'}`;
}
