import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProductionPlanner } from './production-planner';

global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const {
    mockUseCollection,
    mockSimulate,
    mockSolveFluid,
    mockSetDoc,
    mockToast,
    mockUseMachineTypes,
} = vi.hoisted(() => ({
    mockUseCollection: vi.fn(),
    mockSimulate: vi.fn(),
    mockSolveFluid: vi.fn(),
    mockSetDoc: vi.fn(),
    mockToast: vi.fn(),
    mockUseMachineTypes: vi.fn(),
}));

vi.mock('@/auth-provider', () => ({
    useAuth: vi.fn(() => ({
        user: { uid: 'admin-1', email: 'admin@example.com' },
        loading: false,
    })),
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/hooks/use-machine-types', () => ({
    useMachineTypes: () => mockUseMachineTypes(),
}));

vi.mock('@/firebase/firestore/use-configuration', () => ({
    useConfiguration: vi.fn(() => ({
        data: { availableMinutesPerDay: 480 },
        isLoading: false,
    })),
}));

vi.mock('@/firebase/firestore/use-collection', () => ({
    useCollection: (ref: any) => mockUseCollection(ref),
}));

vi.mock('@/firebase/client', () => ({ firestore: {} }));

vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_fs, path) => ({ path, type: 'collection' })),
    doc: vi.fn((_fs, path, ...segments) => ({ path: [path, ...segments].join('/'), type: 'doc' })),
    query: vi.fn((coll) => ({ path: coll.path, type: 'query' })),
    where: vi.fn(),
    getDocs: vi.fn(),
    setDoc: (ref: any, data: any) => mockSetDoc(ref, data),
    Timestamp: {
        now: vi.fn(() => ({ seconds: 1234567890, nanoseconds: 0 })),
        fromDate: vi.fn((d) => ({ seconds: d.getTime() / 1000, nanoseconds: 0 })),
    },
}));

vi.mock('@/lib/simulation-engine', () => ({
    unique: (arr: any[]) => Array.from(new Set(arr)),
    simulateProductionSchedule: (...args: any[]) => mockSimulate(...args),
    solveFluidCapacity: (...args: any[]) => mockSolveFluid(...args),
}));

vi.mock('./daily-timeline', () => ({
    DailyTimeline: (props: any) => (
        <div data-testid="daily-timeline">
            <div data-testid="timeline-props" data-props={JSON.stringify(props)} />
        </div>
    ),
}));

vi.mock('@/components/ui/multi-select', () => ({
    MultiSelect: ({ options, selected, onChange }: any) => (
        <div data-testid="multi-select">
            <span data-testid="selected-count">{selected.length}</span>
            {options.map((opt: any) => (
                <div
                    key={opt.value}
                    data-testid={`option-${opt.value}`}
                    onClick={() => {
                        if (selected.includes(opt.value)) onChange(selected.filter((s: any) => s !== opt.value));
                        else onChange([...selected, opt.value]);
                    }}
                >
                    {opt.label}
                </div>
            ))}
        </div>
    ),
}));

vi.mock('@/components/ui/select', () => ({
    Select: ({ children, onValueChange, value }: any) => (
        <div
            data-testid="select-root"
            data-value={value}
            onClick={(e: any) => {
                const item = (e.target as HTMLElement).closest('[data-value]');
                if (item && onValueChange) {
                    const nextValue = item.getAttribute('data-value');
                    if (nextValue) onValueChange(nextValue);
                }
            }}
        >
            {children}
        </div>
    ),
    SelectTrigger: ({ children, onClick }: any) => <div role="combobox" onClick={onClick}>{children}</div>,
    SelectValue: ({ placeholder, value }: any) => <span>{value || placeholder}</span>,
    SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
    SelectItem: ({ children, value }: any) => <div role="option" data-value={value}>{children}</div>,
}));

vi.mock('@/components/ui/popover', () => ({
    Popover: ({ children }: any) => <div>{children}</div>,
    PopoverTrigger: ({ children }: any) => <div data-testid="popover-trigger">{children}</div>,
    PopoverContent: ({ children }: any) => <div data-testid="popover-content">{children}</div>,
}));

vi.mock('@/components/ui/scroll-area', () => ({
    ScrollArea: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/command', () => ({
    Command: ({ children }: any) => <div data-testid="command">{children}</div>,
    CommandInput: ({ placeholder }: any) => <input placeholder={placeholder} />,
    CommandList: ({ children }: any) => <div>{children}</div>,
    CommandEmpty: ({ children }: any) => <div>{children}</div>,
    CommandGroup: ({ children }: any) => <div>{children}</div>,
    CommandItem: ({ children, onSelect }: any) => <div role="option" onClick={onSelect}>{children}</div>,
}));

const setupCollections = (stylesData: any[], operatorsData: any[]) => {
    mockUseCollection.mockImplementation((ref) => {
        if (!ref) return { data: [], isLoading: false };
        if (ref.path === 'styles') return { data: stylesData, isLoading: false };
        if (ref.path === 'users') return { data: operatorsData, isLoading: false };
        if (ref.path === 'production') return { data: [], isLoading: false };
        return { data: [], isLoading: false };
    });
};

const selectStyle = async (styleName: string) => {
    fireEvent.click(screen.getAllByRole('combobox')[0]);
    const option = (await screen.findAllByText(styleName))[0];
    fireEvent.click(option);
};

const setConservativeStrategy = () => {
    const strategySection = screen.getByText('Assignment Strategy').parentElement as HTMLElement;
    fireEvent.click(within(strategySection).getByText('Conservative (Stability)'));
};

const getLatestPlannerSimulationCall = () => {
    return [...mockSimulate.mock.calls]
        .reverse()
        .find(call => Array.isArray(call[0]) && Array.isArray(call[1]) && Array.isArray(call[1][0]));
};

describe('ProductionPlanner (integration)', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockUseMachineTypes.mockReturnValue({
            machineCounts: {
                'Overlock/Serger': 3,
                'Single Needle Lockstitch': 3,
            },
            machineThreadBallsPerMachine: {
                'Overlock/Serger': 5,
                'Single Needle Lockstitch': 2,
            },
        });

        mockSolveFluid.mockImplementation((style: any, assignments: any[], operators: any[]) => {
            const result = new Map();
            (style?.operations || []).forEach((op: any) => {
                const current = assignments.find((a: any) => a.operationId === op.id);
                const ids = current?.operatorIds || [];
                const assignedOps = operators.filter((operator: any) => ids.includes(operator.id));
                const weight = ids.length > 0 ? 1 / ids.length : 0;
                result.set(op.id, {
                    finalWeights: new Map(ids.map((id: string) => [id, weight])),
                    localOutput: ids.length * 120,
                    assignedOps,
                });
            });
            return result;
        });

        mockSimulate.mockImplementation((stylesOrStyle: any, assignmentData: any) => {
            if (Array.isArray(stylesOrStyle)) {
                const schedule: Record<string, any[]> = {};
                (assignmentData as any[][]).forEach((list, styleIndex) => {
                    list.forEach(item => {
                        item.operatorIds.forEach((uid: string, idx: number) => {
                            if (!schedule[uid]) schedule[uid] = [];
                            schedule[uid].push({
                                start: idx * 3,
                                end: 30 + (idx * 3),
                                opId: item.operationId,
                                count: 10,
                                styleIndex,
                            });
                        });
                    });
                });
                return { schedule, logs: [] };
            }

            const schedule: Record<string, any[]> = {};
            (assignmentData as any[]).forEach(item => {
                item.operatorIds.forEach((uid: string) => {
                    if (!schedule[uid]) schedule[uid] = [];
                    schedule[uid].push({
                        start: 0,
                        end: 30,
                        opId: item.operationId,
                        count: 5,
                        styleIndex: 0,
                    });
                });
            });
            return { schedule, logs: [] };
        });
    });

    it('uses secondary variant coverage in conservative mode under high demand pressure', async () => {
        setupCollections(
            [
                {
                    id: 'style-high-demand',
                    name: 'High Demand Style',
                    status: 'active',
                    quantity: 3,
                    totalSmv: 300,
                    variants: [{ id: 'v-red', color: 'Red', quantity: 3 }],
                    operations: [
                        { id: 'op-join', name: 'Join', smv: 300, machineType: 'Overlock/Serger' },
                    ],
                },
            ],
            [
                { id: 'op-1', role: 'operator', name: 'Operator 1', skills: ['Overlock/Serger'] },
                { id: 'op-2', role: 'operator', name: 'Operator 2', skills: ['Overlock/Serger'] },
            ]
        );

        render(<ProductionPlanner />);
        await selectStyle('High Demand Style');
        setConservativeStrategy();
        fireEvent.click(screen.getByText('Auto Assign'));

        await waitFor(() => {
            expect(screen.getAllByTestId('operator-badge').length).toBeGreaterThan(0);
        });

        const plannerCall = getLatestPlannerSimulationCall();
        expect(plannerCall).toBeDefined();

        const simulationAssignments = plannerCall?.[1] as any[][];
        expect(simulationAssignments[0][0].operatorIds.length).toBe(2);
    });

    it('keeps single-worker variant coverage in conservative mode under low demand pressure', async () => {
        setupCollections(
            [
                {
                    id: 'style-low-demand',
                    name: 'Low Demand Style',
                    status: 'active',
                    quantity: 1,
                    totalSmv: 300,
                    variants: [{ id: 'v-red', color: 'Red', quantity: 1 }],
                    operations: [
                        { id: 'op-join', name: 'Join', smv: 300, machineType: 'Overlock/Serger' },
                    ],
                },
            ],
            [
                { id: 'op-1', role: 'operator', name: 'Operator 1', skills: ['Overlock/Serger'] },
                { id: 'op-2', role: 'operator', name: 'Operator 2', skills: ['Overlock/Serger'] },
            ]
        );

        render(<ProductionPlanner />);
        await selectStyle('Low Demand Style');
        setConservativeStrategy();
        fireEvent.click(screen.getByText('Auto Assign'));

        await waitFor(() => {
            expect(screen.getAllByTestId('operator-badge').length).toBeGreaterThan(0);
        });

        const plannerCall = getLatestPlannerSimulationCall();
        expect(plannerCall).toBeDefined();

        const simulationAssignments = plannerCall?.[1] as any[][];
        expect(simulationAssignments[0][0].operatorIds.length).toBe(1);
    });

    it('passes thread color constraints by machine type into simulation', async () => {
        setupCollections(
            [
                {
                    id: 'style-threads',
                    name: 'Thread Constraint Style',
                    status: 'active',
                    quantity: 20,
                    totalSmv: 120,
                    variants: [
                        { id: 'v-floral', color: 'Floral Print', quantity: 10 },
                        { id: 'v-solid', color: 'Solid Navy', quantity: 10 },
                    ],
                    operations: [
                        { id: 'op-1', name: 'Shoulder Join', smv: 60, machineType: 'Overlock/Serger' },
                        { id: 'op-2', name: 'Neck Binding', smv: 60, machineType: 'Single Needle Lockstitch', dependencies: ['op-1'] },
                    ],
                },
            ],
            [
                { id: 'op-1', role: 'operator', name: 'Operator 1', skills: ['Overlock/Serger', 'Single Needle Lockstitch'] },
                { id: 'op-2', role: 'operator', name: 'Operator 2', skills: ['Overlock/Serger', 'Single Needle Lockstitch'] },
            ]
        );

        render(<ProductionPlanner />);
        await selectStyle('Thread Constraint Style');

        const floralInput = screen.getByText('Floral Print (balls)').nextElementSibling as HTMLInputElement;
        const navyInput = screen.getByText('Solid Navy (balls)').nextElementSibling as HTMLInputElement;
        fireEvent.change(floralInput, { target: { value: '14' } });
        fireEvent.change(navyInput, { target: { value: '9' } });

        fireEvent.click(screen.getByText('Auto Assign'));

        await waitFor(() => {
            const plannerCall = getLatestPlannerSimulationCall();
            expect(plannerCall).toBeDefined();
        });

        const plannerCall = getLatestPlannerSimulationCall();
        const threadConfig = plannerCall?.[9] as any;

        expect(threadConfig).toBeDefined();
        expect(threadConfig.machineRules['Overlock/Serger'].ballsPerMachine).toBe(5);
        expect(threadConfig.machineRules['Single Needle Lockstitch'].ballsPerMachine).toBe(2);
        expect(threadConfig.machineRules['Overlock/Serger'].availableByColor['Floral Print']).toBe(14);
        expect(threadConfig.machineRules['Single Needle Lockstitch'].availableByColor['Solid Navy']).toBe(9);
    });

    it('toggles Role Lock (Soft) control state', async () => {
        setupCollections(
            [
                {
                    id: 'style-lock',
                    name: 'Role Lock Style',
                    status: 'active',
                    quantity: 20,
                    totalSmv: 120,
                    operations: [
                        { id: 'op-1', name: 'Shoulder Join', smv: 60, machineType: 'Overlock/Serger' },
                    ],
                },
            ],
            [
                { id: 'op-1', role: 'operator', name: 'Operator 1', skills: ['Overlock/Serger'] },
            ]
        );

        render(<ProductionPlanner />);
        await selectStyle('Role Lock Style');

        const lockSection = screen.getByText('Role Lock (Soft)').parentElement as HTMLElement;
        const lockButton = within(lockSection).getByRole('button');

        expect(lockButton.textContent).toContain('Disabled');
        fireEvent.click(lockButton);
        expect(lockButton.textContent).toContain('Enabled');
    });

    it('applies auto-assign quality guard when candidate reduces output and increases WIP', async () => {
        setupCollections(
            [
                {
                    id: 'style-guard',
                    name: 'Guard Style',
                    status: 'active',
                    quantity: 300,
                    totalSmv: 120,
                    operations: [
                        { id: 'op-1', name: 'Upstream', smv: 60, machineType: 'Overlock/Serger' },
                        { id: 'op-2', name: 'Finish', smv: 60, machineType: 'Overlock/Serger', dependencies: ['op-1'] },
                    ],
                },
            ],
            [
                { id: 'op-1', role: 'operator', name: 'Operator 1', skills: ['Overlock/Serger'] },
                { id: 'op-2', role: 'operator', name: 'Operator 2', skills: ['Overlock/Serger'] },
            ]
        );

        mockSimulate.mockImplementation((stylesOrStyle: any, assignmentData: any) => {
            if (!Array.isArray(stylesOrStyle)) return { schedule: {}, logs: [] };
            const styleAssignments = (assignmentData as any[][])[0] || [];
            const assignedUsers = new Set(styleAssignments.flatMap((row: any) => row.operatorIds || []));

            if (assignedUsers.size >= 2) {
                return {
                    schedule: {
                        'op-1': [
                            { start: 0, end: 40, opId: 'op-1', count: 40, styleIndex: 0 },
                            { start: 41, end: 80, opId: 'op-2', count: 40, styleIndex: 0 },
                        ],
                        'op-2': [
                            { start: 0, end: 40, opId: 'op-1', count: 40, styleIndex: 0 },
                            { start: 41, end: 80, opId: 'op-2', count: 40, styleIndex: 0 },
                        ],
                    },
                    logs: [],
                };
            }

            return {
                schedule: {
                    'op-1': [
                        { start: 0, end: 60, opId: 'op-1', count: 80, styleIndex: 0 },
                        { start: 61, end: 120, opId: 'op-2', count: 20, styleIndex: 0 },
                    ],
                },
                logs: [],
            };
        });

        render(<ProductionPlanner />);
        await selectStyle('Guard Style');

        fireEvent.click(screen.getByText('Auto Assign'));
        await waitFor(() => {
            expect(screen.getAllByTestId('operator-badge').length).toBeGreaterThan(0);
        });

        fireEvent.click(screen.getByTestId('option-op-2'));
        await waitFor(() => {
            expect(screen.getByTestId('selected-count').textContent).toBe('1');
        });

        mockToast.mockClear();
        fireEvent.click(screen.getByText('Auto Assign'));

        await waitFor(() => {
            expect(mockToast).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Auto Assign Guard Applied',
                })
            );
        });
    });

    it('applies guard on thread ball changes when output drops and WIP rises', async () => {
        setupCollections(
            [
                {
                    id: 'style-thread-guard',
                    name: 'Thread Guard Style',
                    status: 'active',
                    quantity: 200,
                    totalSmv: 120,
                    variants: [{ id: 'v-floral', color: 'Floral Print', quantity: 200 }],
                    operations: [
                        { id: 'op-1', name: 'Upstream', smv: 60, machineType: 'Overlock/Serger' },
                        { id: 'op-2', name: 'Finish', smv: 60, machineType: 'Overlock/Serger', dependencies: ['op-1'] },
                    ],
                },
            ],
            [
                { id: 'op-1', role: 'operator', name: 'Operator 1', skills: ['Overlock/Serger'] },
                { id: 'op-2', role: 'operator', name: 'Operator 2', skills: ['Overlock/Serger'] },
            ]
        );

        mockSimulate.mockImplementation((stylesOrStyle: any, _assignmentData: any, _a: any, _b: any, _c: any, _d: any, _e: any, _f: any, _g: any, threadConfig: any) => {
            if (!Array.isArray(stylesOrStyle)) return { schedule: {}, logs: [] };

            const floralBalls = threadConfig?.machineRules?.['Overlock/Serger']?.availableByColor?.['Floral Print'] ?? 0;

            if (floralBalls >= 8) {
                return {
                    schedule: {
                        'op-1': [
                            { start: 0, end: 40, opId: 'op-1', count: 40, styleIndex: 0 },
                            { start: 41, end: 80, opId: 'op-2', count: 40, styleIndex: 0 },
                        ],
                        'op-2': [
                            { start: 0, end: 40, opId: 'op-1', count: 40, styleIndex: 0 },
                            { start: 41, end: 80, opId: 'op-2', count: 40, styleIndex: 0 },
                        ],
                    },
                    logs: [],
                };
            }

            return {
                schedule: {
                    'op-1': [
                        { start: 0, end: 50, opId: 'op-1', count: 60, styleIndex: 0 },
                        { start: 51, end: 100, opId: 'op-2', count: 20, styleIndex: 0 },
                    ],
                    'op-2': [
                        { start: 0, end: 50, opId: 'op-1', count: 40, styleIndex: 0 },
                        { start: 51, end: 100, opId: 'op-2', count: 20, styleIndex: 0 },
                    ],
                },
                logs: [],
            };
        });

        render(<ProductionPlanner />);
        await selectStyle('Thread Guard Style');

        const floralInput = screen.getByText('Floral Print (balls)').nextElementSibling as HTMLInputElement;
        fireEvent.change(floralInput, { target: { value: '8' } });
        await waitFor(() => {
            expect(floralInput.value).toBe('8');
        });

        fireEvent.click(screen.getByText('Auto Assign'));
        await waitFor(() => {
            expect(screen.getAllByTestId('operator-badge').length).toBeGreaterThan(0);
        });

        mockToast.mockClear();
        fireEvent.change(floralInput, { target: { value: '4' } });

        await waitFor(() => {
            expect(mockToast).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Auto Assign Guard Applied',
                })
            );
            expect(floralInput.value).toBe('8');
        });
    });
});
