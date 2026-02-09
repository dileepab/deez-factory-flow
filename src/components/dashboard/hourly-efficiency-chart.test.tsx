import { render, screen } from '@testing-library/react';
import { HourlyEfficiencyChart } from './hourly-efficiency-chart';
import { vi, describe, it, expect, beforeEach } from 'vitest';
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
    orderBy: vi.fn(),
    Timestamp: {
        fromDate: (date: Date) => ({ toDate: () => date }),
        now: () => ({ toDate: () => new Date() })
    }
}));

// Mock Recharts (Canvas/SVG issues in JSDOM)
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
    LineChart: ({ data, children }: any) => (
        <div data-testid="line-chart" data-chart-data={JSON.stringify(data)}>
            {children}
        </div>
    ),
    Line: () => <div data-testid="line" />,
    XAxis: () => <div data-testid="xaxis" />,
    YAxis: () => <div data-testid="yaxis" />,
    CartesianGrid: () => <div data-testid="grid" />,
    Tooltip: () => <div data-testid="tooltip" />,
    Legend: () => <div data-testid="legend" />,
}));

// Mock UI Components
vi.mock('@/components/ui/card', () => ({
    Card: ({ children, className }: any) => <div className={className}>{children}</div>,
    CardHeader: ({ children }: any) => <div>{children}</div>,
    CardTitle: ({ children }: any) => <div>{children}</div>,
    CardDescription: ({ children }: any) => <div>{children}</div>,
    CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
    Loader2: () => <div data-testid="loader">Loading...</div>
}));

// Mock Data
const mockStyles = [
    {
        id: 'style1',
        name: 'Style A',
        operations: [
            { id: 'op1', name: 'Op 1', smv: 600 } // 600 seconds = 10 minutes
        ]
    }
];

const mockLogs = [
    // Slot: 07:30 - 08:30 (60 mins)
    // Operator 1 working on Style A, Op 1.
    // Produced 6 pcs.
    // Earned: 6 * 10 = 60 mins.
    // Available: 1 Op * 60 = 60 mins.
    // Efficiency: 100%.
    {
        id: 'log1',
        operatorId: 'user1',
        styleId: 'style1',
        operationId: 'op1',
        hourlyRange: '07:30 - 08:30',
        cumulativeQuantity: 6,
        timestamp: { seconds: 1000 }
    },
    // Slot: 08:30 - 09:30 (60 mins)
    // Operator 1 and Operator 2 working.
    // Op 1: 3 pcs (30 earned).
    // Op 2: 3 pcs (30 earned).
    // Total Earned: 60 mins.
    // Available: 2 Ops * 60 = 120 mins.
    // Efficiency: 50%.
    {
        id: 'log2',
        operatorId: 'user1',
        styleId: 'style1',
        operationId: 'op1',
        hourlyRange: '08:30 - 09:30',
        cumulativeQuantity: 3,
        timestamp: { seconds: 2000 }
    },
    {
        id: 'log3',
        operatorId: 'user2',
        styleId: 'style1',
        operationId: 'op1',
        hourlyRange: '08:30 - 09:30',
        cumulativeQuantity: 3,
        timestamp: { seconds: 2000 }
    }
];

describe('HourlyEfficiencyChart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state', () => {
        (useCollection as any).mockReturnValue({ data: null, isLoading: true });
        render(<HourlyEfficiencyChart />);
        expect(screen.getByTestId('loader')).toBeDefined();
    });

    it('renders chart with correct efficiency calculations', () => {
        // Mock UseCollection Sequence:
        // 1st call: Production Logs
        // 2nd call: Styles
        (useCollection as any)
            .mockReturnValueOnce({ data: mockLogs, isLoading: false }) // Logs
            .mockReturnValueOnce({ data: mockStyles, isLoading: false }); // Styles

        render(<HourlyEfficiencyChart />);

        const chart = screen.getByTestId('line-chart');
        const data = JSON.parse(chart.getAttribute('data-chart-data') || '[]');

        // Check 07:30 - 08:30 data (End time: 08:30)
        // Range string in component is "07:30 - 08:30", split[1] is "08:30"
        const slot1 = data.find((d: any) => d.range === '07:30 - 08:30');
        expect(slot1).toBeDefined();
        expect(slot1.efficiency).toBe(100);

        // Check 08:30 - 09:30 data
        const slot2 = data.find((d: any) => d.range === '08:30 - 09:30');
        expect(slot2).toBeDefined();
        expect(slot2.efficiency).toBe(50);
    });

    it('handles missing/zero SMV gracefully', () => {
        // Log pointing to non-existent style/op
        const badLogs = [{
            id: 'logBad',
            operatorId: 'user1',
            styleId: 'missing',
            operationId: 'missing',
            hourlyRange: '07:30 - 08:30',
            cumulativeQuantity: 10
        }];

        (useCollection as any)
            .mockReturnValueOnce({ data: badLogs, isLoading: false })
            .mockReturnValueOnce({ data: mockStyles, isLoading: false });

        render(<HourlyEfficiencyChart />);

        const chart = screen.getByTestId('line-chart');
        const data = JSON.parse(chart.getAttribute('data-chart-data') || '[]');

        const slot = data.find((d: any) => d.range === '07:30 - 08:30');
        // Earned: 0 (undefined SMV -> 0). Worked: 60 (1 op). Eff: 0.
        expect(slot.efficiency).toBe(0);
    });

    it('handles empty data', () => {
        (useCollection as any)
            .mockReturnValueOnce({ data: [], isLoading: false })
            .mockReturnValueOnce({ data: [], isLoading: false });

        render(<HourlyEfficiencyChart />);
        // Should render chart with 0s
        const chart = screen.getByTestId('line-chart');
        expect(chart).toBeDefined();

        const data = JSON.parse(chart.getAttribute('data-chart-data') || '[]');
        expect(data.length).toBeGreaterThan(0); // Should have entries for time slots
        expect(data[0].efficiency).toBe(0);
    });
});
