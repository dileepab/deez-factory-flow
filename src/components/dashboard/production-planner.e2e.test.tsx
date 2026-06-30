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
        data: { availableMinutesPerDay: 480, defaultSwitchDelay: 3 },
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
    PopoverTrigger: ({ children }: any) => <div>{children}</div>,
    PopoverContent: ({ children }: any) => <div>{children}</div>,
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

describe('ProductionPlanner (e2e-style workflow in test environment)', () => {
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

        mockUseCollection.mockImplementation((ref) => {
            if (!ref) return { data: [], isLoading: false };
            if (ref.path === 'styles') {
                return {
                    data: [
                        {
                            id: 'style-1',
                            name: 'Summer Shift Dress',
                            status: 'active',
                            quantity: 200,
                            totalSmv: 5.75,
                            variants: [
                                { id: 'v1', color: 'Floral Print', quantity: 100 },
                                { id: 'v2', color: 'Solid Navy', quantity: 100 },
                            ],
                            operations: [
                                { id: 'op-1', name: 'Shoulder Join', smv: 45, machineType: 'Overlock/Serger' },
                                { id: 'op-2', name: 'Side Seam', smv: 90, machineType: 'Overlock/Serger', dependencies: ['op-1'] },
                                { id: 'op-3', name: 'Neck Binding', smv: 120, machineType: 'Single Needle Lockstitch', dependencies: ['op-2'] },
                                { id: 'op-4', name: 'Hemming', smv: 60, machineType: 'Single Needle Lockstitch', dependencies: ['op-3'] },
                            ],
                        },
                        {
                            id: 'style-2',
                            name: 'Summer Shirt',
                            status: 'active',
                            quantity: 60,
                            totalSmv: 4.2,
                            variants: [{ id: 'v3', color: 'Coral', quantity: 60 }],
                            operations: [
                                { id: 'op-11', name: 'Join', smv: 60, machineType: 'Overlock/Serger' },
                                { id: 'op-12', name: 'Finish', smv: 120, machineType: 'Single Needle Lockstitch', dependencies: ['op-11'] },
                            ],
                        },
                    ],
                    isLoading: false,
                };
            }
            if (ref.path === 'users') {
                return {
                    data: [
                        { id: 'u1', role: 'operator', name: 'Pushpa OP', skills: ['Single Needle Lockstitch'] },
                        { id: 'u2', role: 'operator', name: 'Nilushi', skills: ['Overlock/Serger'] },
                        { id: 'u3', role: 'operator', name: 'Saman OP', skills: ['Single Needle Lockstitch', 'Overlock/Serger'] },
                        { id: 'u4', role: 'operator', name: 'Ruvini', skills: ['Overlock/Serger'] },
                    ],
                    isLoading: false,
                };
            }
            if (ref.path === 'production') return { data: [], isLoading: false };
            return { data: [], isLoading: false };
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
                    localOutput: ids.length * 180,
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
                                start: idx * 5,
                                end: 35 + (idx * 5),
                                opId: item.operationId,
                                count: 10,
                                styleIndex,
                            });
                        });
                    });
                });
                return { schedule, logs: [] };
            }

            return { schedule: {}, logs: [] };
        });

        mockSetDoc.mockResolvedValue(undefined);
    });

    it('executes full planning flow from style selection to publish', async () => {
        render(<ProductionPlanner />);

        fireEvent.click(screen.getAllByRole('combobox')[0]);
        fireEvent.click((await screen.findAllByText('Summer Shift Dress'))[0]);

        const selectRoots = screen.getAllByTestId('select-root');
        const nextStyleSelect = selectRoots[1];
        fireEvent.click(within(nextStyleSelect).getByText(/Summer Shirt/i));

        const strategySection = screen.getByText('Assignment Strategy').parentElement as HTMLElement;
        fireEvent.click(within(strategySection).getByText('Conservative (Stability)'));

        const roleLockSection = screen.getByText('Role Lock (Soft)').parentElement as HTMLElement;
        const roleLockButton = within(roleLockSection).getByRole('button');
        fireEvent.click(roleLockButton);
        expect(roleLockButton.textContent).toContain('Enabled');

        const floralInput = screen.getByText('Floral Print (balls)').nextElementSibling as HTMLInputElement;
        const navyInput = screen.getByText('Solid Navy (balls)').nextElementSibling as HTMLInputElement;
        const coralInput = screen.getByText('Coral (balls)').nextElementSibling as HTMLInputElement;
        fireEvent.change(floralInput, { target: { value: '15' } });
        fireEvent.change(navyInput, { target: { value: '10' } });
        fireEvent.change(coralInput, { target: { value: '8' } });

        fireEvent.click(screen.getByText('Auto Assign'));

        await waitFor(() => {
            expect(screen.getAllByTestId('operator-badge').length).toBeGreaterThan(0);
        });

        await waitFor(() => {
            const timelineProps = screen.getByTestId('timeline-props').getAttribute('data-props') || '{}';
            const parsed = JSON.parse(timelineProps);
            expect(parsed.schedule).toBeDefined();
            expect(Object.keys(parsed.schedule).length).toBeGreaterThan(0);
        });

        fireEvent.click(screen.getByText('Publish Plan'));

        await waitFor(() => {
            expect(mockSetDoc).toHaveBeenCalledTimes(1);
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Schedule Published',
            }));
        });

        const [docRef, payload] = mockSetDoc.mock.calls[0];
        expect(docRef.path).toMatch(/^daily_plans\//);
        expect(payload.styleId).toBe('style-1');
        expect(payload.nextStyleId).toBe('style-2');
        expect(payload.assignments.length).toBeGreaterThan(0);
        expect(Object.keys(payload.schedules).length).toBeGreaterThan(0);
    });
});
