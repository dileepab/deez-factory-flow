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
    assessRebalanceCandidate,
    buildAssignmentsFromUnits,
    buildMachineFlowElements,
    buildMachineLayoutGraph,
    buildMachineRelationalLayout,
    findSafeNextStylePlan,
    flattenAssignmentUnits,
    getNextStylePrimaryDropLimit,
    getNextStylePrepWipLimit,
    type PlanQuality,
} from './ai-production-planner';
import type { Assignment, GarmentStyle, Operator } from '@/lib/types';

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

    it('accepts small current-style drops within the idle-capacity tolerance', () => {
        const primaryOnly = quality({ primaryOutput: 199 });
        const decision = assessNextStyleFlow(
            primaryOnly,
            quality({
                primaryOutput: 199 - getNextStylePrimaryDropLimit(199),
                nextOutput: 0,
                nextWip: 24,
            })
        );

        expect(decision.kind).toBe('prep');
        expect(decision.primaryDrop).toBe(3);
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

    it('round-trips operator-level assignment units', () => {
        const units = flattenAssignmentUnits([
            { operationId: 'pocket', operatorIds: ['saman', 'saman', 'ruvini'] },
            { operationId: 'fly', operatorIds: ['pushpa'] },
        ]);

        expect(units).toEqual([
            { operationId: 'pocket', operatorId: 'saman' },
            { operationId: 'pocket', operatorId: 'ruvini' },
            { operationId: 'fly', operatorId: 'pushpa' },
        ]);
        expect(buildAssignmentsFromUnits(units)).toEqual([
            { operationId: 'pocket', operatorIds: ['saman', 'ruvini'] },
            { operationId: 'fly', operatorIds: ['pushpa'] },
        ]);
    });

    it('prunes next-style operator links that are not true idle capacity', () => {
        const primaryOnly = quality({ primaryOutput: 180 });
        const plan = findSafeNextStylePlan(
            [
                { operationId: 'pocket', operatorIds: ['ruvini'] },
                { operationId: 'bottom-hem', operatorIds: ['nilushi'] },
            ],
            assignments => {
                const units = flattenAssignmentUnits(assignments);
                const hasNilushi = units.some(unit => unit.operatorId === 'nilushi');
                const hasRuvini = units.some(unit => unit.operatorId === 'ruvini');
                const candidateQuality = quality({
                    primaryOutput: hasNilushi ? 166 : 180,
                    nextOutput: 0,
                    nextWip: hasRuvini ? 24 : 0,
                });

                return {
                    quality: candidateQuality,
                    decision: assessNextStyleFlow(primaryOnly, candidateQuality),
                };
            }
        );

        expect(plan?.decision.kind).toBe('prep');
        expect(plan?.removedUnits).toBe(1);
        expect(plan?.assignments).toEqual([
            { operationId: 'pocket', operatorIds: ['ruvini'] },
        ]);
    });

    it('keeps the existing plan when a rerun only changes WIP slightly', () => {
        const decision = assessRebalanceCandidate(
            quality({ actualOutput: 200, primaryOutput: 200, estimatedWip: 78 }),
            quality({ actualOutput: 200, primaryOutput: 200, estimatedWip: 76 })
        );

        expect(decision.action).toBe('keep-existing');
    });

    it('accepts a rerun when output improves without excessive WIP growth', () => {
        const decision = assessRebalanceCandidate(
            quality({ actualOutput: 200, primaryOutput: 200, estimatedWip: 78 }),
            quality({ actualOutput: 201, primaryOutput: 201, estimatedWip: 84 })
        );

        expect(decision.action).toBe('accept');
        expect(decision.primaryOutputDelta).toBe(1);
    });

    it('keeps the existing plan when current-style output drops', () => {
        const decision = assessRebalanceCandidate(
            quality({ actualOutput: 200, primaryOutput: 200, estimatedWip: 78 }),
            quality({ actualOutput: 199, primaryOutput: 199, estimatedWip: 60 })
        );

        expect(decision.action).toBe('keep-existing');
        expect(decision.reason).toContain('reduces current-style output');
    });

    it('accepts a same-output rerun only when WIP meaningfully improves', () => {
        const decision = assessRebalanceCandidate(
            quality({ actualOutput: 200, primaryOutput: 200, estimatedWip: 78 }),
            quality({ actualOutput: 200, primaryOutput: 200, estimatedWip: 70 })
        );

        expect(decision.action).toBe('accept');
        expect(decision.wipDelta).toBe(-8);
    });

    it('builds machine layout stations, part flow, and operator movement routes', () => {
        const style: GarmentStyle = {
            id: 'style-1',
            name: 'Trouser',
            buyer: 'DEEZ',
            totalSmv: 12,
            quantity: 100,
            status: 'active',
            startDate: '2026-07-01',
            operations: [
                {
                    id: 'cut',
                    name: 'Cut Panels',
                    smv: 120,
                    machineType: 'Cutting Table',
                    dependencies: [],
                    completedQuantity: 20,
                },
                {
                    id: 'sew',
                    name: 'Side Seam',
                    smv: 180,
                    machineType: 'Single Needle',
                    dependencies: ['cut'],
                    completedQuantity: 12,
                },
                {
                    id: 'pack',
                    name: 'Packing',
                    smv: 90,
                    machineType: 'Packing Table',
                    dependencies: ['sew'],
                    completedQuantity: 8,
                },
            ],
        };
        const operators = [
            { id: 'op-a', name: 'Nimali', role: 'operator', email: 'nimali@example.com', skills: [] },
            { id: 'op-b', name: 'Saman', role: 'operator', email: 'saman@example.com', skills: [] },
        ] as Operator[];
        const assignments: Assignment[] = [
            { operationId: 'cut', operatorIds: ['op-a'] },
            { operationId: 'sew', operatorIds: ['op-a', 'op-b'] },
            { operationId: 'pack', operatorIds: ['op-b'] },
        ];

        const graph = buildMachineLayoutGraph(
            [{ styleScope: 'primary', styleLabel: 'Current Style', style, assignments }],
            operators,
            {
                'style-1::cut': 30,
                'style-1::sew': 18,
                'style-1::pack': 10,
            }
        );

        expect(graph.stations.map(station => station.operationName)).toEqual([
            'Cut Panels',
            'Side Seam',
            'Packing',
        ]);
        expect(graph.stations[0].inputLabels).toEqual(['New parts']);
        expect(graph.stations[1].inputLabels).toEqual(['Cut Panels']);
        expect(graph.stations[2].outputLabels).toEqual(['Finished pieces']);
        expect(graph.partLinks).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'New parts', toStationId: 'primary-style-1-cut' }),
            expect.objectContaining({ label: 'Completed parts', fromStationId: 'primary-style-1-cut', toStationId: 'primary-style-1-sew' }),
        ]));
        expect(graph.operatorMovements.find(movement => movement.operatorId === 'op-a')).toMatchObject({
            stationLabels: ['Cut Panels', 'Side Seam'],
            movementCount: 1,
        });
        expect(graph.operatorMovements.find(movement => movement.operatorId === 'op-b')).toMatchObject({
            stationLabels: ['Side Seam', 'Packing'],
            movementCount: 1,
        });

        const visual = buildMachineRelationalLayout(graph);
        expect(visual.nodes.map(node => ({
            id: node.id,
            depth: node.depth,
            x: node.x,
        }))).toEqual([
            { id: 'primary-style-1-cut', depth: 0, x: 240 },
            { id: 'primary-style-1-sew', depth: 1, x: 640 },
            { id: 'primary-style-1-pack', depth: 2, x: 1040 },
        ]);
        expect(visual.partLinks.map(link => link.kind)).toEqual([
            'new-parts',
            'completed-parts',
            'completed-parts',
        ]);
        expect(visual.operatorLinks).toHaveLength(2);
        expect(visual.operatorLinks[0]).toMatchObject({
            operatorId: 'op-a',
            fromStationId: 'primary-style-1-cut',
            toStationId: 'primary-style-1-sew',
        });

        const flow = buildMachineFlowElements(graph);
        expect(flow.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'primary-style-1-cut-new-parts-source',
                type: 'partSource',
                draggable: true,
                data: expect.objectContaining({ label: 'New parts' }),
            }),
            expect.objectContaining({
                id: 'primary-style-1-cut',
                type: 'machineStation',
                draggable: true,
                data: expect.objectContaining({ label: 'Cut Panels' }),
            }),
        ]));
        expect(flow.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({
                source: 'primary-style-1-cut-new-parts-source',
                target: 'primary-style-1-cut',
                data: expect.objectContaining({ kind: 'new-parts', label: 'New parts' }),
            }),
            expect.objectContaining({
                source: 'primary-style-1-cut',
                target: 'primary-style-1-sew',
                data: expect.objectContaining({ kind: 'completed-parts', label: 'Completed parts' }),
            }),
            expect.objectContaining({
                source: 'primary-style-1-cut',
                target: 'primary-style-1-sew',
                data: expect.objectContaining({ kind: 'operator-route', label: 'Nimali' }),
            }),
        ]));
    });

    it('shows one primary completed-parts route instead of every dependency branch', () => {
        const style: GarmentStyle = {
            id: 'polo',
            name: 'Polo',
            buyer: 'DEEZ',
            totalSmv: 8,
            quantity: 100,
            status: 'active',
            startDate: '2026-07-01',
            operations: [
                { id: 'shoulder', name: 'Shoulder Join', smv: 36, machineType: 'Overlock/Serger', dependencies: ['placket'], completedQuantity: 0 },
                { id: 'placket', name: 'Placket Attach', smv: 108, machineType: 'Single Needle Lockstitch', dependencies: [], completedQuantity: 0 },
                { id: 'collar', name: 'Collar Attach', smv: 84, machineType: 'Single Needle Lockstitch', dependencies: ['shoulder', 'placket'], completedQuantity: 0 },
                { id: 'sleeve', name: 'Sleeve Attach', smv: 72, machineType: 'Overlock/Serger', dependencies: ['shoulder'], completedQuantity: 0 },
                { id: 'side', name: 'Side Seam', smv: 66, machineType: 'Overlock/Serger', dependencies: ['sleeve'], completedQuantity: 0 },
                { id: 'hem', name: 'Bottom Hem', smv: 60, machineType: 'Flatlock/Coverstitch', dependencies: ['side'], completedQuantity: 0 },
                { id: 'button', name: 'Buttonhole & Button', smv: 84, machineType: 'Buttonhole Machine', dependencies: ['placket', 'hem'], completedQuantity: 0 },
            ],
        };
        const operators = [
            { id: 'op-a', name: 'Nimali', role: 'operator', email: 'nimali@example.com', skills: [] },
        ] as Operator[];
        const assignments = style.operations.map(operation => ({
            operationId: operation.id,
            operatorIds: ['op-a'],
        }));

        const graph = buildMachineLayoutGraph(
            [{ styleScope: 'primary', styleLabel: 'Current Style', style, assignments }],
            operators,
            {}
        );

        expect(graph.stations.map(station => station.operationName)).toEqual([
            'Placket Attach',
            'Shoulder Join',
            'Collar Attach',
            'Sleeve Attach',
            'Side Seam',
            'Bottom Hem',
            'Buttonhole & Button',
        ]);

        const stationLabels = Object.fromEntries(graph.stations.map(station => [station.operationId, {
            inputLabels: station.inputLabels,
            outputLabels: station.outputLabels,
            isFinal: station.isFinal,
        }]));
        expect(stationLabels).toMatchObject({
            placket: { inputLabels: ['New parts'], outputLabels: ['Shoulder Join'], isFinal: false },
            shoulder: { inputLabels: ['Placket Attach'], outputLabels: ['Collar Attach'], isFinal: false },
            collar: { inputLabels: ['Shoulder Join'], outputLabels: ['Sleeve Attach'], isFinal: false },
            sleeve: { inputLabels: ['Collar Attach'], outputLabels: ['Side Seam'], isFinal: false },
            side: { inputLabels: ['Sleeve Attach'], outputLabels: ['Bottom Hem'], isFinal: false },
            hem: { inputLabels: ['Side Seam'], outputLabels: ['Buttonhole & Button'], isFinal: false },
            button: { inputLabels: ['Bottom Hem'], outputLabels: ['Finished pieces'], isFinal: true },
        });

        const completedLinks = graph.partLinks
            .filter(link => link.kind === 'completed-parts')
            .map(link => `${link.fromStationId}->${link.toStationId}`);
        expect(completedLinks).toEqual([
            'primary-polo-placket->primary-polo-shoulder',
            'primary-polo-shoulder->primary-polo-collar',
            'primary-polo-collar->primary-polo-sleeve',
            'primary-polo-sleeve->primary-polo-side',
            'primary-polo-side->primary-polo-hem',
            'primary-polo-hem->primary-polo-button',
        ]);
        expect(completedLinks).not.toEqual(expect.arrayContaining([
            'primary-polo-placket->primary-polo-collar',
            'primary-polo-placket->primary-polo-button',
            'primary-polo-shoulder->primary-polo-sleeve',
        ]));

        const flow = buildMachineFlowElements(graph);
        expect(flow.edges.some(edge => edge.data?.kind === 'inferred-continuation')).toBe(false);
        expect(flow.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'primary-polo-collar',
                draggable: true,
            }),
            expect.objectContaining({
                id: 'primary-polo-sleeve',
                draggable: true,
            }),
        ]));
        expect(flow.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({
                source: 'primary-polo-collar',
                target: 'primary-polo-sleeve',
                data: expect.objectContaining({
                    kind: 'completed-parts',
                    label: 'Completed parts',
                    color: '#10b981',
                }),
            }),
        ]));
    });
});
