import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { GarmentStyle, Operator, ProductionEntry } from '@/lib/types';
import { format } from "date-fns";
import { QuickLogModal } from "./quick-log-modal";
import { useAuth } from "@/auth-provider";
import { Plus, Check } from "lucide-react";

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
    schedule?: Record<string, { start: number, end: number, opId: string, count: number, completed?: boolean }[]>;
    productionLogs?: ProductionEntry[]; // Optional logs
    switchDelay?: number;
}

export function DailyTimeline({ assignedOperators, assignments, selectedStyle, selectedNextStyle, flowMetrics, availableMinutes, schedule, productionLogs = [], switchDelay = 0 }: DailyTimelineProps) {
    const { user } = useAuth();
    // State for Mobile Tooltips
    const [openTooltipId, setOpenTooltipId] = useState<string | null>(null);

    // Calculate Max Production Time
    let productionEndTime = 0;
    if (schedule) {
        Object.values(schedule).forEach(events => {
            events.forEach(e => {
                if (e.end > productionEndTime) productionEndTime = e.end;
            });
        });
    }

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
    // Dynamic Shift Duration: Base 540 (9h) but expand if availableMinutes (work time) + Breaks > 540
    // Standard: 480 work + 60 break = 540.
    // OT: 480 + 120 OT = 600 work. Total = 600 + 60 break = 660.
    const BREAK_DURATION = 60;
    const TOTAL_SHIFT_MINUTES = Math.max(540, availableMinutes + BREAK_DURATION);

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

    // State for View Mode and Quick Log
    const [viewMode, setViewMode] = useState<'horizontal' | 'vertical'>('vertical');
    const [quickLogOpen, setQuickLogOpen] = useState(false);
    const [selectedLogSegment, setSelectedLogSegment] = useState<any>(null);
    const [selectedLogOpId, setSelectedLogOpId] = useState<string>("");
    const [selectedLogStyleId, setSelectedLogStyleId] = useState<string>("");

    // ... (Helper functions remain same)

    const renderVerticalStream = (user: Operator, segments: any[]) => {
        return (
            <div className="relative py-8 px-4">
                {/* Central Line */}
                <div className="absolute left-[20px] md:left-1/2 top-0 bottom-0 w-0.5 bg-gray-200 -translate-x-1/2" />

                <div className="space-y-8">
                    {segments.map((seg, i) => {
                        if (seg.isGap || seg.name === 'Tea' || seg.name === 'Lunch') {
                            // Centered Pill Badge for Breaks
                            return (
                                <div key={i} className="relative flex items-center justify-center py-2 z-10">
                                    <div className="ml-10 md:ml-0 bg-slate-100 text-slate-500 text-[10px] uppercase tracking-wider font-bold px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                                        {seg.name} • {Math.round(seg.end - seg.start)}m
                                    </div>
                                </div>
                            );
                        }

                        const isLeft = i % 2 === 0;

                        // Check if completed
                        // We replicate QuickLogModal logic to find matching range text? 
                        // Or match by start/end/opId properties? 
                        // Unfortunately logs store "07:30 - 08:30" string.
                        // We must format segment start/end to string to match.

                        // Copy logic from QuickLogModal fix (add 450 offset)
                        const SHIFT_OFFSET = 450;
                        const formatM = (minutesFromShiftStart: number) => {
                            const totalM = minutesFromShiftStart + SHIFT_OFFSET;
                            const h = Math.floor(totalM / 60);
                            const m = Math.floor(totalM % 60);
                            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                        };
                        const segmentRangeStr = `${formatM(seg.start)} - ${formatM(seg.end)}`;

                        // ROBUST DISABLE: Check 'completed' flag from DB first
                        const isCompletedFlag = seg.completed === true;

                        const isLogFound = productionLogs.some(log =>
                            log.operatorId === user.id &&
                            String(log.operationId) === String(seg.opId) &&
                            log.hourlyRange === segmentRangeStr
                        );

                        const isCompletedByUser = isCompletedFlag || isLogFound;

                        return (
                            <div key={i} className={`relative flex flex-col md:flex-row items-center ${isLeft ? 'md:flex-row-reverse' : ''} group`}>
                                {/* Timeline Dot - Becomes Checkmark if done? No, keep it as anchor */}
                                <div
                                    className={`absolute left-[20px] md:left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white z-10 shadow-sm transition-all duration-300 ${isCompletedByUser ? 'scale-125 ring-2 ring-emerald-100' : 'group-hover:scale-125'
                                        }`}
                                    style={{ backgroundColor: isCompletedByUser ? '#10b981' : seg.color }}
                                />

                                {/* Time Label */}
                                <div className={`absolute left-[40px] md:left-1/2 -top-6 md:top-auto md:-translate-y-px text-[10px] font-mono font-medium text-slate-400 bg-white px-1.5 transition-colors ${isLeft ? 'md:translate-x-[-80px] md:text-left' : 'md:-translate-x-[calc(100%-80px)] md:text-right'
                                    }`}>
                                    {formatTime(seg.start)}
                                </div>

                                {/* Spacer for Mobile Axis */}
                                <div className="w-12 md:w-1/2 shrink-0 md:hidden" />

                                {/* Content Card */}
                                <div className={`
                                    relative w-[calc(100%-3rem)] md:w-[calc(50%-2rem)] ml-auto md:ml-0 p-3 pr-14 rounded-xl border bg-white shadow-sm transition-all duration-200 
                                    ${isCompletedByUser ? 'border-emerald-100 bg-emerald-50/10' : 'hover:shadow-md hover:border-gray-300'}
                                    ${isLeft ? 'md:mr-8' : 'md:ml-8'}
                                `}
                                    style={{ borderLeftColor: isCompletedByUser ? '#10b981' : seg.color, borderLeftWidth: 4 }}>

                                    <div className="flex justify-between items-start mb-1.5">
                                        <h4 className={`font-semibold text-sm line-clamp-2 leading-tight ${isCompletedByUser ? 'text-emerald-900 line-through decoration-emerald-500/30' : 'text-slate-800'}`}>
                                            {seg.name}
                                        </h4>
                                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ml-2 whitespace-nowrap ${isCompletedByUser ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                                            }`}>
                                            {Math.round(seg.count)} pcs
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seg.color }} />
                                            <span>{Math.round(seg.end - seg.start)}m</span>
                                        </div>
                                        <div className="font-mono opacity-75">
                                            {formatTime(seg.start)} - {formatTime(seg.end)}
                                        </div>
                                    </div>

                                    {/* Quick Log Button - In Card */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (isCompletedByUser) return;
                                            setSelectedLogSegment({ ...seg });
                                            setSelectedLogOpId(seg.opId);
                                            setSelectedLogStyleId(seg.styleId);
                                            setQuickLogOpen(true);
                                        }}
                                        disabled={isCompletedByUser}
                                        className={`absolute top-1/2 -translate-y-1/2 right-3 w-9 h-9 flex items-center justify-center rounded-full transition-all duration-200 shadow-sm ${isCompletedByUser
                                            ? 'bg-emerald-100 text-emerald-600 cursor-default ring-1 ring-emerald-200'
                                            : 'bg-slate-100 text-slate-500 hover:bg-emerald-100 hover:text-emerald-600 hover:scale-110'
                                            }`}
                                        title={isCompletedByUser ? "Completed" : "Quick Log Production"}
                                    >
                                        {isCompletedByUser ? <Check className="w-5 h-5" strokeWidth={3} /> : <Plus className="w-5 h-5" strokeWidth={3} />}
                                    </button>
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
                                                    isGap: false,
                                                    opId: op.id, // Add ID for quick log
                                                    styleId: isNext && selectedNextStyle ? selectedNextStyle.id : selectedStyle.id,
                                                    completed: ev.completed // Propagate completed flag
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

                                    {/* Production Complete Line */}
                                    {productionEndTime > 0 && mapWorkEnd(productionEndTime) < (TOTAL_SHIFT_MINUTES - 30) && (
                                        <div
                                            className="absolute top-0 bottom-0 border-l-2 border-dashed border-emerald-500 z-30 flex flex-col justify-end pb-2 pl-1"
                                            style={{ left: `${(mapWorkEnd(productionEndTime) / TOTAL_SHIFT_MINUTES) * 100}%` }}
                                        >
                                            <span className="text-[10px] font-bold text-emerald-600 bg-white/90 px-1 py-0.5 rounded shadow-sm whitespace-nowrap border border-emerald-200">
                                                Production Complete ({formatTime(mapWorkEnd(productionEndTime))})
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Time Ruler */}
                                <div className="flex flex-col md:flex-row w-full mb-2 relative z-10">
                                    <div className="hidden md:block w-[120px] pr-4 shrink-0" />
                                    <div className="flex-1 relative h-6 text-xs text-muted-foreground border-b border-gray-200">
                                        <div className="absolute top-0 h-full border-l pl-1 border-gray-300" style={{ left: '0%' }}>7:30</div>
                                        {Array.from({ length: Math.ceil(TOTAL_SHIFT_MINUTES / 60) }).map((_, i) => {
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
                                        <div className="absolute top-0 h-full border-l pl-1 border-gray-300" style={{ left: '100%' }}>
                                            {formatTime(TOTAL_SHIFT_MINUTES)}
                                        </div>
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

                                        // 1.5 Insert Switch Blocks
                                        for (let i = 0; i < mergedEvents.length - 1; i++) {
                                            const current = mergedEvents[i];
                                            const next = mergedEvents[i + 1];
                                            const gap = next.start - current.end;

                                            if (gap >= (switchDelay || 0) && gap > 0) {
                                                const currOp = getOpDetails(current.opId).op;
                                                const nextOp = getOpDetails(next.opId).op;

                                                // Only show switch block if machine type differs (or if there's a significant gap explicitly from sim)
                                                // Sim engine adds switchDelay ONLY for different machine types usually.
                                                if (currOp && nextOp && currOp.machineType !== nextOp.machineType) {
                                                    // Map start/end to Wall Time
                                                    // The switch happens immediately after current task ends
                                                    const switchStart = current.end;
                                                    const switchEnd = current.end + (switchDelay || 0);

                                                    // Allow for splitting if switch crosses a break? 
                                                    // Ideally yes.
                                                    const parts = splitSegment(switchStart, switchEnd);
                                                    parts.forEach(part => {
                                                        const wallStart = mapWorkStart(part.start);
                                                        const wallEnd = mapWorkEnd(part.end);
                                                        segments.push({
                                                            color: '#94a3b8', // Slate 400
                                                            name: 'Switch',
                                                            count: 0,
                                                            start: wallStart,
                                                            end: wallEnd,
                                                            isGap: true
                                                        });
                                                    });
                                                }
                                            }
                                        }

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

            <QuickLogModal
                isOpen={quickLogOpen}
                onClose={() => setQuickLogOpen(false)}
                segment={selectedLogSegment}
                operatorId={user?.uid || ""}
                opId={selectedLogOpId}
                styleId={selectedLogStyleId}
            />
        </TooltipProvider>
    );
}
