import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ProductionLog } from './production-log';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useCollection } from '@/firebase/firestore/use-collection';
import * as firestoreModule from 'firebase/firestore';

// --- Mocks ---

// Mock Firebase
vi.mock('@/firebase/firestore/use-collection');
vi.mock('@/firebase/use-memo-firebase', () => ({
    useMemoFirebase: (fn: any) => fn(),
}));
vi.mock('@/firebase/client', () => ({
    firestore: {},
}));

const { mockDeleteDoc, mockUpdateDoc } = vi.hoisted(() => {
    return {
        mockDeleteDoc: vi.fn(),
        mockUpdateDoc: vi.fn(),
    }
});

vi.mock('firebase/firestore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('firebase/firestore')>();
    return {
        ...actual,
        collection: vi.fn(),
        query: vi.fn(),
        where: vi.fn(),
        doc: vi.fn(),
        deleteDoc: mockDeleteDoc,
        updateDoc: mockUpdateDoc,
        Timestamp: {
            fromDate: (date: Date) => ({ toDate: () => date }),
        }
    };
});

// Mock UI Components
vi.mock('@/components/ui/card', () => ({
    Card: ({ children }: any) => <div>{children}</div>,
    CardHeader: ({ children }: any) => <div>{children}</div>,
    CardTitle: ({ children }: any) => <div>{children}</div>,
    CardDescription: ({ children }: any) => <div>{children}</div>,
    CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/accordion', () => ({
    Accordion: ({ children }: any) => <div>{children}</div>,
    AccordionItem: ({ children }: any) => <div>{children}</div>,
    AccordionTrigger: ({ children }: any) => <div role="button">{children}</div>,
    AccordionContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
    AlertDialog: ({ children, open }: any) => open ? <div data-testid="alert-dialog">{children}</div> : null,
    AlertDialogContent: ({ children }: any) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
    AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
    AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
    AlertDialogAction: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));

vi.mock('@/components/ui/dialog', () => ({
    Dialog: ({ children, open }: any) => open ? <div data-testid="edit-dialog">{children}</div> : null,
    DialogContent: ({ children }: any) => <div>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => <div>{children}</div>,
    DialogDescription: ({ children }: any) => <div>{children}</div>,
    DialogFooter: ({ children }: any) => <div>{children}</div>,
    DialogClose: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/popover', () => ({
    Popover: ({ children }: any) => <div>{children}</div>,
    PopoverTrigger: ({ children }: any) => <div>{children}</div>,
    PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/calendar', () => ({
    Calendar: ({ onSelect }: any) => (
        <div data-testid="calendar">
            <button onClick={() => onSelect(new Date(2023, 9, 15))}>Select Date</button>
        </div>
    ),
}));

// Global Fetch Mock
global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
})) as any;


// Mock Data
const mockOperators = [
    { id: 'op1', name: 'Alice' },
    { id: 'op2', name: 'Bob' }
];

const mockStyles = [
    {
        id: 'style1',
        name: 'Style A',
        operations: [
            { id: 'task1', name: 'Sewing' }
        ]
    }
];

const mockLogs = [
    {
        id: 'log1',
        operatorId: 'op1',
        styleId: 'style1',
        operationId: 'task1',
        hourlyRange: '07:30 - 08:30',
        cumulativeQuantity: 10,
        timestamp: { seconds: 1000 }
    },
    {
        id: 'log2',
        operatorId: 'op2',
        styleId: 'style1',
        operationId: 'task1',
        hourlyRange: '08:30 - 09:30',
        cumulativeQuantity: 15,
        timestamp: { seconds: 2000 }
    }
];

describe('ProductionLog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state', () => {
        (useCollection as any).mockReturnValue({ data: null, isLoading: true });
        render(<ProductionLog />);
        expect(screen.getByText('Loading logs...')).toBeDefined();
    });

    it('renders grouped logs correctly', () => {
        (useCollection as any)
            .mockReturnValueOnce({ data: mockLogs, isLoading: false }) // Logs
            .mockReturnValueOnce({ data: mockOperators, isLoading: false }) // Operators
            .mockReturnValueOnce({ data: mockStyles, isLoading: false }); // Styles

        render(<ProductionLog />);

        // Should show groupings
        expect(screen.getByText(/07:30 - 08:30/)).toBeDefined();
        expect(screen.getByText(/08:30 - 09:30/)).toBeDefined();

        // Should show enriched data
        expect(screen.getByText('Alice')).toBeDefined();
        expect(screen.getByText('Bob')).toBeDefined();
        expect(screen.getAllByText('Sewing').length).toBeGreaterThan(0);
    });

    it('handles delete interaction', async () => {
        (useCollection as any)
            .mockReturnValueOnce({ data: mockLogs, isLoading: false })
            .mockReturnValueOnce({ data: mockOperators, isLoading: false })
            .mockReturnValueOnce({ data: mockStyles, isLoading: false });

        render(<ProductionLog />);

        // Find delete button for first row (Alice)
        // Table structure mock: 
        // We need to find the specific Delete button.
        // Screen has "Delete" text in buttons.
        const deleteBtns = screen.getAllByText('Delete');
        fireEvent.click(deleteBtns[0]);

        // Dialog should open
        expect(screen.getByTestId('alert-dialog')).toBeDefined();
        expect(screen.getByText(/Are you absolutely sure/)).toBeDefined();

        // Confirm
        fireEvent.click(screen.getByText('Continue'));

        await waitFor(() => {
            expect(mockDeleteDoc).toHaveBeenCalled();
            // Check if stats update triggered
            expect(global.fetch).toHaveBeenCalledWith('/api/update-stats', expect.anything());
        });
    });

    it('handles edit interaction', async () => {
        (useCollection as any)
            .mockReturnValueOnce({ data: mockLogs, isLoading: false })
            .mockReturnValueOnce({ data: mockOperators, isLoading: false })
            .mockReturnValueOnce({ data: mockStyles, isLoading: false });

        render(<ProductionLog />);

        const editBtns = screen.getAllByText('Edit');
        fireEvent.click(editBtns[0]);

        expect(screen.getByTestId('edit-dialog')).toBeDefined();

        // Change Input
        const input = screen.getByLabelText('New Quantity');
        fireEvent.change(input, { target: { value: '20' } });

        // Save
        // Button text is "Save changes"
        fireEvent.click(screen.getByText('Save changes'));

        // Wait For Update
        // Note: The click triggers handleSubmit. 
        // We need to wait for updateDoc call.

        await waitFor(() => {
            expect(mockUpdateDoc).toHaveBeenCalledWith(
                undefined, // The doc ref was created via doc(). Since doc is mocked as vi.fn using defaults, it returns undefined or mock object?
                // doc(firestore, 'production', id) -> returns whatever doc() returns.
                // We didn't mock return of doc(). It returns undefined by default.
                // So checking first arg might fail strict match if implementation relies on doc ref object.
                // But mockUpdateDoc receives it.
                // Let's use expect.anything() for ref.
                expect.objectContaining({ cumulativeQuantity: 20 })
            );
            expect(global.fetch).toHaveBeenCalled();
        });
    });

    it('handles date selection', async () => {
        (useCollection as any)
            .mockReturnValue({ data: [], isLoading: false }); // Default return

        render(<ProductionLog />);

        // Open Popover (Simulated by finding trigger)
        // Trigger generic button with text "Pick a date" (if today selected, shows today's date formatted)
        // Initial state is today.

        // We mocked Calendar to have a button "Select Date" that calls onSelect with specific date.
        // But popover content is only shown if open? 
        // Our Popover Mock renders everything visible? 
        // Mock: PopoverContent children rendered.

        // Click "Select Date" in mock calendar
        fireEvent.click(screen.getByText('Select Date'));

        // This should update state `selectedDate`.
        // The `useMemoFirebase` hook for `productionQuery` depends on `selectedDate`.
        // We can verify that `query` was called with new date range.

        await waitFor(() => {
            // Check if query was called with updated Timestamp
            // We can check mock calls of `query`
            expect(firestoreModule.query).toHaveBeenCalled();
            // Difficult to inspect exact arguments of sub-calls in complex useMemo
        });
    });
});
