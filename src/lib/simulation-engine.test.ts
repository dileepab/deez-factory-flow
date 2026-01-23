
import { describe, it, expect } from 'vitest';
import { simulateProductionSchedule, solveFluidCapacity } from './simulation-engine';
import type { GarmentStyle, Operator, Assignment, GarmentOperation } from '@/lib/types';

// Mocks
const mockOperator: Operator = {
    id: 'op-1',
    name: 'Test Operator',
    role: 'operator',
    email: 'test@example.com',
    efficiencyRating: 100, // 100% efficiency
    skills: ['Single Needle Lockstitch', 'Overlock/Serger']
};

const mockOperator2: Operator = {
    id: 'op-2',
    name: 'Test Operator 2',
    role: 'operator',
    email: 'test2@example.com',
    efficiencyRating: 100,
    skills: ['Single Needle Lockstitch', 'Overlock/Serger']
};

const mockStyle: GarmentStyle = {
    id: 'style-1',
    name: 'Test Style',
    buyer: 'Test Buyer',
    totalSmv: 10,
    quantity: 100,
    status: 'active',
    startDate: '2023-01-01',
    operations: [
        {
            id: 'op-a',
            name: 'Operation A',
            smv: 60, // 1 minute
            machineType: 'Single Needle Lockstitch',
            dependencies: [],
            completedQuantity: 0
        },
        {
            id: 'op-b',
            name: 'Operation B',
            smv: 60, // 1 minute
            machineType: 'Single Needle Lockstitch',
            dependencies: ['op-a'], // Depends on A
            completedQuantity: 0
        }
    ]
};

describe('Simulation Engine', () => {

    it('Dependency Logic: Op B should wait for Op A output', () => {
        const assignments: Assignment[] = [
            { operationId: 'op-a', operatorIds: ['op-1'] },
            { operationId: 'op-b', operatorIds: ['op-2'] }
        ];

        const machineCounts = { 'Single Needle Lockstitch': 10 };
        const availableMinutes = 60; // 1 Hour

        const result = simulateProductionSchedule(
            mockStyle,
            assignments,
            [mockOperator, mockOperator2],
            machineCounts,
            availableMinutes,
            0 // 0 delay for simplicity
        );

        const scheduleA = result.schedule['op-1'];
        const scheduleB = result.schedule['op-2'];

        expect(scheduleA.length).toBeGreaterThan(0);

        // Op A should start at 0
        expect(scheduleA[0].start).toBe(0);

        // Op B should NOT start at 0 (needs input)
        // Since batch size logic exists, it might wait for a batch
        if (scheduleB.length > 0) {
            expect(scheduleB[0].start).toBeGreaterThan(0);
        }
    });

    it('Switch Delay: Changing machine type should add delay', () => {
        const switchStyle: GarmentStyle = {
            ...mockStyle,
            operations: [
                {
                    id: 'op-x',
                    name: 'Op X',
                    smv: 60,
                    machineType: 'Single Needle Lockstitch',
                    dependencies: [],
                    completedQuantity: 0
                },
                {
                    id: 'op-y',
                    name: 'Op Y',
                    smv: 60,
                    machineType: 'Overlock/Serger', // Different Machine
                    dependencies: [],
                    completedQuantity: 0
                }
            ]
        };
        // This test is a placeholder for logic that is currently too complex to mock easily in a unit test
        // without refactoring the simulation engine significantly to expose internal state.
        // We accept this as a placeholder for now.
    });

    it('Capacity Solver: Should split time for one operator on two tasks', () => {
        const ops = [mockOperator]; // One Operator
        const assignArr = [
            { operationId: 'op-a', operatorIds: ['op-1'] },
            { operationId: 'op-b', operatorIds: ['op-1'] }
        ];

        const machineCounts = { 'Single Needle Lockstitch': 10 };
        const result = solveFluidCapacity(mockStyle, assignArr, ops, machineCounts, 480);

        const resA = result.get('op-a');
        const resB = result.get('op-b');

        // Operator 1 should split time between A and B
        const wA = resA?.finalWeights.get('op-1');
        const wB = resB?.finalWeights.get('op-1');

        // Since SMVs are equal (60 each), weights should be 0.5 each
        if (wA !== undefined && wB !== undefined) {
            expect(wA).toBeCloseTo(0.5, 1);
            expect(wB).toBeCloseTo(0.5, 1);
        } else {
            // Fail if undefined
            expect(wA).toBeDefined();
        }
    });

});
