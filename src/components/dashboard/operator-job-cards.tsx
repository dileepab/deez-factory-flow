import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Printer, User, Wrench, Clock, ArrowRight } from 'lucide-react';
import type { GarmentStyle, Operator, BreakConfig } from '@/lib/types';
import {
    cloneDefaultBreaks,
    computeWorkBreakPoints,
    getActiveBreaks,
    mapWorkToWall,
    parseShiftStartMinutes,
    splitSegmentAtBreaks,
} from '@/lib/shift-schedule';

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
    styleIndex?: number;
    colorVariant?: string;
}

interface OperatorJobCardsProps {
    assignedOperators: Operator[];
    assignments: Assignment[];
    selectedStyle: GarmentStyle;
    selectedNextStyle?: GarmentStyle;
    schedule?: Record<string, ScheduleEvent[]>;
    availableMinutes: number;
    shiftStartTime?: string;
    breaks?: BreakConfig[];
}

interface StationLine {
    opName: string;
    machineType: string;
    pcs: number;
    styleLabel: string;
    handoff: string;
}

interface HourLine {
    label: string;
    pcs: number;
    ops: string;
}

interface JobCard {
    operatorId: string;
    operatorName: string;
    totalPcs: number;
    stations: StationLine[];
    hours: HourLine[];
}

const formatClock = (clockMin: number) => {
    const h = Math.floor(clockMin / 60) % 24;
    const m = Math.round(clockMin % 60);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
};

export function OperatorJobCards({
    assignedOperators,
    assignments,
    selectedStyle,
    selectedNextStyle,
    schedule,
    availableMinutes,
    shiftStartTime = '07:30',
    breaks,
}: OperatorJobCardsProps) {
    const shiftStartMinutes = parseShiftStartMinutes(shiftStartTime);

    const cards = useMemo<JobCard[]>(() => {
        if (!schedule) return [];

        const activeBreaks = getActiveBreaks((breaks && breaks.length > 0) ? breaks : cloneDefaultBreaks(), availableMinutes);
        const workBreakPoints = computeWorkBreakPoints(activeBreaks);

        const getOpDetails = (opId: string) => {
            let op = selectedStyle.operations.find(o => o.id === opId);
            let isNext = false;
            if (!op && selectedNextStyle) {
                op = selectedNextStyle.operations.find(o => o.id === opId);
                isNext = true;
            }
            return { op, isNext };
        };

        const styleLabelFor = (isNext: boolean, colorVariant?: string) => {
            const style = isNext ? selectedNextStyle : selectedStyle;
            if (!style) return '';
            const variant = colorVariant || style.colorVariant;
            return variant ? `${style.name} - ${variant}` : style.name;
        };

        const handoffFor = (opId: string, isNext: boolean) => {
            const style = isNext ? selectedNextStyle : selectedStyle;
            if (!style) return 'Final QC / Finished Goods';
            const downstream = style.operations.filter(o => (o.dependencies || []).includes(opId));
            if (downstream.length === 0) return 'Final QC / Finished Goods';
            return downstream.map(d => {
                const assignment = assignments.find(a => a.operationId === d.id);
                const names = (assignment?.operatorIds || [])
                    .map(id => assignedOperators.find(o => o.id === id)?.name)
                    .filter(Boolean);
                const who = names.length > 0 ? names.join(', ') : 'Unassigned';
                return `${d.name} (${who})`;
            }).join(' • ');
        };

        return assignedOperators.map(user => {
            const rawEvents = (schedule[user.id] || [])
                .slice()
                .sort((a, b) => a.start - b.start);

            // Aggregate per station (operation).
            const stationMap = new Map<string, StationLine>();
            // Aggregate per clock hour.
            const hourMap = new Map<number, { pcs: number; ops: Set<string> }>();
            let totalPcs = 0;

            rawEvents.forEach(ev => {
                const { op, isNext } = getOpDetails(ev.opId);
                if (!op) return;
                totalPcs += ev.count;

                const stationKey = `${ev.opId}-${ev.styleIndex || 0}-${ev.colorVariant || ''}`;
                const existing = stationMap.get(stationKey);
                if (existing) {
                    existing.pcs += ev.count;
                } else {
                    stationMap.set(stationKey, {
                        opName: op.name,
                        machineType: op.machineType,
                        pcs: ev.count,
                        styleLabel: styleLabelFor(isNext, ev.colorVariant),
                        handoff: handoffFor(op.id, isNext),
                    });
                }

                // Distribute the batch across the clock hours it spans (breaks excluded).
                const parts = splitSegmentAtBreaks(ev.start, ev.end, workBreakPoints);
                const totalDur = Math.max(1e-6, ev.end - ev.start);
                parts.forEach(part => {
                    const wallStart = mapWorkToWall(part.start, workBreakPoints, 'start');
                    const wallEnd = mapWorkToWall(part.end, workBreakPoints, 'end');
                    const partCount = ((part.end - part.start) / totalDur) * ev.count;
                    const clockStart = shiftStartMinutes + wallStart;
                    const clockEnd = shiftStartMinutes + wallEnd;
                    const span = Math.max(1e-6, clockEnd - clockStart);

                    let cursor = clockStart;
                    while (cursor < clockEnd) {
                        const hourStart = Math.floor(cursor / 60) * 60;
                        const hourEnd = hourStart + 60;
                        const sliceEnd = Math.min(hourEnd, clockEnd);
                        const frac = (sliceEnd - cursor) / span;
                        const bucket = hourMap.get(hourStart) || { pcs: 0, ops: new Set<string>() };
                        bucket.pcs += partCount * frac;
                        bucket.ops.add(op.name);
                        hourMap.set(hourStart, bucket);
                        cursor = sliceEnd;
                    }
                });
            });

            const stations = Array.from(stationMap.values())
                .map(s => ({ ...s, pcs: Math.round(s.pcs) }))
                .sort((a, b) => b.pcs - a.pcs);

            const hours = Array.from(hourMap.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([hourStart, data]) => ({
                    label: `${formatClock(hourStart)} – ${formatClock(hourStart + 60)}`,
                    pcs: Math.round(data.pcs),
                    ops: Array.from(data.ops).join(', '),
                }))
                .filter(h => h.pcs > 0);

            return {
                operatorId: user.id,
                operatorName: user.name,
                totalPcs: Math.round(totalPcs),
                stations,
                hours,
            };
        }).filter(c => c.stations.length > 0);
    }, [assignedOperators, assignments, selectedStyle, selectedNextStyle, schedule, availableMinutes, shiftStartMinutes, breaks]);

    const handlePrint = () => {
        const win = window.open('', '_blank', 'width=900,height=700');
        if (!win) return;
        const dateStr = new Date().toLocaleDateString();
        const cardHtml = cards.map(card => `
            <div class="card">
                <div class="card-head">
                    <div class="op-name">${card.operatorName}</div>
                    <div class="op-total">${card.totalPcs} pcs target</div>
                </div>
                <div class="section-title">Stations</div>
                ${card.stations.map(s => `
                    <div class="station">
                        <div class="station-row">
                            <span class="station-name">${s.opName}</span>
                            <span class="station-pcs">${s.pcs} pcs</span>
                        </div>
                        <div class="station-meta">${s.machineType} &middot; ${s.styleLabel}</div>
                        <div class="handoff">→ Send to: ${s.handoff}</div>
                    </div>
                `).join('')}
                <div class="section-title">Hourly target</div>
                <table class="hours">
                    ${card.hours.map(h => `<tr><td>${h.label}</td><td class="hpcs">${h.pcs} pcs</td><td class="hops">${h.ops}</td></tr>`).join('')}
                </table>
            </div>
        `).join('');

        win.document.write(`
            <html>
            <head>
                <title>Operator Job Cards</title>
                <style>
                    * { box-sizing: border-box; font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
                    body { margin: 16px; color: #1e293b; }
                    h1 { font-size: 18px; margin: 0 0 2px; }
                    .sub { color: #64748b; font-size: 12px; margin-bottom: 16px; }
                    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
                    .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; page-break-inside: avoid; }
                    .card-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #1e293b; padding-bottom: 6px; margin-bottom: 8px; }
                    .op-name { font-size: 15px; font-weight: 700; }
                    .op-total { font-size: 12px; font-weight: 700; color: #0f766e; }
                    .section-title { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; font-weight: 700; margin: 8px 0 4px; }
                    .station { border-left: 3px solid #3b82f6; padding: 2px 0 4px 8px; margin-bottom: 6px; }
                    .station-row { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; }
                    .station-pcs { font-variant-numeric: tabular-nums; }
                    .station-meta { font-size: 11px; color: #64748b; }
                    .handoff { font-size: 11px; color: #047857; margin-top: 2px; }
                    table.hours { width: 100%; border-collapse: collapse; font-size: 11px; }
                    table.hours td { padding: 3px 4px; border-bottom: 1px solid #e2e8f0; }
                    .hpcs { text-align: right; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
                    .hops { color: #64748b; }
                    @media print { .grid { gap: 8px; } }
                </style>
            </head>
            <body>
                <h1>${selectedStyle.name} — Operator Job Cards</h1>
                <div class="sub">${dateStr} &middot; Shift start ${shiftStartTime}</div>
                <div class="grid">${cardHtml}</div>
                <script>window.onload = () => { window.print(); }</script>
            </body>
            </html>
        `);
        win.document.close();
    };

    if (cards.length === 0) return null;

    return (
        <Card className="mt-6 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base font-semibold">
                        <User className="h-5 w-5 text-indigo-500" />
                        Operator Job Cards
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">Floor-ready sheet per operator — station, target, hourly pace, and handoffs.</p>
                </div>
                <Button variant="outline" size="sm" onClick={handlePrint}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print
                </Button>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {cards.map(card => (
                        <div key={card.operatorId} className="rounded-lg border bg-white shadow-sm overflow-hidden">
                            <div className="flex items-baseline justify-between px-4 py-2.5 border-b-2 border-slate-800 bg-slate-50">
                                <div className="font-bold text-sm text-slate-800">{card.operatorName}</div>
                                <div className="text-xs font-bold text-teal-700 whitespace-nowrap">{card.totalPcs} pcs</div>
                            </div>
                            <div className="p-3 space-y-3">
                                <div>
                                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                        <Wrench className="h-3 w-3" /> Stations
                                    </div>
                                    <div className="space-y-2">
                                        {card.stations.map((s, i) => (
                                            <div key={i} className="border-l-[3px] border-blue-500 pl-2">
                                                <div className="flex justify-between text-[13px] font-semibold text-slate-800">
                                                    <span className="line-clamp-1">{s.opName}</span>
                                                    <span className="font-mono whitespace-nowrap ml-2">{s.pcs} pcs</span>
                                                </div>
                                                <div className="text-[10px] text-muted-foreground">{s.machineType} · {s.styleLabel}</div>
                                                <div className="flex items-start gap-1 text-[10px] text-emerald-700 mt-0.5">
                                                    <ArrowRight className="h-3 w-3 mt-px shrink-0" />
                                                    <span className="line-clamp-2">{s.handoff}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                                        <Clock className="h-3 w-3" /> Hourly Target
                                    </div>
                                    <div className="space-y-0.5">
                                        {card.hours.map((h, i) => (
                                            <div key={i} className="flex items-center justify-between text-[11px] py-0.5 border-b border-slate-100 last:border-0">
                                                <span className="font-mono text-slate-600">{h.label}</span>
                                                <span className="font-mono font-bold text-slate-800 whitespace-nowrap ml-2">{h.pcs} pcs</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
