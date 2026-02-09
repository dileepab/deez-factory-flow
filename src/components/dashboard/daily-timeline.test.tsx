import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DailyTimeline } from './daily-timeline';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Mocks ---

// Mock Auth
vi.mock('@/auth-provider', () => ({
    useAuth: vi.fn(() => ({
        user: { uid: 'op-1', email: 'op@example.com' },
        loading: false
    }))
}));

// Mock Tooltip (Radix UI)
vi.mock('@/components/ui/tooltip', () => ({
    TooltipProvider: ({ children }: any) => <div>{children}</div>,
    Tooltip: ({ children, open }: any) => <div data-state={open ? 'open' : 'closed'}>{children}</div>,
    TooltipTrigger: ({ children, asChild }: any) => <div data-testid="tooltip-trigger">{children}</div>,
    TooltipContent: ({ children }: any) => <div data-testid="tooltip-content">{children}</div>,
}));

// Mock QuickLogModal
vi.mock('./quick-log-modal', () => ({
    QuickLogModal: ({ isOpen, onClose, segment }: any) => (
        isOpen ? (
            <div data-testid="quick-log-modal">
                <button onClick={onClose}>Close</button>
                <span data-testid="modal-op-name">{segment?.name}</span>
            </div>
        ) : null
    )
}));


// Mock Data
const mockOperator = { id: 'op-1', name: 'Operator 1', role: 'operator' as const, email: 'op@example.com' };
const mockStyle = {
    id: 'style-1',
    name: 'Style A',
    status: 'active' as const,
    quantity: 100,
    totalSmv: 10,
    operations: [
        { id: 'task-1', name: 'Task 1', smv: 60, machineType: 'Sewing' }, // 1 min SMV
        { id: 'task-2', name: 'Task 2', smv: 60, machineType: 'Iron' }
    ]
};
const mockNextStyle = {
    id: 'style-2',
    name: 'Style B',
    status: 'active' as const,
    quantity: 50,
    totalSmv: 10,
    operations: [
        { id: 'task-3', name: 'Task 3', smv: 60, machineType: 'Packing' }
    ]
};

// Schedule: 
// 07:30 - 08:30 (Work Min 0-60) Task 1
// 08:30 - 09:30 (Work Min 60-120) Task 2
const mockSchedule = {
    'op-1': [
        { start: 0, end: 60, opId: 'task-1', count: 10, styleId: 'style-1' },
        { start: 60, end: 120, opId: 'task-2', count: 12, styleId: 'style-1' }
    ]
};

// Completed Schedule
const mockScheduleCompleted = {
    'op-1': [
        { start: 0, end: 60, opId: 'task-1', count: 10, styleId: 'style-1', completed: true }
    ]
};

const defaultProps = {
    assignedOperators: [mockOperator],
    assignments: [],
    selectedStyle: mockStyle as any,
    selectedNextStyle: undefined,
    flowMetrics: {},
    availableMinutes: 480,
    schedule: mockSchedule,
    productionLogs: []
};

describe('DailyTimeline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders in Vertical (Stream) Mode by default', () => {
        render(<DailyTimeline {...defaultProps} />);

        expect(screen.getByText('Daily Schedule')).toBeDefined();
        expect(screen.getByText('Stream')).toBeDefined(); // Button

        // Check for Tasks
        expect(screen.getAllByText('Task 1').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Task 2').length).toBeGreaterThan(0);

        // Check for Breaks (Tea/Lunch)
        expect(screen.getAllByText(/Tea/i).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Lunch/i).length).toBeGreaterThan(0);
    });

    it('switches to Horizontal (Timeline) Mode', async () => {
        render(<DailyTimeline {...defaultProps} />);

        // Initial Vertical
        expect(screen.queryByText('7:30')).toBeDefined(); // Timeline axis also has times, but Vertical has time labels too.

        // Click Timeline button
        fireEvent.click(screen.getByText('Timeline'));

        // Check for axis specific text or structure
        // The horizontal view has "Current:" and "Next:" legends
        expect(screen.getByText('Current:')).toBeDefined();
    });

    it('correctly maps segments and handles breaks', () => {
        const breakCrossingSchedule = {
            'op-1': [
                { start: 150, end: 210, opId: 'task-1', count: 20, styleId: 'style-1' }
            ]
        };

        render(<DailyTimeline {...defaultProps} schedule={breakCrossingSchedule} />);

        const task1Elements = screen.getAllByText('Task 1');
        expect(task1Elements.length).toBeGreaterThanOrEqual(2); // Split
    });

    it('opens Quick Log modal on click', () => {
        render(<DailyTimeline {...defaultProps} />);

        const addBtns = screen.getAllByTitle('Quick Log Production');
        expect(addBtns.length).toBeGreaterThan(0);

        fireEvent.click(addBtns[0]);

        expect(screen.getByTestId('quick-log-modal')).toBeDefined();
        expect(screen.getByTestId('modal-op-name').textContent).toBe('Task 1');
    });

    it('displays Completed status correctly (Database Flag)', () => {
        render(<DailyTimeline {...defaultProps} schedule={mockScheduleCompleted} />);

        const completedBtn = screen.getByTitle('Completed');
        expect(completedBtn).toBeDefined();
        // Check disabled attribute
        expect(completedBtn.hasAttribute('disabled')).toBe(true);
    });

    it('displays Completed status correctly (Local Log Match)', () => {
        const logs = [{
            id: 'log-1',
            operatorId: 'op-1',
            operationId: 'task-1',
            hourlyRange: '07:30 - 08:30', // Exact match required
            styleId: 'style-1',
            quantity: 10,
            timestamp: { seconds: 0, nanoseconds: 0 }
        }];

        render(<DailyTimeline {...defaultProps} productionLogs={logs as any} />);

        const completedBtn = screen.getByTitle('Completed');
        expect(completedBtn).toBeDefined();
        expect(completedBtn.hasAttribute('disabled')).toBe(true);
    });

    it('renders Next Style operations', () => {
        const nextSchedule = {
            'op-1': [
                { start: 0, end: 60, opId: 'task-3', count: 10, styleId: 'style-2' }
            ]
        };

        render(<DailyTimeline {...defaultProps} schedule={nextSchedule} selectedNextStyle={mockNextStyle as any} />);

        expect(screen.getByText('Task 3')).toBeDefined();
    });
});
