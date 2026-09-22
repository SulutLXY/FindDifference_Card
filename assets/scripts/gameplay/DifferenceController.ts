import { Vec2, Vec3 } from 'cc';
import { DifferenceConfig } from '../core/GameTypes';

/** Keeps hit testing independent from the device resolution and sprite scale. */
export class DifferenceController {
    public static localToNormalized(local: Vec3, width: number, height: number): Vec2 {
        const x = (local.x + width * 0.5) / width;
        const y = 1 - (local.y + height * 0.5) / height;
        return new Vec2(x, y);
    }

    public static normalizedToLocal(difference: DifferenceConfig, width: number, height: number): Vec2 {
        return new Vec2(
            (difference.x - 0.5) * width,
            (0.5 - difference.y) * height,
        );
    }

    public static hitTest(
        position: Vec2,
        differences: DifferenceConfig[],
        foundIds: ReadonlySet<string>,
        width: number,
        height: number,
    ): DifferenceConfig | null {
        for (const difference of differences) {
            if (foundIds.has(difference.id)) continue;
            const dx = (position.x - difference.x) * width;
            const dy = (position.y - difference.y) * height;
            const radius = difference.radius * width;
            if (dx * dx + dy * dy <= radius * radius) return difference;
        }
        return null;
    }
}
