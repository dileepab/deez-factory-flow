
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { GarmentStyle, Operator } from '@/lib/types';

interface Assignment {
    operationId: string;
    operatorIds: string[];
}

interface DailyTimelineProps {
    assignedOperators: Operator[];
    assignments: Assignment[];
    selectedStyle: GarmentStyle;
    selectedNextStyle?: GarmentStyle; // Support Next Style
    flowMetrics: Record<string, any>;
    availableMinutes: number;
    schedule?: Record<string, { start: number, end: number, opId: string, count: number }[]>;
}

export function DailyTimeline({ assignedOperators, assignments, selectedStyle, selectedNextStyle, flowMetrics, availableMinutes, schedule }: DailyTimelineProps) {
    // Colors for operations to distinguish them (Hex for reliability)
    const OP_COLORS = [
        "#3b82f6", // Blue
        "#22c55e", // Green
        "#a855f7", // Purple
        "#f59e0b", // Amber
        "#ec4899", // Pink
        "#6366f1", // Indigo
        "#06b6d4", // Cyan
        "#f43f5e", // Rose
        "#14b8a6", // Teal
        "#f97316"  // Orange
    ];

    // Helper to get Op details from EITHER style
    const getOpDetails = (opId: string) => {
        let op = selectedStyle.operations.find(o => o.id === opId);
        let isNext = false;
        if (!op && selectedNextStyle) {
            op = selectedNextStyle.operations.find(o => o.id === opId);
            isNext = true;
        }
        return { op, isNext };
    };

    return (
        <Card className="w-full mt-6">
            <CardHeader>
                <CardTitle>Daily Schedule Timeline</CardTitle>
                <CardDescription>Visual breakdown of operator activities across the {availableMinutes / 60}h shift.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-6">
                    {/* Time Ruler */}
                    <div className="flex w-full ml-0 md:ml-[120px] text-xs text-muted-foreground border-b pb-2">
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(h => (
                            <div key={h} className="flex-1 border-l pl-1 h-3 border-gray-300">
                                {h}h
                            </div>
                        ))}
                    </div>

                    {assignedOperators.map(user => {
                        let segments: { width: number, color: string, name: string, count: number, start?: number }[] = [];

                        if (schedule && schedule[user.id]) {
                            // Use Simulated Schedule with Smoothing
                            const rawEvents = schedule[user.id];
                            const mergedEvents: typeof rawEvents = [];

                            if (rawEvents.length > 0) {
                                let current = { ...rawEvents[0] };
                                for (let i = 1; i < rawEvents.length; i++) {
                                    const next = rawEvents[i];
                                    const gap = next.start - current.end;
                                    // Merge if same Op AND gap is small (< 15 mins)
                                    if (next.opId === current.opId && gap < 15) {
                                        current.end = next.end;
                                        current.count += next.count;
                                    } else {
                                        mergedEvents.push(current);
                                        current = { ...next };
                                    }
                                }
                                mergedEvents.push(current);
                            }

                            // Render Merged Events
                            let cursor = 0;
                            mergedEvents.forEach(ev => {
                                // Gap
                                if (ev.start > cursor) {
                                    const gap = ev.start - cursor;
                                    if (gap > 0.5) {
                                        segments.push({ width: (gap / availableMinutes) * 100, color: 'transparent', name: 'Wait', count: 0 });
                                    }
                                }

                                // Block
                                const { op, isNext } = getOpDetails(ev.opId);
                                if (op) {
                                    const baseIdx = selectedStyle.operations.findIndex(o => o.id === op.id);
                                    let colorIndex = baseIdx;

                                    if (isNext && selectedNextStyle) {
                                        const nextIdx = selectedNextStyle.operations.findIndex(o => o.id === op.id);
                                        colorIndex = (nextIdx >= 0 ? nextIdx : 0) + 5;
                                    }

                                    const color = OP_COLORS[Math.abs(colorIndex) % OP_COLORS.length];
                                    const actualStart = Math.max(ev.start, cursor);
                                    const dur = ev.end - actualStart;
                                    if (dur > 0) {
                                        segments.push({ width: (dur / availableMinutes) * 100, color, name: op.name, count: ev.count });
                                    }
                                }
                                cursor = Math.max(cursor, ev.end);
                            });

                            // Tail Gap
                            if (cursor < availableMinutes) {
                                const gap = availableMinutes - cursor;
                                segments.push({ width: (gap / availableMinutes) * 100, color: 'transparent', name: 'Wait', count: 0 });
                            }
                        } else {
                            segments.push({ width: 100, color: '#e5e7eb', name: 'No Schedule', count: 0 });
                        }

                        const totalPcs = Math.floor(segments.reduce((acc, s) => acc + (s.count || 0), 0));

                        return (
                            <div key={user.id} className="flex flex-col md:flex-row md:items-center group">
                                {/* Name Label */}
                                <div className="w-full md:w-[120px] pr-0 md:pr-4 text-left md:text-right mb-1 md:mb-0 flex flex-row md:flex-col justify-between md:justify-center items-center md:items-end">
                                    <div className="text-sm font-medium truncate" title={user.name}>{user.name}</div>
                                    <div className="text-[10px] text-muted-foreground font-mono">{totalPcs} pcs</div>
                                </div>

                                {/* Bar Track */}
                                <div className="flex-1 h-8 bg-muted/30 rounded-md overflow-hidden flex relative w-full">
                                    {segments.map((seg, i) => (
                                        <div
                                            key={i}
                                            className="h-8 border-r border-white/20 last:border-0 hover:brightness-110 transition-all cursor-pointer box-border flex items-center justify-center text-[10px] text-white font-bold shadow-sm"
                                            style={{ width: `${seg.width}%`, backgroundColor: seg.color }}
                                            title={`${seg.name}: ${Math.round(seg.count)} pcs`}
                                        >
                                            {/* Only show count if wide enough (>6%) */}
                                            {seg.width > 3 && Math.round(seg.count)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}

                    {/* Legend - Primary Style */}
                    <div className="flex flex-wrap gap-4 mt-4 ml-0 md:ml-[120px]">
                        <span className="text-xs font-bold mr-2 text-muted-foreground">Current:</span>
                        {selectedStyle.operations.map((op, i) => (
                            <div key={op.id} className="flex items-center gap-2 text-xs">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: OP_COLORS[i % OP_COLORS.length] }} />
                                <span>{op.name}</span>
                            </div>
                        ))}
                    </div>
                    {/* Legend - Next Style */}
                    {selectedNextStyle && (
                        <div className="flex flex-wrap gap-4 mt-2 ml-0 md:ml-[120px]">
                            <span className="text-xs font-bold mr-2 text-muted-foreground">Next:</span>
                            {selectedNextStyle.operations.map((op, i) => (
                                <div key={op.id} className="flex items-center gap-2 text-xs">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: OP_COLORS[(i + 5) % OP_COLORS.length] }} />
                                    <span>{op.name}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
