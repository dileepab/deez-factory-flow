import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { StyleManagement } from './style-management';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useConfiguration } from '@/firebase/firestore/use-configuration';
import * as firestoreModule from 'firebase/firestore';

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

// Mock UI Components to avoid Radix/JSDOM issues
vi.mock('@/components/ui/dialog', () => ({
    Dialog: ({ children, open }: { children: any, open: boolean }) => <div data-testid="dialog" data-state={open ? 'open' : 'closed'}>{open ? children : null}</div>,
    DialogContent: ({ children }: { children: any }) => <div data-testid="dialog-content">{children}</div>,
    DialogHeader: ({ children }: { children: any }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: any }) => <div>{children}</div>,
    DialogDescription: ({ children }: { children: any }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children: any }) => <div>{children}</div>,
    DialogClose: ({ children }: { children: any }) => <div onClick={() => { }}>{children}</div>,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
    DropdownMenu: ({ children }: { children: any }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: any }) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: { children: any }) => <div>{children}</div>,
    DropdownMenuItem: ({ children, onClick }: { children: any, onClick: any }) => <div role="button" onClick={onClick}>{children}</div>,
    DropdownMenuLabel: ({ children }: { children: any }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
}));

vi.mock('@/components/ui/accordion', () => ({
    Accordion: ({ children }: { children: any }) => <div>{children}</div>,
    AccordionItem: ({ children }: { children: any }) => <div>{children}</div>,
    AccordionTrigger: ({ children }: { children: any }) => <div>{children}</div>,
    AccordionContent: ({ children }: { children: any }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/tabs', () => ({
    Tabs: ({ children, value, onValueChange }: any) => (
        <div data-testid="tabs">
            {/* Render children. If trigger clicked, we manually handle it in Trigger mock or here? 
                Better: Mock Trigger as button that calls a global context? 
                Or just clone children? Hard in simple mock. 
                Easier: Pass onValueChange to Triggers context?
                Or just make Tabs a div, and Triggers are buttons with onClick.
                But Triggers are inside TabsList inside Tabs.
                Prop drilling hard in simple mock.
                
                Actually, Radix mocks usually just work if we render basic elements.
                Let's try exposing functionality via data-attributes or simple logic.
            */}
            <div onClick={(e: any) => {
                const val = e.target.getAttribute('data-tab-value');
                if (val && onValueChange) onValueChange(val);
            }}>
                {children}
            </div>
        </div>
    ),
    TabsList: ({ children }: any) => <div>{children}</div>,
    TabsTrigger: ({ children, value }: any) => <button data-tab-value={value}>{children}</button>,
    TabsContent: ({ children, value }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
    AlertDialog: ({ children, open }: { children: any, open: boolean }) => open ? <div data-testid="alert-dialog">{children}</div> : null,
    AlertDialogContent: ({ children }: { children: any }) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: { children: any }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: any }) => <div>{children}</div>,
    AlertDialogDescription: ({ children }: { children: any }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children: any }) => <div>{children}</div>,
    AlertDialogCancel: ({ children }: { children: any }) => <button>{children}</button>,
    AlertDialogAction: ({ children, onClick }: { children: any, onClick: any }) => <button onClick={onClick}>{children}</button>,
}));

vi.mock('@/components/ui/checkbox', () => ({
    Checkbox: ({ checked, onCheckedChange }: { checked: boolean, onCheckedChange: any }) => (
        <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheckedChange(e.target.checked)}
        />
    )
}));

vi.mock('@/components/ui/select', () => ({
    Select: ({ children, value, onValueChange }: any) => (
        <div data-testid="select">
            <select value={value} onChange={e => onValueChange(e.target.value)}>
                {children}
            </select>
        </div>
    ),
    SelectTrigger: ({ children }: any) => <div>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
}));

// Mock dependencies
vi.mock('@/firebase/firestore/use-collection');
vi.mock('@/firebase/firestore/use-configuration');
vi.mock('@/firebase/use-memo-firebase', () => ({
    useMemoFirebase: (fn: any) => fn(),
}));

vi.mock('@/firebase/client', () => ({
    firestore: {},
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({
        toast: vi.fn(),
    }),
}));

// Mock Firestore functions
const mockAddDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockBatchCommit = vi.fn();
const mockBatchDelete = vi.fn();
const mockWriteBatch = vi.fn(() => ({
    delete: mockBatchDelete,
    commit: mockBatchCommit
}));
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('firebase/firestore')>();
    return {
        ...actual,
        collection: vi.fn(),
        query: vi.fn(),
        where: vi.fn(),
        doc: vi.fn(),
        addDoc: (ref: any, data: any) => mockAddDoc(ref, data),
        updateDoc: (ref: any, data: any) => mockUpdateDoc(ref, data),
        deleteDoc: (ref: any) => mockDeleteDoc(ref),
        writeBatch: () => mockWriteBatch(),
        getDoc: () => mockGetDoc(),
        getDocs: () => mockGetDocs(),
        deleteField: () => 'DELETE_FIELD_SENTINEL',
    };
});

// Mock Data
const mockConfig = {
    minuteValueLKR: 30,
};

const mockStyle1 = {
    id: 'style1',
    name: 'T-Shirt Basic',
    quantity: 100,
    status: 'active',
    totalSmv: 15,
    operations: [
        { id: 'op1', name: 'Sleeve Attach', smv: 60, machineType: 'Overlock', completedQuantity: 0 },
        { id: 'op2', name: 'Hemming', smv: 45, machineType: 'Flatlock', completedQuantity: 0 }
    ]
};

const mockStyles = [
    mockStyle1,
    {
        id: 'style2',
        name: 'Polo Shirt',
        quantity: 50,
        status: 'active',
        totalSmv: 20,
        operations: []
    }
];

describe('StyleManagement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useConfiguration as any).mockReturnValue({ data: mockConfig, isLoading: false });
        (useCollection as any).mockReturnValue({ data: mockStyles, isLoading: false });
        // Default Mock GetDoc (found)
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => mockStyle1
        });
        mockGetDocs.mockResolvedValue({
            forEach: () => { }
        });
    });

    it('renders the style management card', () => {
        render(<StyleManagement />);
        expect(screen.getByText('Garment Style Management')).toBeDefined();
        // Check for style list
        expect(screen.getByText('T-Shirt Basic')).toBeDefined();
        expect(screen.getByText('Polo Shirt')).toBeDefined();
    });

    it('opens add style dialog and submits new style', async () => {
        render(<StyleManagement />);

        // Click Add New Style
        const addBtn = screen.getByText('Add New Style');
        fireEvent.click(addBtn);

        // Fill Form
        await waitFor(() => {
            expect(screen.getByText('Create New Garment Style')).toBeDefined();
        });

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Jeans' } });

        // Add Variant
        const addVariantBtn = screen.getByText('+ Add Variant');
        fireEvent.click(addVariantBtn);

        // Fill Variant
        const colorInput = screen.getByPlaceholderText('Color (e.g. Red)');
        fireEvent.change(colorInput, { target: { value: 'Blue' } });

        const qtyInput = screen.getByPlaceholderText('Qty');
        fireEvent.change(qtyInput, { target: { value: '200' } });

        // Submit
        fireEvent.click(screen.getByText('Create Style'));

        await waitFor(() => {
            expect(mockAddDoc).toHaveBeenCalledWith(
                undefined,
                expect.objectContaining({
                    name: 'New Jeans',
                    quantity: 200,
                    status: 'active',
                    variants: expect.arrayContaining([
                        expect.objectContaining({
                            color: 'Blue',
                            quantity: 200
                        })
                    ])
                })
            );
        });
    });

    it('opens actions menu and handles edit style', async () => {
        render(<StyleManagement />);

        // Click Edit Style (use findAllByText because our mock renders all menus)
        const editBtns = await screen.findAllByText('Edit Style');
        fireEvent.click(editBtns[0]);

        // Edit Dialog should open with pre-filled values
        await waitFor(() => {
            expect(screen.getByDisplayValue('T-Shirt Basic')).toBeDefined();
        });

        fireEvent.change(screen.getByDisplayValue('T-Shirt Basic'), { target: { value: 'T-Shirt Premium' } });

        // Add Variant to existing style
        const addVariantBtn = screen.getByText('+ Add Variant');
        fireEvent.click(addVariantBtn);

        // Fill Variant
        const colorInputs = screen.getAllByPlaceholderText('Color');
        fireEvent.change(colorInputs[0], { target: { value: 'Green' } });

        const qtyInputs = screen.getAllByPlaceholderText('Qty');
        fireEvent.change(qtyInputs[0], { target: { value: '150' } });

        fireEvent.click(screen.getByText('Save Changes'));

        await waitFor(() => {
            expect(mockUpdateDoc).toHaveBeenCalledWith(
                undefined,
                expect.objectContaining({
                    name: 'T-Shirt Premium',
                    quantity: 150,
                    variants: expect.arrayContaining([
                        expect.objectContaining({
                            color: 'Green',
                            quantity: 150
                        })
                    ])
                })
            );
        });
    });

    it('handles adding an operation', async () => {
        render(<StyleManagement />);

        // Click Add Operation
        const addOpBtns = await screen.findAllByText('Add Operation');
        fireEvent.click(addOpBtns[0]);

        await waitFor(() => {
            expect(screen.getByText('Add New Operation')).toBeDefined();
        });

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Button Attach' } });
        fireEvent.change(screen.getByLabelText('Time (s)'), { target: { value: '30' } });

        // Machine Type default is selected (Machine A/Overlock?), can change if needed.

        const dialogContent = screen.getByTestId('dialog-content');
        const submitBtn = within(dialogContent).getByText('Add Operation');
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(mockUpdateDoc).toHaveBeenCalled();
            const updateCall = mockUpdateDoc.mock.calls[0];
            const updateData = updateCall[1];
            expect(updateData.operations).toHaveLength(3);
            expect(updateData.operations[2].name).toBe('Button Attach');
        });
    });

    it('handles deleting a style', async () => {
        render(<StyleManagement />);

        const deleteBtns = await screen.findAllByText('Delete Style');
        fireEvent.click(deleteBtns[0]);

        // Alert Dialog appears
        await waitFor(() => {
            expect(screen.getByTestId('alert-dialog')).toBeDefined();
        });

        // Confirm Delete
        fireEvent.click(screen.getByText('Continue'));

        await waitFor(() => {
            expect(mockWriteBatch).toHaveBeenCalled();
            expect(mockBatchCommit).toHaveBeenCalled();
        });
    });

    it('handles toggling style status', async () => {
        render(<StyleManagement />);

        const statusBtns = await screen.findAllByText('Mark as Completed');
        fireEvent.click(statusBtns[0]);

        await waitFor(() => {
            expect(mockUpdateDoc).toHaveBeenCalledWith(
                undefined,
                expect.objectContaining({ status: 'completed' })
            );
        });
    });

    it('handles deleting an operation', async () => {
        render(<StyleManagement />);

        // Operations are in a table. Delete button is icon (Trash).
        // My mock renders the button with onClick containing `setOperationToDelete`.
        // Button text is not visible (icon only).
        // But I mocked `Trash` as `<Trash />`? 
        // Real code imports `Trash`.
        // Test environment renders `Trash` (Lucide).
        // How to click? `getAllByRole('button')` inside row?

        // Or finding by class `text-red-600` on button.
        // Row 1 (Sleeve Attach).
        const opRow = screen.getByText('Sleeve Attach').closest('tr');
        const trashBtn = within(opRow!).getAllByRole('button')[1]; // 0 is edit, 1 is trash
        fireEvent.click(trashBtn);

        // Alert Dialog
        await waitFor(() => {
            expect(screen.getByText('Delete Operation?')).toBeDefined();
        });

        fireEvent.click(screen.getByText('Delete'));

        await waitFor(() => {
            expect(mockUpdateDoc).toHaveBeenCalled();
            const updateCall = mockUpdateDoc.mock.calls[0];
            const updateData = updateCall[1];
            // Op 1 removed, Op 2 remains.
            expect(updateData.operations).toHaveLength(1);
            expect(updateData.operations[0].id).toBe('op2');
        });
    });

    it('handles editing an operation', async () => {
        render(<StyleManagement />);

        const opRow = screen.getByText('Sleeve Attach').closest('tr');
        const editBtn = within(opRow!).getAllByRole('button')[0];
        fireEvent.click(editBtn);

        await waitFor(() => {
            expect(screen.getByText('Edit Operation')).toBeDefined();
        });

        // Pre-filled
        const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
        expect(nameInput.value).toBe('Sleeve Attach');

        fireEvent.change(nameInput, { target: { value: 'Sleeve Attach V2' } });

        const dialogContent = screen.getByTestId('dialog-content');
        const saveBtn = within(dialogContent).getByText('Save Changes');
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockUpdateDoc).toHaveBeenCalled();
            const updateCall = mockUpdateDoc.mock.calls[0];
            const updateData = updateCall[1];
            expect(updateData.operations[0].name).toBe('Sleeve Attach V2');
        });
    });

    it('filters styles by status', async () => {
        render(<StyleManagement />);

        // Initial Active
        expect(screen.getByText('T-Shirt Basic')).toBeDefined();

        // Click Completed Tab
        const completedTab = screen.getByText('Completed');
        fireEvent.click(completedTab);

        // Check filtering (controlled by useCollection query).
        // My mock returns SAME data for all queries unless I customize it.
        // `useCollection` mock updates?
        // With `useMemoFirebase`, query changes. `useCollection` re-runs.
        // I need to intercept the `query` call or `useCollection` call.

        // In this test setup, `useCollection` returns `data: mockStyles`.
        // `mockStyles` has Active styles.
        // If query changes, `useCollection` is called with new query key.
        // But my mock always returns `mockStyles`.
        // So rendering wont change.

        // However, I can Verify the query was constructed with 'completed'.
        // `firestoreModule.where` should be called with 'completed'.
        await waitFor(() => {
            // Expect `where` to have been called with 'status', '==', 'completed'
            // `where` is a named export mocked.
            const whereMock = firestoreModule.where as unknown as ReturnType<typeof vi.fn>;
            expect(whereMock).toHaveBeenCalledWith('status', '==', 'completed');
        });
    });
});
