import { render, screen } from '@testing-library/react';
import { SupervisorManagement } from './supervisor-management';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useCollection } from '@/firebase/firestore/use-collection';

// Mock dependencies
vi.mock('@/firebase/firestore/use-collection');
vi.mock('@/firebase/use-memo-firebase', () => ({
    useMemoFirebase: (fn: any) => fn(),
}));

vi.mock('@/firebase/client', () => ({
    firestore: {},
}));

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
}));

// Mock Data
const mockSupervisors = [
    { id: 'sup1', name: 'Alice Supervisor', email: 'alice@example.com', role: 'supervisor' },
    { id: 'sup2', name: 'Bob Supervisor', email: 'bob@example.com', role: 'supervisor' },
];

describe('SupervisorManagement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the supervisor management card', () => {
        (useCollection as any).mockReturnValue({ data: [], isLoading: false });
        render(<SupervisorManagement />);
        expect(screen.getByText('Supervisor Management')).toBeDefined();
        expect(screen.getByText('View and manage supervisors.')).toBeDefined();
    });

    it('shows loading state correctly', () => {
        (useCollection as any).mockReturnValue({ data: [], isLoading: true });
        render(<SupervisorManagement />);
        expect(screen.getByText('Loading supervisors...')).toBeDefined();
    });

    it('renders a list of supervisors', () => {
        (useCollection as any).mockReturnValue({ data: mockSupervisors, isLoading: false });
        render(<SupervisorManagement />);

        expect(screen.getByText('Alice Supervisor')).toBeDefined();
        expect(screen.getByText('alice@example.com')).toBeDefined();
        expect(screen.getByText('Bob Supervisor')).toBeDefined();
        expect(screen.getByText('bob@example.com')).toBeDefined();
    });

    it('renders empty table when no supervisors found', () => {
        (useCollection as any).mockReturnValue({ data: [], isLoading: false });
        render(<SupervisorManagement />);
        // Header should still be there
        expect(screen.getByText('Name')).toBeDefined();
        expect(screen.getByText('Email')).toBeDefined();
        // No rows with data
        expect(screen.queryByText('Alice Supervisor')).toBeNull();
    });
});
