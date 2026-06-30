
import { describe, it, expect } from 'vitest';
import { simulateProductionSchedule, solveFluidCapacity } from './simulation-engine';
import type { GarmentStyle, Operator } from '@/lib/types';

describe('Simulation Engine - Attendance & Overtime', () => {
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

    it('should calculate higher capacity for operators with Overtime', () => {
        const bob: Operator = { ...alice, id: 'bob', name: 'Bob' };

        const assignments = [{ operationId: 'op1', operatorIds: ['alice', 'bob'] }];
        const assignArr = assignments.map(a => ({ operationId: a.operationId, operatorIds: a.operatorIds }));

        // Alice: Regular shift (120m)
        // Bob: OT +60m (180m total)
        const attendance = {
            'bob': { startDelay: 0, shiftExtension: 60 }
        };

        const result = solveFluidCapacity(style, assignArr, [alice, bob], machineCounts, availableMinutes, attendance);

        // Bob should have weight > Alice because he has more minutes
        // Total minutes = 120 + 180 = 300
        // Bob weight ~ 180/300 = 0.6
        // Alice weight ~ 120/300 = 0.4

        const bobWeight = result.get('op1')?.finalWeights?.get('bob') || 0;
        const aliceWeight = result.get('op1')?.finalWeights?.get('alice') || 0;

        // Since they only have 1 operation, they both dedicate 100% of their time to it.
        expect(aliceWeight).toBeCloseTo(1.0, 1);
        expect(bobWeight).toBeCloseTo(1.0, 1);

        // Verify Total Output reflects the extra time
        // Alice: 120m / (10/60) = 720 pcs
        // Bob: 180m / (10/60) = 1080 pcs
        // Total: 1800 pcs
        const totalOutput = result.get('op1')?.localOutput || 0;
        expect(totalOutput).toBeGreaterThan(1700);
        expect(totalOutput).toBeLessThan(1900);
    });

    it('should simulate longer for Overtime operators', () => {
        const assignments = [{ operationId: 'op1', operatorIds: ['alice'] }];

        // Alice works 2 hours OT (Total 4 hours = 240m)
        // Base shift is 120m
        const attendance = {
            'alice': { startDelay: 0, shiftExtension: 120 }
        };

        const result = simulateProductionSchedule(
            style,
            assignments,
            [alice],
            machineCounts,
            availableMinutes, // 120
            0,
            undefined,
            undefined,
            attendance
        );

        const schedule = result.schedule['alice'];
        const lastTask = schedule[schedule.length - 1];

        // Should have tasks going beyond T=120
        expect(lastTask.end).toBeGreaterThan(120);
    });

    it('should delay start based on operator startDelay', () => {
        const assignments = [{ operationId: 'op1', operatorIds: ['alice'] }];
        const delayMins = 30;
        const attendance = {
            'alice': { startDelay: delayMins, shiftExtension: 0 }
        };

        const result = simulateProductionSchedule(
            style,
            assignments,
            [alice],
            machineCounts,
            availableMinutes,
            0,
            undefined,
            undefined,
            attendance
        );

        const schedule = result.schedule['alice'];
        expect(schedule[0].start).toBeGreaterThanOrEqual(delayMins);
    });
});
