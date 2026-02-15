
import { describe, it, expect } from 'vitest';
import { simulateProductionSchedule } from './simulation-engine';
import { GarmentStyle, Operator } from './types';

describe('Simulation Engine - Color Switch Delay', () => {
    const styleRed: GarmentStyle = {
        id: 'style_red',
        name: 'Style Red',
        buyer: 'Test Buyer',
        totalSmv: 10,
        colorVariant: 'Red',
        operations: [
            { id: 'op1', name: 'Op 1', machineType: 'Sewing', smv: 10, dependencies: [], completedQuantity: 0 },
        ],
        status: 'active',
        startDate: '2023-01-01',
        quantity: 100
    };

    const styleBlue: GarmentStyle = {
        id: 'style_blue',
        name: 'Style Blue',
        buyer: 'Test Buyer',
        totalSmv: 10,
        colorVariant: 'Blue',
        operations: [
            { id: 'op1', name: 'Op 1', machineType: 'Sewing', smv: 10, dependencies: [], completedQuantity: 0 },
        ],
        status: 'active',
        startDate: '2023-01-01',
        quantity: 100
    };

    const alice: Operator = {
        id: 'alice',
        name: 'Alice',
        role: 'operator',
        email: 'alice@test.com',
        skills: ['Sewing'],
        efficiencyRating: 100
    };

    const machineCounts = { 'Sewing': 1 };
    const availableMinutes = 200;
    const SWITCH_DELAY = 15;

    it('should introduce a gap when switching between tasks of different colors', () => {
        // Alice assigned to Op1 of Red AND Op1 of Blue.
        // Even though Op ID might be same string if copy-pasted, let's ensure they are treated as diff tasks?
        // Wait, 'simulateProductionSchedule' takes ONE style and assignments.
        // It supports 'nextStyle'.
        // So we simulate Red as primary, Blue as next.

        const assignments = [{ operationId: 'op1', operatorIds: ['alice'] }];
        const nextAssignments = [{ operationId: 'op1', operatorIds: ['alice'] }];

        const result = simulateProductionSchedule(
            [styleRed, styleBlue],
            [assignments, nextAssignments],
            [alice],
            machineCounts,
            availableMinutes,
            SWITCH_DELAY
        );

        const schedule = result.schedule['alice'];
        schedule.sort((a, b) => a.start - b.start);

        // Expect at least one switch from Red to Blue
        let foundSwitch = false;
        let validDelay = false;

        for (let i = 0; i < schedule.length - 1; i++) {
            const t1 = schedule[i];
            const t2 = schedule[i + 1];

            // Check if t1 is Red (primary) and t2 is Blue (next)
            // t1.isNextStyle should be undefined/false. t2.isNextStyle should be true.
            // Or purely check gap.

            if (!t1.isNextStyle && t2.isNextStyle) {
                foundSwitch = true;
                const gap = t2.start - t1.end;
                if (gap >= SWITCH_DELAY) {
                    validDelay = true;
                }
            }
        }

        expect(foundSwitch).toBe(true);
        expect(validDelay).toBe(true);
    });
});
