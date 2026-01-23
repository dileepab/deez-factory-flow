import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
    // State for Mobile Tooltips
    const [openTooltipId, setOpenTooltipId] = useState<string | null>(null);

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

    // SHIFT CONFIGURATION
    const SHIFT_START_HOUR = 7.5; // 7:30 AM
    const TOTAL_SHIFT_MINUTES = 540; // 9 Hours fixed

    const BREAKS = [
        { name: "Tea", start: 165, end: 180 }, // 10:15 - 10:30 (165m from 7:30)
        { name: "Lunch", start: 330, end: 360 }, // 1:00 - 1:30 (330m from 7:30)
        { name: "Tea", start: 465, end: 480 }  // 3:15 - 3:30 (465m from 7:30)
    ];

    // Helper: Map Working Minutes to Wall Minutes (Start limit)
    const mapWorkStart = (workMin: number) => {
        if (workMin < 165) return workMin;
        if (workMin < 315) return workMin + 15; // + Tea 1
        if (workMin < 420) return workMin + 45; // + Tea 1 + Lunch
        return workMin + 60; // + All
    };

    // Helper: Map Working Minutes to Wall Minutes (End limit)
    const mapWorkEnd = (workMin: number) => {
        if (workMin <= 165) return workMin;
        if (workMin <= 315) return workMin + 15;
        if (workMin <= 420) return workMin + 45;
        return workMin + 60;
    };

    // Helper: Format minutes to H:MM format
    const formatTime = (minutes: number) => {
        const totalMinutes = (SHIFT_START_HOUR * 60) + minutes;
        const h = Math.floor(totalMinutes / 60);
        const m = Math.floor(totalMinutes % 60);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const displayH = h > 12 ? h - 12 : h;
        return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
    };

    // Helper: Split a segment if it crosses a break point
    const splitSegment = (start: number, end: number) => {
        // Work minutes where breaks occur:
        // 10:15 = 165
        // 1:00 = 315 (after 15m break removed from 330)
        // 3:15 = 420 (after 45m breaks removed from 465)
        const breakPoints = [165, 315, 420];

        // Ensure inputs are numbers
        const s = Number(start);
        const e = Number(end);

        let parts: { start: number, end: number }[] = [];
        let current = s;

        for (const bp of breakPoints) {
            // Strictly less than BP means it belongs to previous block
            if (current < bp && e > bp) {
                parts.push({ start: current, end: bp });
                current = bp;
            }
        }

        if (current < e) {
            parts.push({ start: current, end: e });
        }
        return parts;
    };

    // State for View Mode
    const [viewMode, setViewMode] = useState<'horizontal' | 'vertical'>('vertical'); // Default to vertical for operators

    // ... (Helper functions remain same)

    const renderVerticalStream = (user: Operator, segments: any[]) => {
        return (
            <div className="relative py-8 px-4">
                {/* Central Line */}
                <div className="absolute left-[20px] md:left-1/2 top-0 bottom-0 w-0.5 bg-gray-200 -translate-x-1/2" />

                <div className="space-y-8">
                    {segments.map((seg, i) => {
                        if (seg.isGap || seg.name === 'Tea' || seg.name === 'Lunch') {
                            // Small dot for breaks
                            return (
                                <div key={i} className="relative flex items-center justify-center">
                                    <div className="absolute left-[20px] md:left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-slate-300 border-2 border-white z-10" />
                                    <div className="ml-12 md:ml-0 md:absolute md:left-[55%] text-xs text-muted-foreground font-medium italic">
                                        {formatTime(seg.start)} - {seg.name} ({Math.round(seg.end - seg.start)}m)
                                    </div>
                                </div>
                            );
                        }

                        const isLeft = i % 2 === 0;

                        return (
                            <div key={i} className={`relative flex flex-col md:flex-row items-center ${isLeft ? 'md:flex-row-reverse' : ''}`}>
                                {/* Timeline Dot */}
                                <div className="absolute left-[20px] md:left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white z-10 shadow-sm" style={{ backgroundColor: seg.color }} />

                                {/* Time Label (Mobile: Next to dot, Desktop: On line) */}
                                <div className="absolute left-[40px] md:left-1/2 md:-translate-x-1/2 -top-6 md:top-auto text-[10px] font-bold text-muted-foreground bg-white px-1">
                                    {formatTime(seg.start)}
                                </div>

                                {/* Spacer for Mobile Axis */}
                                <div className="w-12 md:w-1/2 shrink-0 md:hidden" />

                                {/* Content Card */}
                                <div className={`w-[calc(100%-3rem)] md:w-[calc(50%-2rem)] ml-auto md:ml-0 p-4 rounded-lg border shadow-sm bg-white hover:shadow-md transition-shadow ${isLeft ? 'md:mr-8' : 'md:ml-8'}`} style={{ borderLeftColor: seg.color, borderLeftWidth: 4 }}>
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className="font-bold text-sm line-clamp-2">{seg.name}</h4>
                                        <span className="text-xs font-mono font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                                            {Math.round(seg.count)} pcs
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                        <div className="flex items-center gap-1">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: seg.color }} />
                                            <span>{Math.round(seg.end - seg.start)} mins</span>
                                        </div>
                                        <div className="font-mono">
                                            {formatTime(seg.start)} - {formatTime(seg.end)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <TooltipProvider delayDuration={100}>
            <Card className="w-full mt-6 bg-white">
                <CardHeader className="px-2 md:px-6 flex flex-row items-center justify-between space-y-0 pb-4">
                    <div className="space-y-1">
                        <CardTitle>Daily Schedule</CardTitle>
                        <CardDescription>Visual breakdown of operator activities.</CardDescription>
                    </div>
                    <div className="flex items-center p-1 bg-muted rounded-lg">
                        <button
                            onClick={() => setViewMode('vertical')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'vertical' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Stream
                        </button>
                        <button
                            onClick={() => setViewMode('horizontal')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'horizontal' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Timeline
                        </button>
                    </div>
                </CardHeader>
                <CardContent className="px-2 md:px-6">
                    {viewMode === 'vertical' ? (
                        <>
                            {assignedOperators.map(user => {
                                let segments: any[] = [];
                                // ... (Reuse data prep logic, assume it's refactored or copied. Ideally we refactor data prep out, but for now copying the prep logic inside or above is safer to ensure it works)
                                // RE-RUNNING DATA PREP FOR VERTICAL MODE (Should ideally be useMemo'd common data)
                                if (schedule && schedule[user.id]) {
                                    const rawEvents = schedule[user.id];
                                    const mergedEvents: typeof rawEvents = [];
                                    if (rawEvents.length > 0) {
                                        let current = { ...rawEvents[0] };
                                        for (let i = 1; i < rawEvents.length; i++) {
                                            const next = rawEvents[i];
                                            const gap = next.start - current.end;
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

                                    // Flatten breaks and tasks into one sorted list
                                    let allItems: any[] = [];

                                    // 1. Tasks
                                    mergedEvents.forEach(ev => {
                                        const { op, isNext } = getOpDetails(ev.opId);
                                        if (op) {
                                            const baseIdx = selectedStyle.operations.findIndex(o => o.id === op.id);
                                            let colorIndex = baseIdx;
                                            if (isNext && selectedNextStyle) {
                                                const nextIdx = selectedNextStyle.operations.findIndex(o => o.id === op.id);
                                                colorIndex = (nextIdx >= 0 ? nextIdx : 0) + 5;
                                            }
                                            const color = OP_COLORS[Math.abs(colorIndex) % OP_COLORS.length];
                                            const start = mapWorkStart(ev.start);
                                            const end = mapWorkEnd(ev.end);

                                            // Don't split for vertical view, just show the block (simpler) or split if it spans breaks?
                                            // Let's split to be accurate with breaks
                                            const parts = splitSegment(ev.start, ev.end);
                                            parts.forEach(part => {
                                                const cwStart = mapWorkStart(part.start);
                                                const cwEnd = mapWorkEnd(part.end);
                                                const totalDur = ev.end - ev.start;
                                                const partDur = part.end - part.start;
                                                const partCount = (partDur / totalDur) * ev.count;

                                                allItems.push({
                                                    type: 'task',
                                                    color,
                                                    name: op.name,
                                                    count: partCount,
                                                    start: cwStart,
                                                    end: cwEnd,
                                                    isGap: false
                                                });
                                            });
                                        }
                                    });

                                    // 2. Breaks
                                    BREAKS.forEach(b => {
                                        allItems.push({
                                            type: 'break',
                                            color: '#cbd5e1',
                                            name: b.name,
                                            count: 0,
                                            start: b.start,
                                            end: b.end, // Breaks are already in wall time in the constants? 
                                            // Wait, constants line 55: 165, 330. These are work minutes or wall minutes?
                                            // "10:15 - 10:30 (165m from 7:30)" -> 165m is 2h 45m. 7:30 + 2:45 = 10:15.
                                            // So constants are Wall Minutes from Start.
                                            // My mapWorkStart assumes input is Work Minutes.
                                            isGap: false
                                        });
                                    });

                                    // Sort by start time
                                    allItems.sort((a, b) => a.start - b.start);
                                    segments = allItems;
                                }

                                return (
                                    <div key={user.id}>
                                        {assignedOperators.length > 1 && <h3 className="font-bold mb-4">{user.name}</h3>}
                                        {renderVerticalStream(user, segments)}
                                    </div>
                                )
                            })}
                        </>
                    ) : (
                        /* Horizontal Scroll Wrapper for Mobile (Existing Code) */
                        <div className="w-full overflow-x-auto pb-4">
                            {/* ... Existing Horizontal Implementation ... */}
                            <div className="min-w-[800px] md:min-w-0 space-y-6 relative">
                                {/* ... [Keep existing content] ... */}
                                {/* Break Overlays */}
                                <div className="absolute inset-0 pointer-events-none z-20 ml-0 md:ml-[120px] h-full">
                                    {BREAKS.map((b, i) => (
                                        <div
                                            key={i}
                                            className="absolute top-0 bottom-0 bg-white/80 border-x border-dashed border-gray-300 flex items-center justify-center group/break"
                                            style={{
                                                left: `${(b.start / TOTAL_SHIFT_MINUTES) * 100}%`,
                                                width: `${((b.end - b.start) / TOTAL_SHIFT_MINUTES) * 100}%`
                                            }}
                                        >
                                            <span className="text-[10px] font-bold text-gray-500 rotate-0 md:-rotate-90 transform origin-center whitespace-nowrap opacity-70">{b.name}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Time Ruler */}
                                <div className="flex flex-col md:flex-row w-full mb-2 relative z-10">
                                    <div className="hidden md:block w-[120px] pr-4 shrink-0" />
                                    <div className="flex-1 relative h-6 text-xs text-muted-foreground border-b border-gray-200">
                                        <div className="absolute top-0 h-full border-l pl-1 border-gray-300" style={{ left: '0%' }}>7:30</div>
                                        {Array.from({ length: 9 }).map((_, i) => {
                                            const tickTime = 30 + (i * 60);
                                            if (tickTime >= TOTAL_SHIFT_MINUTES) return null;
                                            return (
                                                <div
                                                    key={i}
                                                    className="absolute top-0 h-full border-l pl-1 border-gray-300"
                                                    style={{ left: `${(tickTime / TOTAL_SHIFT_MINUTES) * 100}%` }}
                                                >
                                                    {Math.floor(SHIFT_START_HOUR + (tickTime / 60) + (Math.floor(SHIFT_START_HOUR + (tickTime / 60)) >= 13 ? -12 : 0))}
                                                </div>
                                            )
                                        })}
                                        <div className="absolute top-0 h-full border-l pl-1 border-gray-300" style={{ left: '100%' }}>4:30</div>
                                    </div>
                                </div>

                                {assignedOperators.map(user => {
                                    let segments: { color: string, name: string, count: number, start: number, end: number, isGap: boolean }[] = [];

                                    if (schedule && schedule[user.id]) {
                                        const rawEvents = schedule[user.id];
                                        const mergedEvents: typeof rawEvents = [];

                                        if (rawEvents.length > 0) {
                                            let current = { ...rawEvents[0] };
                                            for (let i = 1; i < rawEvents.length; i++) {
                                                const next = rawEvents[i];
                                                const gap = next.start - current.end;
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

                                        let cursor = 0;
                                        mergedEvents.forEach(ev => {
                                            const { op, isNext } = getOpDetails(ev.opId);
                                            if (op) {
                                                const baseIdx = selectedStyle.operations.findIndex(o => o.id === op.id);
                                                let colorIndex = baseIdx;
                                                if (isNext && selectedNextStyle) {
                                                    const nextIdx = selectedNextStyle.operations.findIndex(o => o.id === op.id);
                                                    colorIndex = (nextIdx >= 0 ? nextIdx : 0) + 5;
                                                }
                                                const color = OP_COLORS[Math.abs(colorIndex) % OP_COLORS.length];
                                                const parts = splitSegment(ev.start, ev.end);
                                                parts.forEach(part => {
                                                    const wallStart = mapWorkStart(part.start);
                                                    const wallEnd = mapWorkEnd(part.end);
                                                    const totalDur = ev.end - ev.start;
                                                    const partDur = part.end - part.start;
                                                    const partCount = (partDur / totalDur) * ev.count;
                                                    segments.push({ color, name: op.name, count: partCount, start: wallStart, end: wallEnd, isGap: false });
                                                });
                                            }
                                            cursor = Math.max(cursor, ev.end);
                                        });

                                        BREAKS.forEach(b => {
                                            segments.push({ color: '#cbd5e1', name: b.name, count: 1, start: b.start, end: b.end, isGap: false });
                                        });
                                    }

                                    const totalPcs = Math.floor(segments.filter(s => s.name !== 'Tea' && s.name !== 'Lunch').reduce((acc, s) => acc + (s.count || 0), 0));

                                    return (
                                        <div key={user.id} className="flex flex-col md:flex-row md:items-center group mb-4">
                                            <div className="w-full md:w-[120px] pr-0 md:pr-4 text-left md:text-right mb-1 md:mb-0 flex flex-row md:flex-col justify-between md:justify-center items-center md:items-end">
                                                <div className="text-sm font-medium truncate" title={user.name}>{user.name}</div>
                                                <div className="text-[10px] text-muted-foreground font-mono">{totalPcs} pcs</div>
                                            </div>

                                            <div className="w-full md:flex-1 h-[32px] bg-muted/30 rounded-md overflow-hidden relative">
                                                {segments.map((seg, i) => {
                                                    const segmentKey = `${user.id}-${i}`;
                                                    const isOpen = openTooltipId === segmentKey;
                                                    return (
                                                        <Tooltip key={i} open={isOpen} onOpenChange={(open) => setOpenTooltipId(open ? segmentKey : null)}>
                                                            <TooltipTrigger asChild>
                                                                <div onClick={() => setOpenTooltipId(isOpen ? null : segmentKey)}
                                                                    className="absolute top-0 bottom-0 border-r border-white/20 hover:brightness-110 transition-all cursor-pointer box-border flex items-center justify-center text-[10px] text-white font-bold shadow-sm"
                                                                    style={{ left: `${(seg.start / TOTAL_SHIFT_MINUTES) * 100}%`, width: `${((seg.end - seg.start) / TOTAL_SHIFT_MINUTES) * 100}%`, backgroundColor: seg.color }}>
                                                                    {(seg.end - seg.start) > 10 && Math.round(seg.count)}
                                                                </div>
                                                            </TooltipTrigger>
                                                            <TooltipContent className="text-xs !bg-white !text-slate-900 border border-slate-200 shadow-md p-2 z-50">
                                                                <div className="font-bold mb-1">{seg.name}</div>
                                                                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 opacity-90">
                                                                    <span>Count:</span> <span className="font-mono font-bold">{Math.round(seg.count)}</span>
                                                                    <span>Start:</span> <span className="font-mono">{formatTime(seg.start)}</span>
                                                                    <span>End:</span> <span className="font-mono">{formatTime(seg.end)}</span>
                                                                    <span>Duration:</span> <span className="font-mono">{Math.round(seg.end - seg.start)}m</span>
                                                                </div>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    );
                                                })}
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
                        </div>
                    )}
                </CardContent>
            </Card>
        </TooltipProvider>
    );
}
