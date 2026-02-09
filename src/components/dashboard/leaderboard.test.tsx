import { render, screen, fireEvent } from '@testing-library/react';
import { OperatorLeaderboard } from './leaderboard';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useCollection } from '@/firebase/firestore/use-collection';

// --- Mocks ---

// Mock Firebase
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

// Mock Utils
vi.mock('@/lib/utils', () => ({
    cn: (...inputs: any[]) => inputs.join(' '),
}));

// Mock UI Components
vi.mock('@/components/ui/card', () => ({
    Card: ({ children, className }: any) => <div className={className}>{children}</div>,
    CardHeader: ({ children }: any) => <div>{children}</div>,
    CardTitle: ({ children }: any) => <div>{children}</div>,
    CardDescription: ({ children }: any) => <div>{children}</div>,
    CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/table', () => ({
    Table: ({ children }: any) => <table>{children}</table>,
    TableHeader: ({ children }: any) => <thead>{children}</thead>,
    TableBody: ({ children }: any) => <tbody>{children}</tbody>,
    TableRow: ({ children }: any) => <tr>{children}</tr>,
    TableHead: ({ children }: any) => <th>{children}</th>,
    TableCell: ({ children }: any) => <td>{children}</td>,
}));

vi.mock('@/components/ui/avatar', () => ({
    Avatar: ({ children }: any) => <div>{children}</div>,
    AvatarImage: ({ src, alt }: any) => <img src={src} alt={alt} />,
    AvatarFallback: ({ children }: any) => <span>{children}</span>,
}));

// Functional Mock for Tabs
vi.mock('@/components/ui/tabs', () => ({
    Tabs: ({ children, value, onValueChange }: any) => (
        <div data-testid="tabs">
            <div onClick={(e: any) => {
                const trigger = e.target.closest('[data-tab-value]');
                if (trigger && onValueChange) {
                    onValueChange(trigger.getAttribute('data-tab-value'));
                }
            }}>
                {children}
            </div>
        </div>
    ),
    TabsList: ({ children }: any) => <div>{children}</div>,
    TabsTrigger: ({ children, value }: any) => <button data-tab-value={value}>{children}</button>,
}));

vi.mock('lucide-react', () => ({
    Loader2: () => <div data-testid="loader">Loading...</div>
}));

// Mock Data
const mockOperators = [
    {
        id: 'op1',
        name: 'Alice',
        role: 'operator',
        efficiency: 85, // Daily
        monthlyStats: { '2023-10': { monthlyEfficiency: 90 } },
        photoURL: 'alice.jpg'
    },
    {
        id: 'op2',
        name: 'Bob',
        role: 'operator',
        efficiency: 70, // Daily
        monthlyStats: { '2023-10': { monthlyEfficiency: 75 } }
    },
    {
        id: 'op3',
        name: 'Charlie',
        role: 'operator',
        efficiency: 95, // Daily
        monthlyStats: { '2023-10': { monthlyEfficiency: 80 } }
    },
];

describe('OperatorLeaderboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Setup Date: 2023-10-15
        vi.useFakeTimers();
        const date = new Date(2023, 9, 15);
        vi.setSystemTime(date);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders loading state', () => {
        (useCollection as any).mockReturnValue({ data: null, isLoading: true });

        render(<OperatorLeaderboard />);
        expect(screen.getByTestId('loader')).toBeDefined();
    });

    it('renders empty state', () => {
        (useCollection as any).mockReturnValue({ data: [], isLoading: false });

        render(<OperatorLeaderboard />);
        expect(screen.getByText(/No operator data available/i)).toBeDefined();
    });

    it('renders Full Mode with correct sorting (Today)', () => {
        (useCollection as any).mockReturnValue({ data: mockOperators, isLoading: false });

        render(<OperatorLeaderboard />);

        // Sorting Today: 
        // 1. Charlie (95)
        // 2. Alice (85)
        // 3. Bob (70)

        const rows = screen.getAllByRole('row');
        // Header is row 0. Data start at row 1.

        const getRowText = (index: number) => rows[index].textContent;

        // Row 1: Charlie
        expect(getRowText(1)).toContain('Charlie');
        expect(getRowText(1)).toContain('95.00%');

        // Row 2: Alice
        expect(getRowText(2)).toContain('Alice');
        expect(getRowText(2)).toContain('85.00%');

        // Row 3: Bob
        expect(getRowText(3)).toContain('Bob');
        expect(getRowText(3)).toContain('70.00%');
    });

    it('renders Minimal Mode with correct sorting (Today)', () => {
        (useCollection as any).mockReturnValue({ data: mockOperators, isLoading: false });

        render(<OperatorLeaderboard minimal />);

        // Minimal renders divs, not table.

        expect(screen.getByText('1.')).toBeDefined();
        expect(screen.getByText('Charlie')).toBeDefined();
        expect(screen.getByText('95%')).toBeDefined(); // Minimal uses toFixed(0)

        expect(screen.getByText('2.')).toBeDefined();
        expect(screen.getByText('Alice')).toBeDefined();

        expect(screen.getByText('3.')).toBeDefined();
        expect(screen.getByText('Bob')).toBeDefined();

        // Verify Order in DOM
        const names = screen.getAllByText(/Charlie|Alice|Bob/);
        // Expect order: Charlie, Alice, Bob
        expect(names[0].textContent).toBe('Charlie');
        expect(names[1].textContent).toBe('Alice');
        expect(names[2].textContent).toBe('Bob');
    });

    it('switches to Monthly view and updates sorting', () => {
        (useCollection as any).mockReturnValue({ data: mockOperators, isLoading: false });

        render(<OperatorLeaderboard />);

        // Verify initial (Today)
        expect(screen.getAllByRole('row')[1].textContent).toContain('Charlie'); // 95

        // Switch to Monthly
        fireEvent.click(screen.getByText('This Month'));

        // Monthly Stats (2023-10):
        // Alice: 90
        // Charlie: 80
        // Bob: 75
        // Order: Alice, Charlie, Bob

        const rows = screen.getAllByRole('row');
        expect(rows[1].textContent).toContain('Alice');
        expect(rows[1].textContent).toContain('90.00%');

        expect(rows[2].textContent).toContain('Charlie');
        expect(rows[2].textContent).toContain('80.00%');

        expect(rows[3].textContent).toContain('Bob');
        expect(rows[3].textContent).toContain('75.00%');
    });

    it('handles missing data gracefully', () => {
        const incompleteData = [{
            id: 'op4',
            name: 'Dave',
            role: 'operator',
            efficiency: NaN,
            monthlyStats: null
        }];
        (useCollection as any).mockReturnValue({ data: incompleteData, isLoading: false });

        render(<OperatorLeaderboard />);

        // Should default to 0%
        expect(screen.getByText('0.00%')).toBeDefined();
    });
});
