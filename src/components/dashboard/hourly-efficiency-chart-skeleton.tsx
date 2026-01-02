'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useCollection } from '@/firebase/firestore/use-collection';
import { collection, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { startOfDay } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { ProductionEntry } from '@/lib/types';

const TIME_SLOTS_ORDER = [
    "07:30 - 08:30",
    "08:30 - 09:30",
    "09:30 - 10:15",
    "10:30 - 11:30",
    "11:30 - 12:30",
    "12:30 - 13:00",
    "13:30 - 14:30",
    "14:30 - 15:15",
    "15:30 - 16:30",
    "16:30 - 17:30",
    "17:30 - 18:30",
    "18:30 - 19:30",
    "19:30 - 20:30",
    "20:30 - 21:30",
];

// Helper to extract end time from range for sorting/display
const getEndTime = (range: string) => {
    return range.split(' - ')[1];
};

export function HourlyEfficiencyChart() {
    const today = startOfDay(new Date());

    // Fetch all production logs for today
    const productionQuery = useMemoFirebase(
        () => query(
            collection(firestore, 'production'),
            where('timestamp', '>=', Timestamp.fromDate(today)),
            orderBy('timestamp', 'asc')
        ),
        []
    );
    const { data: productionLogs, isLoading } = useCollection<ProductionEntry>(productionQuery);

    // Fetch active operators count to estimate available minutes? 
    // Ideally, we sum up the 'workedMinutes' from the logs if we trust them.
    // Or we count unique operators per hour.
    // Let's use the logs. Each log *should* have 'workedMinutes' or we derive it from hourlyRange.
    // If 'workedMinutes' is not on the Type yet (I added it to API payload but maybe not Type), we calculate it.

    const chartData = useMemo(() => {
        if (!productionLogs || productionLogs.length === 0) return [];

        // 1. Group by Hourly Range
        const groupedByHour: { [key: string]: { earned: number; worked: number } } = {};

        productionLogs.forEach(entry => {
            const range = entry.hourlyRange;
            if (!groupedByHour[range]) {
                groupedByHour[range] = { earned: 0, worked: 0 };
            }

            // Calculate Earned Minutes for this entry
            // We need the SMV. 
            // PROBLEM: ProductionEntry usually doesn't have SMV on it. 
            // We need to fetch Styles to get SMV.
            // Or we assume 'cumulativeQuantity' * 'smv'.
            // The `update-operator-stats` serves side calculates it.
            // Client side needs access to Styles or we store 'earnedMinutes' on the production entry?
            // Storing 'earnedMinutes' on ProductionEntry would be best for analytics.
            // But right now we don't have it.
            // We must fetch styles.
        });

        // RE-STRATEGY: Fetch Styles too to calculate efficiency client-side.
        // It's expensive but needed if we don't store it.
        // Alternate: Just show "Units Produced" per hour for now?
        // The request is "Hourly Efficiency Trends".
        // I will assume for MVP we fetch styles. Or I can check if I can use a simpler metric.
        // Let's use Units Produced for now and label it "Hourly Output" if Efficiency is too hard,
        // BUT the user asked for Efficiency.

        // Let's defer efficiency calculation to a robust backend job or hook?
        // No, I'll fetch styles. Styles list isn't huge.
        return [];
    }, [productionLogs]);

    // ... Wait, I need styles.
    // Creating component...
    return null;
}
