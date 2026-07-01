import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AISuggestions } from './ai-suggestions';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useCollection } from '@/firebase/firestore/use-collection';
import { getSuggestions } from '@/lib/actions';

// Mock dependencies
vi.mock('@/firebase/firestore/use-collection');
vi.mock('@/lib/actions');
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
    Timestamp: {
        now: () => ({ seconds: 123, nanoseconds: 0 }),
        fromDate: (d: Date) => ({ seconds: d.getTime() / 1000, nanoseconds: 0 })
    }
}));

// Mock Data
const mockProductionEntries = [
    { id: '1', styleId: 'style1', quantity: 50, timestamp: { seconds: 1000, nanoseconds: 0 } }
];

const mockSuggestionsResult = {
    suggestions: [
        "Increase operator efficiency by balanced line.",
        "Reduce machine downtime."
    ],
    reasoning: "Analysis of production data shows bottlenecks."
};

describe('AISuggestions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useCollection as any).mockReturnValue({ data: mockProductionEntries, isLoading: false });
    });

    it('renders the initial state', () => {
        render(<AISuggestions />);
        expect(screen.getByText('AI බලයෙන් ක්‍රියාත්මක යෝජනා')).toBeDefined();
        // Check for the button
        expect(screen.getByText('යෝජනා ජනනය කරන්න')).toBeDefined();
    });

    it('handles loading state during suggestion generation', async () => {
        // Mock AI call to hang or take time if we could, but here we just check state changes
        (getSuggestions as any).mockImplementation(() => new Promise(() => { })); // Never resolves for this test

        render(<AISuggestions />);

        fireEvent.click(screen.getByText('යෝජනා ජනනය කරන්න'));

        await waitFor(() => {
            expect(screen.getByText('AI යෝජනා ජනනය කරමින්... (මෙයට තත්පර 30ක් පමණ ගත විය හැක)')).toBeDefined();
        });
    });

    it('displays suggestions on success', async () => {
        (getSuggestions as any).mockResolvedValue(mockSuggestionsResult);

        render(<AISuggestions />);

        fireEvent.click(screen.getByText('යෝජනා ජනනය කරන්න'));

        await waitFor(() => {
            expect(screen.getByText('යෝජනා:')).toBeDefined();
            expect(screen.getByText('Increase operator efficiency by balanced line.')).toBeDefined();
            expect(screen.getByText('Reduce machine downtime.')).toBeDefined();
            expect(screen.getByText('Analysis of production data shows bottlenecks.')).toBeDefined();
        });
    });

    it('handles errors gracefully', async () => {
        (getSuggestions as any).mockResolvedValue({ error: 'AI Service Failed' });

        render(<AISuggestions />);

        fireEvent.click(screen.getByText('යෝජනා ජනනය කරන්න'));

        await waitFor(() => {
            expect(screen.getByText('දෝෂයක් ඇතිවිය')).toBeDefined();
            expect(screen.getByText('AI Service Failed')).toBeDefined();
        });
    });

    it('handles empty production data', async () => {
        (useCollection as any).mockReturnValue({ data: [], isLoading: false });

        render(<AISuggestions />);
        fireEvent.click(screen.getByText('යෝජනා ජනනය කරන්න'));

        await waitFor(() => {
            expect(screen.getByText('AI සඳහා විශ්ලේෂණය කිරීමට තරම් මෑත කාලීන නිෂ්පාදන දත්ත නොමැත.')).toBeDefined();
        });
    });
});
