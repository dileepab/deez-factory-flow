
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OperatorManagement } from './operator-management';

// Mock Auth
vi.mock('@/auth-provider', () => ({
    useAuth: vi.fn(() => ({
        user: { uid: 'admin-1', email: 'admin@example.com' },
        loading: false
    }))
}));

// Mock Toast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: mockToast })
}));

// Mock Configuration (REQUIRED)
vi.mock('@/firebase/firestore/use-configuration', () => ({
    useConfiguration: vi.fn(() => ({
        data: {
            minuteValueLKR: 10,
            attendanceBonusLKR: 5000
        },
        isLoading: false
    }))
}));

// Mock Firestore Hooks
const mockUseCollection = vi.fn();
vi.mock('@/firebase/firestore/use-collection', () => ({
    useCollection: (ref: any) => mockUseCollection(ref)
}));

// Mock Firebase SDK
const mockAddDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDeleteDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    doc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    initializeFirestore: vi.fn(() => ({})),
    persistentLocalCache: vi.fn(),
    onSnapshot: vi.fn(), // Required for useDoc/useConfiguration internal calls if any
    addDoc: (ref: any, data: any) => mockAddDoc(ref, data),
    updateDoc: (ref: any, data: any) => mockUpdateDoc(ref, data),
    deleteDoc: (ref: any) => mockDeleteDoc(ref)
}));

import { collection, doc, query, where, orderBy } from 'firebase/firestore';

// Polyfill ResizeObserver if needed (likely for dialogs/animations)
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};


describe('OperatorManagement', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Setup Firestore Mocks
        const mockCollectionPath = (path: string) => ({ type: 'collection', path });
        const mockDocPath = (path: string) => ({ type: 'document', path });
        const mockQuery = (col: any) => ({ type: 'query', path: col.path });

        (vi.mocked(collection) as any).mockImplementation((_: any, path: string) => mockCollectionPath(path));
        (vi.mocked(doc) as any).mockImplementation((_: any, path: string, ...segments: string[]) => mockDocPath([path, ...segments].join('/')));
        (vi.mocked(query) as any).mockImplementation((col: any) => mockQuery(col));
        (vi.mocked(where) as any).mockImplementation(() => ({ type: 'where' }));
        (vi.mocked(orderBy) as any).mockImplementation(() => ({ type: 'orderBy' }));

        // Setup Data Mock
        mockUseCollection.mockImplementation((ref) => {
            if (!ref) return { data: [], isLoading: false };
            // Use vague matching since query objects are complex
            // Ideally check ref.type === 'query' and path base
            return {
                data: [
                    { id: 'op-1', role: 'operator', name: 'John Doe', email: 'john@example.com', skills: ['Sewing'], efficiencyRating: 100 },
                    { id: 'op-2', role: 'operator', name: 'Jane Smith', email: 'jane@example.com', skills: ['Iron'], efficiencyRating: 100 }
                ],
                isLoading: false
            };
        });
    });

    it('renders the operator list', async () => {
        render(<OperatorManagement />);
        expect(screen.getByText('Operator Management')).toBeDefined();

        await waitFor(() => {
            expect(screen.getByText('John Doe')).toBeDefined();
            expect(screen.getByText('Jane Smith')).toBeDefined();
        });
    });

    it('allows editing an operator', async () => {
        render(<OperatorManagement />);

        // Wait for list to load
        await waitFor(() => screen.getByText('John Doe'));

        // Find Edit button for John Doe
        // Using title attribute "Edit Skills"
        const editBtns = screen.getAllByTitle('Edit Skills');
        expect(editBtns.length).toBeGreaterThan(0);
        fireEvent.click(editBtns[0]);

        // Check Dialog
        await waitFor(() => screen.getByText(/Edit Operator: John Doe/i));

        // Change Efficiency
        // Shadcn Input usually has associated label
        // const efficiencyInput = screen.getByLabelText('Efficiency Rating (%)'); <-- might fail if id mismatch
        // Try finding by generic role or placeholder if label fails.
        // Or simpler: getByDisplayValue('100') since default is 100
        const efficiencyInput = screen.getByDisplayValue('100');
        fireEvent.change(efficiencyInput, { target: { value: '95' } });

        // Submit
        const saveBtn = screen.getByText('Save Changes');
        fireEvent.click(saveBtn);

        // Verify Update
        await waitFor(() => {
            expect(mockUpdateDoc).toHaveBeenCalled();
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                title: "Operator Updated"
            }));
        });
    });
});
