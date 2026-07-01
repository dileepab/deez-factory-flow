import { describe, it, expect, vi } from 'vitest';

vi.mock('@/firebase/client', () => ({ firestore: {} }));
vi.mock('@/auth-provider', () => ({
    useAuth: () => ({ user: null, loading: false }),
}));

import { calculateOutputFromEvent, generateOperatorAdvice } from './production-planner';

describe('production-planner helpers (unit)', () => {
    describe('calculateOutputFromEvent', () => {
        it('prioritizes primary output when an op exists in both primary and next final operations', () => {
            const result = calculateOutputFromEvent(
                { opId: 'op-final', count: 12 },
                [{ id: 'op-final' }],
                [{ id: 'op-final' }]
            );

            expect(result).toEqual({ primary: 12, next: 0 });
        });

        it('returns zero output for zero-count events', () => {
            const result = calculateOutputFromEvent(
                { opId: 'op-final', count: 0 },
                [{ id: 'op-final' }],
                []
            );

            expect(result).toEqual({ primary: 0, next: 0 });
        });
    });

    describe('generateOperatorAdvice', () => {
        it('returns transition advice for mixed primary/next style tasks', () => {
            const result = generateOperatorAdvice(
                true,
                [
                    { op: { id: 'cut', name: 'Cut', dependencies: [] }, style: 'primary' as const },
                    { op: { id: 'pack', name: 'Pack', dependencies: [] }, style: 'next' as const },
                ],
                ['10 pcs Cut', '10 pcs Pack (Next)']
            );

            expect(result.type).toBe('flow');
            expect(result.advice).toContain('Transition Required');
            expect(result.advice).toContain('Cut');
        });

        it('returns sequential flow advice when tasks are self-dependent', () => {
            const result = generateOperatorAdvice(
                false,
                [
                    { op: { id: 'A', name: 'Shoulder Join', dependencies: [] }, style: 'primary' as const },
                    { op: { id: 'B', name: 'Side Seam', dependencies: ['A'] }, style: 'primary' as const },
                ],
                ['10 pcs Shoulder Join', '10 pcs Side Seam']
            );

            expect(result.type).toBe('flow');
            expect(result.advice).toContain('Sequential Flow Required');
            expect(result.advice).toContain('10 pcs Shoulder Join -> 10 pcs Side Seam');
        });

        it('returns rotation advice for independent tasks', () => {
            const result = generateOperatorAdvice(
                false,
                [
                    { op: { id: 'A', name: 'Shoulder Join', dependencies: [] }, style: 'primary' as const },
                    { op: { id: 'C', name: 'Label Attach', dependencies: [] }, style: 'primary' as const },
                ],
                ['15 pcs Shoulder Join', '15 pcs Label Attach']
            );

            expect(result.type).toBe('rotate');
            expect(result.advice).toContain('Split / Rotation Priority');
            expect(result.advice).toContain('15 pcs Shoulder Join, then 15 pcs Label Attach');
        });

        it('handles empty task lists without throwing', () => {
            const result = generateOperatorAdvice(false, [], []);

            expect(result.type).toBe('rotate');
            expect(result.advice).toContain('Split / Rotation Priority');
        });
    });
});
