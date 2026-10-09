import { Vec2, Vec3 } from 'cc';
import { DifferenceConfig } from '../core/GameTypes';

/** Keeps hit testing independent from the device resolution and sprite scale. */
export class DifferenceController {
    /** Shared local-space radius for hit testing and found markers. */
    public static radiusToLocal(difference: DifferenceConfig, width: number, height: number): number {
        return difference.radius * Math.min(width, height);
    }

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

    /** 边缘差异的点击容错系数：中心距边缘小于半径时判定圈按比例扩大。 */
    public static readonly EDGE_TOLERANCE_RATIO = 1.4;

    public static hitTest(
        position: Vec2,
        differences: DifferenceConfig[],
        foundIds: ReadonlySet<string>,
        width: number,
        height: number,
        includeFound = false,
    ): DifferenceConfig | null {
        for (const difference of differences) {
            if (!includeFound && foundIds.has(difference.id)) continue;
            const dx = (position.x - difference.x) * width;
            const dy = (position.y - difference.y) * height;
            let radius = this.radiusToLocal(difference, width, height);
            const edgeDistance = Math.min(
                difference.x * width,
                width - difference.x * width,
                difference.y * height,
                height - difference.y * height,
            );
            if (edgeDistance < radius) radius *= this.EDGE_TOLERANCE_RATIO;
            if (dx * dx + dy * dy <= radius * radius) return difference;
        }
        return null;
    }
}
