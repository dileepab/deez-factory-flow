
import { describe, it, expect } from 'vitest';
import { simulateProductionSchedule } from './simulation-engine';
import type { GarmentStyle, Operator } from '@/lib/types';

describe('Simulation Engine - Operator Delays', () => {
    const style: GarmentStyle = {
        id: 'style1',
        name: 'Test Style',
        buyer: 'Test Buyer',
        totalSmv: 10 / 60,
        operations: [
            { id: 'op1', name: 'Sewing', machineType: 'Sewing Machine', smv: 10, dependencies: [], completedQuantity: 0 },
        ],
        status: 'active',
        startDate: '2026-06-30',
        quantity: 1000
    };

    const alice: Operator = {
        id: 'alice',
        name: 'Alice',
        role: 'operator',
        email: 'alice@test.com',
        skills: ['Sewing Machine'],
        efficiencyRating: 100
    };

    const machineCounts = { 'Sewing Machine': 5 };
    const availableMinutes = 120; // 2 hours

    it('should start operator at T=0 when no delay is present', () => {
        const assignments = [{ operationId: 'op1', operatorIds: ['alice'] }];
        const result = simulateProductionSchedule(
            style,
            assignments,
            [alice],
            machineCounts,
            availableMinutes,
            0 // switchDelay
        );

        const aliceSchedule = result.schedule['alice'];
        expect(aliceSchedule).toBeDefined();
        expect(aliceSchedule.length).toBeGreaterThan(0);
        expect(aliceSchedule[0].start).toBe(0);
    });

    it('should start operator after delay when delay is present', () => {
        const delayMins = 30;
        const assignments = [{ operationId: 'op1', operatorIds: ['alice'] }];

        // Pass delay map: { 'alice': 30 }
        const result = simulateProductionSchedule(
            style,
            assignments,
            [alice],
            machineCounts,
            availableMinutes,
            0, // switchDelay
            undefined, // nextStyle
            undefined, // nextAssignments
            { 'alice': delayMins } // operatorDelays
        );

        const aliceSchedule = result.schedule['alice'];
        expect(aliceSchedule).toBeDefined();
        if (aliceSchedule.length > 0) {
            // The first task should start at or after delayMins
            expect(aliceSchedule[0].start).toBeGreaterThanOrEqual(delayMins);
        } else {
            // valid if availableMinutes < delay
            expect(availableMinutes).toBeLessThan(delayMins);
        }
    });

    it('should handle delays for multiple operators correctly', () => {
        const bob: Operator = { ...alice, id: 'bob', name: 'Bob' };
        const assignments = [{ operationId: 'op1', operatorIds: ['alice', 'bob'] }];

        // Increase minutes to avoid MIN_BATCH issues
        const extendedMinutes = 240; // 4 hours

        const result = simulateProductionSchedule(
            style,
            assignments,
            [alice, bob],
            machineCounts,
            extendedMinutes,
            0,
            undefined,
            undefined,
            { 'alice': 60, 'bob': 0 } // Alice late 60m, Bob on time
        );

        const aliceSched = result.schedule['alice'];
        const bobSched = result.schedule['bob'];

        if (!aliceSched || aliceSched.length === 0) {
            // console.log('Multi-Op Simulation Logs:', result.logs);
        }

        expect(bobSched).toBeDefined();
        expect(aliceSched).toBeDefined();
        expect(bobSched.length).toBeGreaterThan(0);
        expect(bobSched[0].start).toBeGreaterThanOrEqual(0); // Bob starts early

        expect(aliceSched.length).toBeGreaterThan(0);
        expect(aliceSched[0].start).toBeGreaterThanOrEqual(60);
    });
});
