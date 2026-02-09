import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProductionEntry } from './production-entry';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useAuth } from '@/auth-provider';

// Polyfill for Radix UI
class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
}
window.ResizeObserver = ResizeObserver;
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();

// Mock UI Components with interactive capabilities
vi.mock('@/components/ui/select', () => ({
    Select: ({ children, onValueChange, value, disabled }: any) => {
        return (
            <div
                data-testid="select-container"
                data-value={value}
                data-disabled={disabled}
                onClick={(e: any) => {
                    const target = e.target as HTMLElement;
                    const item = target.closest('[data-select-item-value]');
                    if (item && !disabled && onValueChange) {
                        const newVal = item.getAttribute('data-select-item-value');
                        onValueChange(newVal);
                    }
                }}
            >
                {children}
            </div>
        );
    },
    SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
    SelectValue: ({ placeholder }: any) => <div data-testid="select-value">{placeholder}</div>,
    SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
    SelectItem: ({ children, value }: any) => <div data-testid="select-item" data-select-item-value={value}>{children}</div>,
}));

vi.mock('@/components/ui/popover', () => ({
    Popover: ({ children }: any) => <div>{children}</div>,
    PopoverTrigger: ({ children }: any) => <div>{children}</div>,
    PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

// Mock Server Modules to prevent side effects
vi.mock('@/firebase/server', () => ({
    auth: {},
    firestore: {}
}));

vi.mock('@/lib/actions', () => ({
    sessionLogin: vi.fn(),
    sessionLogout: vi.fn()
}));

// Mock dependencies
vi.mock('@/firebase/firestore/use-collection');
vi.mock('@/firebase/firestore/use-doc');
vi.mock('@/auth-provider');

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({
        toast: mockToast,
    }),
}));

vi.mock('@/firebase/use-memo-firebase', () => ({
    useMemoFirebase: (fn: any) => fn(),
}));

vi.mock('@/firebase/client', () => ({
    firestore: {},
}));

vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_fs, path) => ({ path })),
    query: vi.fn((coll) => ({ collection: coll })),
    where: vi.fn(),
    doc: vi.fn((_fs, path, ...segments) => ({ path: [path, ...segments].join('/') })),
    Timestamp: {
        fromDate: (d: Date) => ({ seconds: d.getTime() / 1000, nanoseconds: 0 })
    }
}));

// Mock Data
const mockUser = { uid: 'user1', email: 'test@example.com' };
const mockSupervisorProfile = { id: 'user1', role: 'supervisor', name: 'Test Supervisor' };
const mockOperatorProfile = { id: 'op1', role: 'operator', name: 'Operator A' };

const mockOperators = [
    { id: 'op1', name: 'Operator A', role: 'operator' },
    { id: 'op2', name: 'Operator B', role: 'operator' }
];

const mockStyles = [
    {
        id: 'style1',
        name: 'Style X',
        status: 'active',
        operations: [
            { id: 'op1', name: 'Sewing', smv: 60 },
            { id: 'op2', name: 'Cutting', smv: 30 }
        ]
    },
    {
        id: 'style2',
        name: 'Style Y',
        status: 'active',
        operations: [
            { id: 'op3', name: 'Packing', smv: 15 }
        ]
    }
];

const mockDailyPlan = {
    id: 'plan-1',
    date: '2023-01-01',
    styleId: 'style1',
    schedules: {
        'op1': [
            // 7:30 is 0. 8:30 is 60.
            { opId: 'op1', start: 60, end: 120 } // 8:30 - 9:30 range
        ]
    }
};

describe('ProductionEntry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAuth as any).mockReturnValue({ user: mockUser });

        // Smart Mock for useCollection
        (useCollection as any).mockImplementation((query: any) => {
            if (query?.collection?.path === 'users') {
                return { data: mockOperators, isLoading: false };
            }
            if (query?.collection?.path === 'styles') {
                return { data: mockStyles, isLoading: false };
            }
            return { data: [], isLoading: false };
        });

        // Smart Mock for useDoc
        (useDoc as any).mockImplementation((ref: any) => {
            if (ref?.path?.startsWith('daily_plans')) return { data: mockDailyPlan };
            // Default to Supervisor Profile for user doc
            if (ref?.path?.startsWith('users')) return { data: mockSupervisorProfile };
            return { data: null };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the production entry form', () => {
        render(<ProductionEntry />);
        expect(screen.getByText('Hourly Production Entry')).toBeDefined();
        expect(screen.getByText('Save Production')).toBeDefined();
    });

    it('loads and displays operators', async () => {
        render(<ProductionEntry />);

        // Verify operators are present in the DOM (hidden in select but rendered in our mock)
        expect(screen.getByText('Operator A')).toBeDefined();
        expect(screen.getByText('Operator B')).toBeDefined();
    });

    it('locks operator field when user is an operator', () => {
        // Override useDoc for this test to return Operator Profile
        (useDoc as any).mockImplementation((ref: any) => {
            if (ref?.path?.startsWith('daily_plans')) return { data: mockDailyPlan };
            if (ref?.path?.startsWith('users')) return { data: mockOperatorProfile };
            return { data: null };
        });

        render(<ProductionEntry />);

        // Find the Select for Operator
        const opSelect = screen.getAllByTestId('select-container')[0];
        // We expect it to be disabled or set to op1
        expect(opSelect.getAttribute('data-value')).toBe('op1');
        // Check disabled attribute (our mock puts it on data-disabled)
        expect(opSelect.getAttribute('data-disabled')).toBe('true');
    });

    it('auto-fills fields based on daily plan (Smart Fill)', async () => {
        render(<ProductionEntry />);

        // 1. Select Operator 'op1'
        const opA = screen.getAllByText('Operator A')[0];
        fireEvent.click(opA);

        // 2. Select Time Slot '08:30 - 09:30'
        // This slot corresponds to the plan entry: start 60, end 120. (60 mins from 7:30 is 8:30)
        const timeOption = screen.getByText('08:30 - 09:30');
        fireEvent.click(timeOption);

        // Wait for effects
        await waitFor(() => {
            // Check form values via Select data-values
            const selects = screen.getAllByTestId('select-container');
            const styleSelect = selects[1];
            const opSelect = selects[3];

            expect(styleSelect.getAttribute('data-value')).toBe('style1');
            expect(opSelect.getAttribute('data-value')).toBe('op1');
        });

        // Check Quantity input
        const qtyInput = screen.getByPlaceholderText('e.g., 50') as HTMLInputElement;
        expect(qtyInput.value).toBe('1');
    });

    it('handles manual entry submission', async () => {
        // Mock Fetch
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ message: 'Success' })
        })) as any;

        render(<ProductionEntry />);

        // Fill Form
        // 1. Operator
        fireEvent.click(screen.getAllByText('Operator A')[0]);
        // 2. Style
        fireEvent.click(screen.getAllByText('Style X')[0]);
        // 3. Time
        fireEvent.click(screen.getByText('07:30 - 08:30'));
        // 4. Operation
        await waitFor(() => {
            expect(screen.getAllByText(/Sewing/i)[0]).toBeDefined();
        });
        fireEvent.click(screen.getAllByText(/Sewing/i)[0]);

        // 5. Quantity
        const qtyInput = screen.getByPlaceholderText('e.g., 50');
        fireEvent.change(qtyInput, { target: { value: '50' } });

        // Submit
        const submitBtn = screen.getByText('Save Production');
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith('/api/log-production', expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('"quantity":50')
            }));

            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Production Logged'
            }));
        });
    });

    it('shows error toast on submission failure', async () => {
        // Mock Fetch Error
        global.fetch = vi.fn(() => Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ message: 'Server Error' })
        })) as any;

        render(<ProductionEntry />);

        // Fill Form minimal
        fireEvent.click(screen.getAllByText('Operator A')[0]);
        fireEvent.click(screen.getAllByText('Style X')[0]);
        fireEvent.click(screen.getByText('07:30 - 08:30'));
        await waitFor(() => expect(screen.getAllByText(/Sewing/i)[0]).toBeDefined());
        fireEvent.click(screen.getAllByText(/Sewing/i)[0]);
        fireEvent.change(screen.getByPlaceholderText('e.g., 50'), { target: { value: '10' } });

        // Submit
        fireEvent.click(screen.getByText('Save Production'));

        await waitFor(() => {
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                variant: 'destructive',
                description: 'Server Error'
            }));
        });
    });

    it('validates required fields', async () => {
        global.fetch = vi.fn();

        render(<ProductionEntry />);

        // Click save without filling anything
        fireEvent.click(screen.getByText('Save Production'));

        await waitFor(() => {
            expect(global.fetch).not.toHaveBeenCalled();
            // Zod validation messages should appear
            expect(screen.getAllByText('Please select an operator.')).toBeDefined();
        });
    });
});
