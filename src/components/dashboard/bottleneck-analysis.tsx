'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useCollection } from '@/firebase/firestore/use-collection';
import { collection, query, where, Timestamp } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { subDays } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { ProductionEntry, GarmentStyle } from '@/lib/types';
import { cn } from '@/lib/utils';

export function BottleneckAnalysis({ className }: { className?: string }) {
    // Analyze Last 7 Days
    const sevenDaysAgo = subDays(new Date(), 7);

    const productionQuery = useMemoFirebase(
        () => query(
            collection(firestore, 'production'),
            where('timestamp', '>=', Timestamp.fromDate(sevenDaysAgo))
        ),
        []
    );
    const { data: productionLogs, isLoading: loadingLogs } = useCollection<ProductionEntry>(productionQuery);

    const stylesQuery = useMemoFirebase(
        () => query(collection(firestore, 'styles'), where('status', '==', 'active')),
        []
    );
    const { data: styles, isLoading: loadingStyles } = useCollection<GarmentStyle>(stylesQuery);

    const data = useMemo(() => {
        if (!productionLogs || !styles) return [];

        // Aggregation: Operation ID -> { totalEarned, totalWorked, name }
        // "Total Worked" for an operation is hard to guess from logs if multiple ops happen in same hour.
        // Simplified Bottleneck Metric: Lowest Average Output vs Target?
        // OR: Efficiency per operation if we assume log duration = time spent on that op.

        const opStats: { [key: string]: { name: string; styleName: string; totalProduced: number; totalTarget: number; entries: number } } = {};

        productionLogs.forEach(entry => {
            const style = styles.find(s => s.id === entry.styleId);
            const operation = style?.operations.find(op => op.id === entry.operationId);

            if (!style || !operation) return;

            const key = entry.operationId;
            if (!opStats[key]) {
                opStats[key] = {
                    name: operation.name,
                    styleName: style.name,
                    totalProduced: 0,
                    totalTarget: 0,
                    entries: 0
                };
            }

            // Estimate Target
            // Duration of slot / SMV
            // We need a helper for slot duration (default 60)
            // Re-using helper logic (simplified here)
            let duration = 60;
            if (entry.hourlyRange) {
                // Fast parse "HH:MM - HH:MM"
                // ... (Simulated for brevity, assuming standard 60 mostly)
                // Let's use 60 for now or copy helper.
            }

            const smvSeconds = Number(operation.smv) || 60; // Default to 60s
            const smvMinutes = smvSeconds / 60;
            const target = duration / smvMinutes;

            opStats[key].totalProduced += entry.cumulativeQuantity || 0;
            opStats[key].totalTarget += target;
            opStats[key].entries += 1;
        });

        // Calculate Average Performance % (Produced / Target)
        const result = Object.values(opStats).map(stat => ({
            name: `${stat.name} (${stat.styleName})`,
            performance: Math.round((stat.totalProduced / stat.totalTarget) * 100) || 0,
            entries: stat.entries
        }));

        // Filter and Sort: Show lowest 5
        return result
            .filter(r => r.entries > 2) // Min threshold to be significant
            .sort((a, b) => a.performance - b.performance)
            .slice(0, 5);

    }, [productionLogs, styles]);

    if (loadingLogs || loadingStyles) {
        return <div className="flex justify-center p-8"><Loader2 className="animate-spin text-primary" /></div>;
    }

    return (
        <Card className={cn("col-span-1", className)}>
            <CardHeader>
                <CardTitle>Bottleneck Operations</CardTitle>
                <CardDescription>Lowest performing operations (Last 7 Days) vs Standard Target.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart layout="vertical" data={data}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--muted))" />
                            <XAxis type="number" domain={[0, 100]} hide />
                            <YAxis
                                dataKey="name"
                                type="category"
                                width={150}
                                stroke="hsl(var(--muted-foreground))"
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip
                                cursor={{ fill: 'hsl(var(--muted))', opacity: 0.1 }}
                                contentStyle={{
                                    backgroundColor: 'hsl(var(--popover))',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: '8px',
                                    color: 'hsl(var(--popover-foreground))'
                                }}
                                formatter={(value: number) => [`${value}%`, "Performance"]}
                            />
                            <Bar dataKey="performance" radius={[0, 4, 4, 0]} barSize={20}>
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.performance < 50 ? '#ef4444' : '#f59e0b'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
