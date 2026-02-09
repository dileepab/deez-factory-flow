
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OperatorDashboard } from './operator-dashboard';
import { UserRole } from '@/lib/types';

// Mock dependencies
vi.mock('@/auth-provider', () => ({
    useAuth: vi.fn(() => ({
        user: { uid: 'test-user-id', email: 'test@example.com' },
        loading: false
    }))
}));

const mockUseDoc = vi.fn();
const mockUseCollection = vi.fn();

vi.mock('@/firebase/firestore/use-doc', () => ({
    useDoc: (ref: any) => mockUseDoc(ref)
}));

vi.mock('@/firebase/firestore/use-collection', () => ({
    useCollection: (ref: any) => mockUseCollection(ref)
}));

vi.mock('@/firebase/firestore/use-configuration', () => ({
    useConfiguration: vi.fn(() => ({
        data: {
            shiftStartHour: 7.5,
            shiftLengthHours: 9,
            availableMinutesPerDay: 480,
            holidays: []
        },
        isLoading: false
    }))
}));

vi.mock('@/firebase/client', () => ({
    firestore: {}
}));

import { firestore } from '@/firebase/client';

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    onSnapshot: vi.fn(),
    query: vi.fn(),
    where: vi.fn()
}));

import { collection, doc, query, where } from 'firebase/firestore';


// Mock fetch for API calls
global.fetch = vi.fn();

describe('OperatorDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default mocks
        const mockCollectionPath = (path: string) => ({ type: 'collection', path });
        const mockDocPath = (path: string) => ({ type: 'document', path });
        const mockQuery = (col: any) => ({ type: 'query', path: col.path }); // Mock query wraps collection

        (vi.mocked(collection) as any).mockImplementation((_: any, path: string) => mockCollectionPath(path));
        (vi.mocked(doc) as any).mockImplementation((_: any, path: string, ...segments: string[]) => mockDocPath([path, ...segments].join('/')));
        (vi.mocked(query) as any).mockImplementation((col: any) => mockQuery(col));
        (vi.mocked(where) as any).mockImplementation(() => ({ type: 'where_clause' }));

        mockUseDoc.mockImplementation((ref) => {
            if (!ref) return { data: null, isLoading: false };
            const path = ref.path;

            // Mock config
            if (path === 'configuration/app-config') {
                return { data: { shiftStartHour: 7.5, shiftLengthHours: 9 }, isLoading: false };
            }
            // Mock user
            if (path === 'users/test-user-id') {
                return { data: { role: 'operator', name: 'Test Operator' }, isLoading: false };
            }
            // Mock daily plan
            if (path.startsWith('daily_plans/')) {
                return {
                    data: {
                        styleId: 'style-1',
                        schedules: {
                            'test-user-id': [
                                { opId: 'op-1', start: 0, end: 60, count: 10, completed: false }
                            ]
                        }
                    },
                    isLoading: false
                };
            }
            // Mock style doc
            if (path === 'styles/style-1') {
                return {
                    data: {
                        id: 'style-1',
                        name: 'Style A',
                        status: 'active',
                        operations: [
                            { id: 'op-1', name: 'Operation 1', smv: 1 }
                        ]
                    },
                    isLoading: false
                };
            }
            return { data: null, isLoading: false };
        });

        mockUseCollection.mockImplementation((ref) => {
            if (!ref) return { data: [], isLoading: false };
            const path = ref.path;

            // Mock styles
            if (path === 'styles') {
                return {
                    data: [
                        {
                            id: 'style-1',
                            name: 'Style A',
                            status: 'active',
                            operations: [
                                { id: 'op-1', name: 'Operation 1', smv: 1 }
                            ]
                        }
                    ],
                    isLoading: false
                };
            }
            // Mock production logs
            if (path === 'production_logs') {
                return { data: [], isLoading: false };
            }
            return { data: [], isLoading: false };
        });
    });

    it('renders the dashboard with operator name', () => {
        render(<OperatorDashboard />);
        expect(screen.getByText('Welcome, Test Operator!')).toBeDefined();
        expect(screen.getByText("Today's Schedule")).toBeDefined();
    });

    it('displays the assigned tasks', async () => {
        render(<OperatorDashboard />);
        // "Operation 1" should be visible in the timeline
        await waitFor(() => {
            expect(screen.getByText('Operation 1')).toBeDefined();
        });
    });

    it('opens quick log modal when clicking the add button', async () => {
        render(<OperatorDashboard />);

        // Find the "Quick Log Production" button (plus icon)
        // It has title "Quick Log Production"
        const addBtns = await screen.findAllByTitle('Quick Log Production');
        expect(addBtns.length).toBeGreaterThan(0);

        fireEvent.click(addBtns[0]);

        // Modal should open
        expect(screen.getByText('Quick Log Production')).toBeDefined();
        expect(screen.getByText(/Confirm completion for/)).toBeDefined();
    });

    it('submits a log when saving in the modal', async () => {
        (global.fetch as any).mockResolvedValue({ ok: true } as Response);

        render(<OperatorDashboard />);

        const addBtn = (await screen.findAllByTitle('Quick Log Production'))[0];
        fireEvent.click(addBtn);

        const saveBtn = screen.getByText('Save Log');
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith('/api/log-production', expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('"quantity":10')
            }));
        });
    });
});
