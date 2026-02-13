
import { describe, it, expect } from 'vitest';
import { simulateProductionSchedule } from './simulation-engine';
import { GarmentStyle, Operator } from './types';

describe('Simulation Engine - Switch Delay', () => {
    const style: GarmentStyle = {
        id: 'style_switch',
        name: 'Switch Style',
        buyer: 'Test Buyer',
        totalSmv: 20,
        operations: [
            { id: 'opA', name: 'Op A', machineType: 'MachineA', smv: 10, dependencies: [], completedQuantity: 0 },
            { id: 'opB', name: 'Op B', machineType: 'MachineB', smv: 10, dependencies: ['opA'], completedQuantity: 0 },
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
        skills: ['MachineA', 'MachineB'],
        efficiencyRating: 100
    };

    const machineCounts = { 'MachineA': 1, 'MachineB': 1 };
    const availableMinutes = 200;

    it('should introduce a gap between tasks when switching machines', () => {
        // Alice does OpA then OpB. Machine types differ.
        const assignments = [
            { operationId: 'opA', operatorIds: ['alice'] },
            { operationId: 'opB', operatorIds: ['alice'] }
        ];

        const SWITCH_DELAY = 15;

        const result = simulateProductionSchedule(
            style,
            assignments,
            [alice],
            machineCounts,
            availableMinutes,
            SWITCH_DELAY
        );

        const schedule = result.schedule['alice'];
        // Expect at least 2 tasks
        expect(schedule.length).toBeGreaterThanOrEqual(2);

        // Sort by start time
        schedule.sort((a, b) => a.start - b.start);

        // Find a transition where opId changes (OpA -> OpB)
        // Since OpB depends on OpA, she might do a batch of A, then B.
        // Wait, standard simulation logic might batch.

        let foundSwitch = false;
        for (let i = 0; i < schedule.length - 1; i++) {
            const task1 = schedule[i];
            const task2 = schedule[i + 1];

            // If task2 starts immediately after task1, gap is 0.
            // Gap = task2.start - task1.end.

            const task1Op = style.operations.find(o => o.id === task1.opId);
            const task2Op = style.operations.find(o => o.id === task2.opId);

            if (task1Op && task2Op && task1Op.machineType !== task2Op.machineType) {
                const gap = task2.start - task1.end;
                // console.log(`Switch found: ${task1Op.machineType} -> ${task2Op.machineType}. Gap: ${gap}`);

                // Gap should be >= SWITCH_DELAY
                // Note: It could be larger if waiting for materials, but shouldn't be smaller.

                // WE MUST BE CAREFUL: Simulation assigns 'startTick' as 't + delay'.
                // 'busyUntil' is 't + duration'.
                // So previous task ends at 't' (from previous iteration release).
                // New task claimed at 't'. startTick = t + delay.
                // So start of new task - end of old task should be exactly delay (if no other idle time).

                if (gap >= SWITCH_DELAY) {
                    foundSwitch = true;
                }
            }
        }

        expect(foundSwitch).toBe(true);
    });

    it('should introduce a gap between tasks when switching machines back and forth (A -> B -> A)', () => {
        // Alice does OpA -> OpB -> OpA.
        // We assign OpA twice? No, Sim handles continuous work.
        // But to force A->B->A, we need inventory for A, then B, then A.
        // Or simple assignments and let Sim decide.
        // Style has A and B. B depends on A.
        // Simulation: Alice does A (until B ready or A done).
        // Then does B.
        // Then does A again? (If output target not met).

        // Let's modify available inventory/targets to force a switch.
        // Not easy to force exact sequence in Fluid Sim without strictly limiting targets.
        // But we can check ANY switch events.

        // Easier: Define style with Op A and Op B.
        // Assign Alice to BOTH.
        // Check if ANY gap >= switchDelay is found when she switches.

        const SWITCH_DELAY = 15;

        // Increase available minutes to allow multiple tasks
        const result = simulateProductionSchedule(
            style,
            [
                { operationId: 'opA', operatorIds: ['alice'] },
                { operationId: 'opB', operatorIds: ['alice'] }
            ],
            [alice],
            machineCounts,
            400, // Longer shift
            SWITCH_DELAY
        );

        const schedule = result.schedule['alice'];
        // schedule.forEach(s => console.log(`Task: ${s.opId} ${s.start}-${s.end}`));

        expect(schedule.length).toBeGreaterThanOrEqual(2);
        schedule.sort((a, b) => a.start - b.start);

        let switchesFound = 0;
        let validSwitches = 0;

        for (let i = 0; i < schedule.length - 1; i++) {
            const task1 = schedule[i];
            const task2 = schedule[i + 1];

            const task1Op = style.operations.find(o => o.id === task1.opId);
            const task2Op = style.operations.find(o => o.id === task2.opId);

            if (task1Op && task2Op && task1Op.machineType !== task2Op.machineType) {
                switchesFound++;
                const gap = task2.start - task1.end;
                // console.log(`Switch ${task1Op.machineType} -> ${task2Op.machineType}. Gap: ${gap}`);

                if (gap >= SWITCH_DELAY) {
                    validSwitches++;
                }
            }
        }

        expect(switchesFound).toBeGreaterThan(0);

        expect(validSwitches).toBe(switchesFound); // All switches should have delay
    });

    it('should introduce a gap when switching Operations on the SAME machine', () => {
        const styleSameMachine: GarmentStyle = {
            id: 'style_same',
            name: 'Same Machine Style',
            buyer: 'Test Buyer',
            totalSmv: 20,
            operations: [
                { id: 'op1', name: 'Op 1', machineType: 'Sewing', smv: 10, dependencies: [], completedQuantity: 0 },
                { id: 'op2', name: 'Op 2', machineType: 'Sewing', smv: 10, dependencies: [], completedQuantity: 0 },
            ],
            status: 'active',
            startDate: '2023-01-01',
            quantity: 100
        };

        const assignments = [
            { operationId: 'op1', operatorIds: ['alice'] }, // Alice assigned to both
            { operationId: 'op2', operatorIds: ['alice'] }
        ];

        const alice: Operator = {
            id: 'alice',
            name: 'Alice',
            role: 'operator',
            email: 'alice@test.com',
            skills: ['Sewing'],
            efficiencyRating: 100
        };

        const SWITCH_DELAY = 10;
        const availableMinutes = 200;

        const result = simulateProductionSchedule(
            styleSameMachine,
            assignments,
            [alice],
            { 'Sewing': 1 },
            availableMinutes,
            SWITCH_DELAY
        );

        const schedule = result.schedule['alice'];
        schedule.sort((a, b) => a.start - b.start);

        let foundSwitch = false;
        let validDelay = false;

        for (let i = 0; i < schedule.length - 1; i++) {
            const t1 = schedule[i];
            const t2 = schedule[i + 1];

            if (t1.opId !== t2.opId) {
                foundSwitch = true;
                const gap = t2.start - t1.end;
                if (gap >= SWITCH_DELAY) {
                    validDelay = true;
                }
            }
        }

        expect(schedule.length).toBeGreaterThan(1);
        if (foundSwitch) {
            expect(validDelay).toBe(true);
        } else {
            expect(foundSwitch).toBe(true);
        }
    });
    it('should minimize switching (Stickiness) when tasks are balanced', () => {
        // Scenario: Alice assigned Op1 and Op2. Both independent.
        // Without stickiness, she might switch every task if ratios stay close.
        // With stickiness, she should batch them.

        const styleBalanced: GarmentStyle = {
            id: 'style_balanced',
            name: 'Balanced Style',
            buyer: 'Test Buyer',
            totalSmv: 10,
            operations: [
                { id: 'op1', name: 'Op 1', machineType: 'Sewing', smv: 5, dependencies: [], completedQuantity: 0 },
                { id: 'op2', name: 'Op 2', machineType: 'Sewing', smv: 5, dependencies: [], completedQuantity: 0 },
            ],
            status: 'active',
            startDate: '2023-01-01',
            quantity: 100
        };

        const assignments = [
            { operationId: 'op1', operatorIds: ['alice'] },
            { operationId: 'op2', operatorIds: ['alice'] }
        ];

        const alice: Operator = {
            id: 'alice',
            name: 'Alice',
            role: 'operator',
            email: 'alice@test.com',
            skills: ['Sewing'],
            efficiencyRating: 100
        };

        const result = simulateProductionSchedule(
            styleBalanced,
            assignments,
            [alice],
            { 'Sewing': 1 },
            200,
            5 // 5 min switch delay
        );

        const schedule = result.schedule['alice'];
        schedule.sort((a, b) => a.start - b.start);

        let switches = 0;
        for (let i = 0; i < schedule.length - 1; i++) {
            if (schedule[i].opId !== schedule[i + 1].opId) {
                switches++;
            }
        }

        // Available 200m. SMV 5. ~40 pcs total.
        // Ideally she does batch of Op1, then Op2. Maybe 1 or 2 switches.
        // If thrashing, switches could be ~39.
        console.log(`Switches found: ${switches} in ${schedule.length} tasks`);
        expect(switches).toBeLessThan(10); // Expect significant batching
    });
});
