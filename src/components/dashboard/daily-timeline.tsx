import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { GarmentStyle, Operator, ProductionEntry, BreakConfig } from '@/lib/types';
import { format } from "date-fns";
import { QuickLogModal } from "./quick-log-modal";
import { useAuth } from "@/auth-provider";
import { Plus, Check } from "lucide-react";
import {
    cloneDefaultBreaks,
    computeWorkBreakPoints,
    getActiveBreaks,
    mapWorkToWall,
    parseShiftStartMinutes,
    splitSegmentAtBreaks,
} from "@/lib/shift-schedule";

interface Assignment {
    operationId: string;
    operatorIds: string[];
    variantId?: string;
    variantColor?: string;
}

interface ScheduleEvent {
    start: number;
    end: number;
    opId: string;
    count: number;
    completed?: boolean;
    styleIndex?: number;
    colorVariant?: string;
}

interface DailyTimelineProps {
    assignedOperators: Operator[];
    assignments: Assignment[];
    selectedStyle: GarmentStyle;
    selectedNextStyle?: GarmentStyle; // Support Next Style
    flowMetrics: Record<string, any>;
    availableMinutes: number;
    schedule?: Record<string, ScheduleEvent[]>;
    productionLogs?: ProductionEntry[]; // Optional logs
    isOrderComplete?: boolean;
    switchDelay?: number;
    shiftStartTime?: string; // "HH:MM" — drives wall-clock labels
    breaks?: BreakConfig[]; // Configurable tea/lunch breaks
}

export function DailyTimeline({ assignedOperators, assignments, selectedStyle, selectedNextStyle, flowMetrics, availableMinutes, schedule, productionLogs = [], isOrderComplete = false, switchDelay = 0, shiftStartTime = "07:30", breaks }: DailyTimelineProps) {
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

    const getSegmentStyleLabel = (isNextStyle: boolean, colorVariant?: string) => {
        const style = isNextStyle ? selectedNextStyle : selectedStyle;
        if (!style) return '';
        const variant = colorVariant || style.colorVariant;
        return variant ? `${style.name} - ${variant}` : style.name;
    };

    const getOperatorWeightForOperation = (operationId: string, operatorId: string): number | undefined => {
        const weights = flowMetrics?.[operationId]?.operatorWeights;
        if (weights instanceof Map) {
            const value = weights.get(operatorId);
            return typeof value === 'number' && isFinite(value) ? value : undefined;
        }
        if (weights && typeof weights === 'object') {
            const value = (weights as Record<string, number>)[operatorId];
            return typeof value === 'number' && isFinite(value) ? value : undefined;
        }
        return undefined;
    };

    const splitQuantityByOperators = (operationId: string, operatorIds: string[], quantity: number) => {
        const totalQty = Math.max(0, Math.round(quantity));
        if (operatorIds.length === 0) return [] as { operatorName: string, qty: number }[];

        const rawWeights = operatorIds.map(uid => {
            const w = getOperatorWeightForOperation(operationId, uid);
            return typeof w === 'number' && w > 0 ? w : 0;
        });

        const hasWeightedData = rawWeights.some(w => w > 0);
        const weights = hasWeightedData ? rawWeights : operatorIds.map(() => 1);
        const weightSum = weights.reduce((sum, w) => sum + w, 0) || operatorIds.length;

        const exactShares = weights.map(w => (w / weightSum) * totalQty);
        const baseShares = exactShares.map(v => Math.floor(v));
        let remainder = totalQty - baseShares.reduce((sum, v) => sum + v, 0);

        const fractions = exactShares
            .map((value, idx) => ({ idx, frac: value - baseShares[idx] }))
            .sort((a, b) => b.frac - a.frac);

        let cursor = 0;
        while (remainder > 0 && fractions.length > 0) {
            const index = fractions[cursor % fractions.length].idx;
            baseShares[index] += 1;
            remainder -= 1;
            cursor += 1;
        }

        return operatorIds.map((uid, idx) => ({
            operatorName: assignedOperators.find(op => op.id === uid)?.name || uid,
            qty: baseShares[idx] || 0
        }));
    };

    const getHandoffMessage = (
        opId: string,
        isNextStyle: boolean,
        segmentCount: number,
        fromOperatorName?: string,
        segmentColorVariant?: string
    ) => {
        const style = isNextStyle ? selectedNextStyle : selectedStyle;
        if (!style) return '';

        const qty = Math.max(0, Math.round(segmentCount));
        const currentOperation = style.operations.find(op => op.id === opId);
        const fromOperationName = currentOperation?.name || 'Current Operation';
        const isStartOperation = !currentOperation?.dependencies || currentOperation.dependencies.length === 0;
        const fromLabel = isStartOperation
            ? 'Cutting/Store'
            : (fromOperatorName ? `${fromOperatorName} (${fromOperationName})` : fromOperationName);
        const downstreamOps = style.operations.filter(op => (op.dependencies || []).includes(opId));
        if (downstreamOps.length === 0) {
            return `From ${fromLabel}: send ${qty} pcs to Final QC / Finished Goods.`;
        }

        const pickAssignmentForVariant = (operationId: string, colorVariant?: string) => {
            const candidates = assignments.filter(a => a.operationId === operationId);
            if (candidates.length === 0) return undefined;

            const color = (colorVariant || '').trim().toLowerCase();
            if (color) {
                const exactColor = candidates.find(a => (a.variantColor || '').trim().toLowerCase() === color);
                if (exactColor) return exactColor;
            }

            const generic = candidates.find(a => !a.variantId && !a.variantColor);
            return generic || candidates[0];
        };

        const targets = downstreamOps.map(nextOp => {
            const assignment = pickAssignmentForVariant(nextOp.id, segmentColorVariant || style.colorVariant);
            const downstreamOperatorIds = assignment?.operatorIds || [];
            if (downstreamOperatorIds.length === 0) return `${nextOp.name}: ${qty} pcs (Unassigned)`;

            const distribution = splitQuantityByOperators(nextOp.id, downstreamOperatorIds, qty);
            const detail = distribution
                .map(item => `${item.operatorName} ${item.qty} pcs`)
                .join(', ');
            return `${nextOp.name}: ${detail}`;
        });

        if (targets.length === 1) {
            return `From ${fromLabel}: send to ${targets[0]}.`;
        }
        return `From ${fromLabel}: split handoff -> ${targets.join(' | ')}.`;
    };

    // SHIFT CONFIGURATION (driven by the configured shift start + break schedule)
    const SHIFT_START_MINUTES = parseShiftStartMinutes(shiftStartTime);

    // Only the breaks that actually fall inside today's working span (handles
    // short shifts and OT). `availableMinutes` is productive (work) minutes.
    const activeBreaks = getActiveBreaks(
        (breaks && breaks.length > 0) ? breaks : cloneDefaultBreaks(),
        availableMinutes,
    );
    const workBreakPoints = computeWorkBreakPoints(activeBreaks);
    const totalBreakMinutes = activeBreaks.reduce((sum, b) => sum + b.duration, 0);

    // Wall-clock breaks (start/end measured from shift start, with prior breaks
    // already factored into their stored start times).
    const BREAKS = activeBreaks.map(b => ({ name: b.name, start: b.start, end: b.start + b.duration }));

    // Total wall-clock span = productive work + every active break.
    const TOTAL_SHIFT_MINUTES = Math.max(60, availableMinutes + totalBreakMinutes);

    // Helper: Map Working Minutes to Wall Minutes (Start limit)
    const mapWorkStart = (workMin: number) => mapWorkToWall(workMin, workBreakPoints, 'start');

    // Helper: Map Working Minutes to Wall Minutes (End limit)
    const mapWorkEnd = (workMin: number) => mapWorkToWall(workMin, workBreakPoints, 'end');

    // Helper: Format minutes to H:MM format
    const formatTime = (minutes: number) => {
        const totalMinutes = SHIFT_START_MINUTES + minutes;
        const h = Math.floor(totalMinutes / 60);
        const m = Math.floor(totalMinutes % 60);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const displayH = h > 12 ? h - 12 : (h === 0 ? 12 : h);
        return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
    };

    // Helper: Split a segment if it crosses a break point (work-minute space)
    const splitSegment = (start: number, end: number) => splitSegmentAtBreaks(start, end, workBreakPoints);

    const canMergeEvents = (current: ScheduleEvent, next: ScheduleEvent) => {
        if (next.opId !== current.opId) return false;
        if (next.styleIndex !== current.styleIndex) return false;
        if ((next.colorVariant || '') !== (current.colorVariant || '')) return false;
        const gap = next.start - current.end;
        return gap < 15;
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
                        if (seg.type === 'break' || seg.isGap || seg.name === 'Tea' || seg.name === 'Lunch') {
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
                                    {seg.styleLabel && (
                                        <div className="mb-1.5 text-[10px] text-muted-foreground">
                                            {seg.styleLabel}
                                        </div>
                                    )}
                                    {seg.handoffMessage && (
                                        <div className="mb-1.5 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-2 py-1">
                                            {seg.handoffMessage}
                                        </div>
                                    )}

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
                                            if (canMergeEvents(current, next)) {
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
                                                    styleLabel: getSegmentStyleLabel(isNext, ev.colorVariant),
                                                    handoffMessage: getHandoffMessage(op.id, isNext, partCount, user.name, ev.colorVariant),
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
                                            className={`absolute top-0 bottom-0 border-l-2 border-dashed z-30 flex flex-col justify-end pb-2 pl-1 ${isOrderComplete ? 'border-emerald-500' : 'border-amber-500'}`}
                                            style={{ left: `${(mapWorkEnd(productionEndTime) / TOTAL_SHIFT_MINUTES) * 100}%` }}
                                        >
                                            <span className={`text-[10px] font-bold bg-white/90 px-1 py-0.5 rounded shadow-sm whitespace-nowrap border ${isOrderComplete ? 'text-emerald-600 border-emerald-200' : 'text-amber-700 border-amber-200'}`}>
                                                {isOrderComplete ? 'Production Complete' : 'Planned Work Ends'} ({formatTime(mapWorkEnd(productionEndTime))})
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Time Ruler */}
                                <div className="flex flex-col md:flex-row w-full mb-2 relative z-10">
                                    <div className="hidden md:block w-[120px] pr-4 shrink-0" />
                                    <div className="flex-1 relative h-6 text-xs text-muted-foreground border-b border-gray-200">
                                        <div className="absolute top-0 h-full border-l pl-1 border-gray-300" style={{ left: '0%' }}>{formatTime(0)}</div>
                                        {(() => {
                                            // First round hour after shift start, then every 60 min.
                                            const firstTick = (60 - (SHIFT_START_MINUTES % 60)) % 60;
                                            const ticks: number[] = [];
                                            for (let tickTime = firstTick; tickTime < TOTAL_SHIFT_MINUTES; tickTime += 60) {
                                                if (tickTime > 0) ticks.push(tickTime);
                                            }
                                            return ticks.map(tickTime => {
                                                const hour24 = Math.floor((SHIFT_START_MINUTES + tickTime) / 60) % 24;
                                                const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
                                                return (
                                                    <div
                                                        key={tickTime}
                                                        className="absolute top-0 h-full border-l pl-1 border-gray-300"
                                                        style={{ left: `${(tickTime / TOTAL_SHIFT_MINUTES) * 100}%` }}
                                                    >
                                                        {hour12}
                                                    </div>
                                                );
                                            });
                                        })()}
                                        <div className="absolute top-0 h-full border-l pl-1 border-gray-300" style={{ left: '100%' }}>
                                            {formatTime(TOTAL_SHIFT_MINUTES)}
                                        </div>
                                    </div>
                                </div>

                                {assignedOperators.map(user => {
                                    let segments: {
                                        color: string,
                                        name: string,
                                        count: number,
                                        start: number,
                                        end: number,
                                        isGap: boolean,
                                        styleLabel?: string,
                                        handoffMessage?: string
                                    }[] = [];

                                    if (schedule && schedule[user.id]) {
                                        const rawEvents = schedule[user.id];
                                        const mergedEvents: typeof rawEvents = [];

                                        if (rawEvents.length > 0) {
                                            let current = { ...rawEvents[0] };
                                            for (let i = 1; i < rawEvents.length; i++) {
                                                const next = rawEvents[i];
                                                if (canMergeEvents(current, next)) {
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
                                                    segments.push({
                                                        color,
                                                        name: op.name,
                                                        styleLabel: getSegmentStyleLabel(isNext, ev.colorVariant),
                                                        handoffMessage: getHandoffMessage(op.id, isNext, partCount, user.name, ev.colorVariant),
                                                        count: partCount,
                                                        start: wallStart,
                                                        end: wallEnd,
                                                        isGap: false
                                                    });
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
                                            segments.push({ color: '#cbd5e1', name: b.name, count: 0, start: b.start, end: b.end, isGap: false });
                                        });
                                    }

                                    const totalPcs = Math.floor(segments.reduce((acc, s) => acc + (s.count || 0), 0));

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
                                                                {seg.styleLabel && (
                                                                    <div className="text-[10px] mb-1 text-slate-500">{seg.styleLabel}</div>
                                                                )}
                                                                {seg.handoffMessage && (
                                                                    <div className="text-[10px] mb-1 text-emerald-700">{seg.handoffMessage}</div>
                                                                )}
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
