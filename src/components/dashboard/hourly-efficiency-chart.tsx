'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useCollection } from '@/firebase/firestore/use-collection';
import { collection, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { startOfDay } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { ProductionEntry, GarmentStyle } from '@/lib/types';
import { cn } from '@/lib/utils';

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

const getDurationInMinutes = (range: string): number => {
    if (!range) return 60; // Default
    try {
        const [start, end] = range.split(' - ');
        const [startH, startM] = start.split(':').map(Number);
        const [endH, endM] = end.split(':').map(Number);
        const startDate = new Date(0, 0, 0, startH, startM, 0);
        const endDate = new Date(0, 0, 0, endH, endM, 0);
        return (endDate.getTime() - startDate.getTime()) / (1000 * 60);
    } catch (e) {
        return 60;
    }
};

export function HourlyEfficiencyChart({ className }: { className?: string }) {
    const today = startOfDay(new Date());

    const productionQuery = useMemoFirebase(
        () => query(
            collection(firestore, 'production'),
            where('timestamp', '>=', Timestamp.fromDate(today))
        ),
        []
    );
    const { data: productionLogs, isLoading: loadingLogs } = useCollection<ProductionEntry>(productionQuery);

    const stylesQuery = useMemoFirebase(
        () => query(collection(firestore, 'styles'), where('status', '==', 'active')),
        []
    );
    const { data: styles, isLoading: loadingStyles } = useCollection<GarmentStyle>(stylesQuery);

    const chartData = useMemo(() => {
        if (!productionLogs || !styles) return [];

        const groupedByHour: { [key: string]: { earned: number; worked: number } } = {};

        // Initialize all slots to 0 ensure continuity in chart
        TIME_SLOTS_ORDER.forEach(slot => {
            groupedByHour[slot] = { earned: 0, worked: 0 };
        });

        productionLogs.forEach(entry => {
            const range = entry.hourlyRange;
            if (!range || !groupedByHour[range]) return;

            // Find SMV
            const style = styles.find(s => s.id === entry.styleId);
            const operation = style?.operations.find(op => op.id === entry.operationId);
            const smv = operation?.smv || 0;

            const produced = entry.cumulativeQuantity || 0;
            const earned = produced * smv;

            // Worked minutes
            // If this is the first entry for this operator in this hour, we add the slot duration
            // But determining strict "worked minutes" from detached logs is hard.
            // Approximation: 
            // We can assume if an operator logged ANYTHING in this slot, they worked the full slot.
            // So we sum (Unique Operators in Slot) * (Slot Duration in Mins) = Total Available Minutes
        });

        // Second pass: Calculate worked minutes per hour based on unique operators
        TIME_SLOTS_ORDER.forEach(slot => {
            const logsInSlot = productionLogs.filter(p => p.hourlyRange === slot);
            const uniqueOperators = new Set(logsInSlot.map(p => p.operatorId)).size;
            const duration = getDurationInMinutes(slot);
            groupedByHour[slot].worked = uniqueOperators * duration;

            // Calculate earned
            logsInSlot.forEach(entry => {
                const style = styles.find(s => s.id === entry.styleId);
                const operation = style?.operations.find(op => op.id === entry.operationId);

                // SMV is in seconds, convert to minutes
                const smvSeconds = Number(operation?.smv) || 0;
                const smvMinutes = smvSeconds / 60;

                groupedByHour[slot].earned += (entry.cumulativeQuantity || 0) * smvMinutes;
            });
        });

        return TIME_SLOTS_ORDER.map(slot => {
            const data = groupedByHour[slot];
            const efficiency = data.worked > 0 ? (data.earned / data.worked) * 100 : 0;
            // Only return data if there was activity (worked > 0) or if it's earlier than current time?
            // For now, return all, but maybe filter out future slots if 0?
            return {
                time: slot.split(' - ')[1], // Display End Time
                efficiency: Math.round(efficiency),
                range: slot
            };
        }).filter(item => {
            // Filter out slots with 0 efficiency if they mark future? 
            // Or keep them to show drop? 
            // Let's keep them if they are non-zero or if previous was non-zero?
            // Simple: Just return all, let the chart handle 0s.
            return true;
        });

    }, [productionLogs, styles]);

    if (loadingLogs || loadingStyles) {
        return <div className="flex justify-center p-8"><Loader2 className="animate-spin text-primary" /></div>;
    }

    return (
        <Card className={cn("col-span-1", className)}>
            <CardHeader>
                <CardTitle>Today's Efficiency Trend</CardTitle>
                <CardDescription>Hourly floor efficiency based on production entries.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
                            <XAxis
                                dataKey="time"
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                            />
                            <YAxis
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(value) => `${value}%`}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: 'hsl(var(--popover))',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: '8px',
                                    color: 'hsl(var(--popover-foreground))'
                                }}
                                formatter={(value: number) => [`${value}%`, "Efficiency"]}
                            />
                            <Legend />
                            <Line
                                type="monotone"
                                dataKey="efficiency"
                                stroke="hsl(var(--primary))"
                                strokeWidth={3}
                                activeDot={{ r: 8 }}
                                dot={{ r: 4 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
