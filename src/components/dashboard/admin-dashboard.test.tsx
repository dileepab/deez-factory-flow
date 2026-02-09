
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminDashboard } from './admin-dashboard';

// Mock dependencies
vi.mock('@/auth-provider', () => ({
    useAuth: vi.fn(() => ({
        user: { uid: 'admin-1', email: 'admin@example.com' },
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
    query: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
    Timestamp: {
        fromDate: vi.fn((date) => ({
            seconds: Math.floor(date.getTime() / 1000),
            nanoseconds: 0,
            toDate: () => date
        })),
        now: vi.fn(() => ({
            seconds: Math.floor(Date.now() / 1000),
            nanoseconds: 0,
            toDate: () => new Date()
        }))
    }
}));

import { collection, doc, query, where, limit, orderBy, Timestamp } from 'firebase/firestore';

global.fetch = vi.fn();

// Polyfill ResizeObserver for Recharts
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

describe('AdminDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        const mockCollectionPath = (path: string) => ({ type: 'collection', path });
        const mockDocPath = (path: string) => ({ type: 'document', path });
        const mockQuery = (col: any) => ({ type: 'query', path: col.path });

        (vi.mocked(collection) as any).mockImplementation((_: any, path: string) => mockCollectionPath(path));
        (vi.mocked(doc) as any).mockImplementation((_: any, path: string, ...segments: string[]) => mockDocPath([path, ...segments].join('/')));
        (vi.mocked(query) as any).mockImplementation((col: any) => mockQuery(col));
        (vi.mocked(where) as any).mockImplementation(() => ({ type: 'where' }));
        (vi.mocked(limit) as any).mockImplementation(() => ({ type: 'limit' }));
        (vi.mocked(orderBy) as any).mockImplementation(() => ({ type: 'orderBy' }));

        mockUseDoc.mockImplementation((ref) => {
            if (!ref) return { data: null, isLoading: false };
            const path = ref.path;

            if (path === 'users/admin-1') {
                return { data: { role: 'admin', name: 'Test Admin' }, isLoading: false };
            }
            return { data: null, isLoading: false };
        });

        mockUseCollection.mockImplementation((ref) => {
            if (!ref) return { data: [], isLoading: false };
            const path = ref.path;

            if (path === 'production') {
                return {
                    data: [
                        {
                            id: 'log-1',
                            operatorId: 'op-1',
                            styleId: 'style-1',
                            operationId: 'op-1',
                            quantity: 10,
                            cumulativeQuantity: 10,
                            timestamp: { seconds: Date.now() / 1000, toDate: () => new Date() }
                        }
                    ],
                    isLoading: false
                };
            }
            if (path === 'users') {
                return {
                    data: [
                        { id: 'op-1', role: 'operator', name: 'Operator 1', efficiency: 85 },
                        { id: 'admin-1', role: 'admin', name: 'Test Admin' }
                    ],
                    isLoading: false
                };
            }
            if (path === 'styles') {
                return {
                    data: [
                        {
                            id: 'style-1',
                            name: 'Style A',
                            status: 'active',
                            operations: [{ id: 'op-1', smv: 1 }],
                            totalSmv: 10,
                            quantity: 100
                        }
                    ],
                    isLoading: false
                };
            }
            return { data: [], isLoading: false };
        });
    });

    it('renders the dashboard with key stats', async () => {
        render(<AdminDashboard />);
        await expect(screen.findByText('Total Production', {}, { timeout: 3000 })).resolves.toBeDefined();
        await expect(screen.findByText('Platform Efficiency (Today)')).resolves.toBeDefined();
    });

    it('displays navigation tabs', async () => {
        render(<AdminDashboard />);
        expect(screen.getByText('Styles')).toBeDefined();
        expect(screen.getByText('Operators')).toBeDefined();
    });
});
