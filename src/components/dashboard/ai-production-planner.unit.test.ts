import { describe, expect, it, vi } from 'vitest';

vi.mock('@/firebase/client', () => ({ firestore: {} }));
vi.mock('@/auth-provider', () => ({
    useAuth: () => ({ user: null, loading: false }),
}));
vi.mock('@/lib/actions', () => ({
    runLineBalancer: vi.fn(),
}));

import {
    assessNextStyleFlow,
    getNextStylePrepWipLimit,
    type PlanQuality,
} from './ai-production-planner';

const quality = (overrides: Partial<PlanQuality>): PlanQuality => ({
    actualOutput: 180,
    primaryOutput: 180,
    nextOutput: 0,
    estimatedWip: 0,
    primaryWip: 0,
    nextWip: 0,
    ...overrides,
});

describe('ai-production-planner next-style flow guard', () => {
    it('accepts next style as continuous flow when it produces finished pieces without reducing current output materially', () => {
        const decision = assessNextStyleFlow(
            quality({ primaryOutput: 180 }),
            quality({ actualOutput: 195, primaryOutput: 179, nextOutput: 16, nextWip: 12 })
        );

        expect(decision.kind).toBe('continuous');
        expect(decision.primaryDrop).toBe(1);
    });

    it('accepts limited prep WIP when the next style cannot finish pieces yet', () => {
        const primaryOnly = quality({ primaryOutput: 180 });
        const decision = assessNextStyleFlow(
            primaryOnly,
            quality({ primaryOutput: 180, nextOutput: 0, nextWip: getNextStylePrepWipLimit(180) })
        );

        expect(decision.kind).toBe('prep');
    });

    it('blocks next style assignments that steal current-style output', () => {
        const decision = assessNextStyleFlow(
            quality({ primaryOutput: 180 }),
            quality({ actualOutput: 180, primaryOutput: 175, nextOutput: 5, nextWip: 0 })
        );

        expect(decision.kind).toBe('blocked');
        expect(decision.reason).toContain('reduces current style output');
    });

    it('blocks WIP-only next style plans above the prep cap', () => {
        const primaryOnly = quality({ primaryOutput: 180 });
        const decision = assessNextStyleFlow(
            primaryOnly,
            quality({
                primaryOutput: 180,
                nextOutput: 0,
                nextWip: getNextStylePrepWipLimit(180) + 1,
            })
        );

        expect(decision.kind).toBe('blocked');
        expect(decision.reason).toContain('without finished output');
    });
});
