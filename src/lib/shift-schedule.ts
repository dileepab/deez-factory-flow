import type { BreakConfig } from '@/lib/types';

/**
 * Default factory break schedule (minutes from shift start, wall-clock).
 * Tea 10:15-10:30, Lunch 13:00-13:30, Tea 15:15-15:30 for a 07:30 start.
 */
export const DEFAULT_BREAKS: BreakConfig[] = [
    { id: 'tea-am', name: 'Tea', start: 165, duration: 15 },
    { id: 'lunch', name: 'Lunch', start: 330, duration: 30 },
    { id: 'tea-pm', name: 'Tea', start: 465, duration: 15 },
];

export const cloneDefaultBreaks = (): BreakConfig[] =>
    DEFAULT_BREAKS.map(b => ({ ...b }));

/** Parse a "HH:MM" string into minutes from midnight. Falls back to 07:30. */
export const parseShiftStartMinutes = (timeStr?: string): number => {
    if (!timeStr) return (7 * 60) + 30;
    const [h, m] = timeStr.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return (7 * 60) + 30;
    return (h * 60) + m;
};

/**
 * Keep only the breaks that actually fall inside the working span.
 * `workMinutes` is productive (work) minutes — a break is dropped when the
 * line stops working before it would begin. Breaks are returned sorted.
 */
export const getActiveBreaks = (
    breaks: BreakConfig[],
    workMinutes: number,
): BreakConfig[] => {
    const sorted = [...breaks].sort((a, b) => a.start - b.start);
    let cumulative = 0;
    const active: BreakConfig[] = [];
    for (const b of sorted) {
        // Work-minute threshold at which this break begins.
        const workPoint = b.start - cumulative;
        if (workPoint < workMinutes) {
            active.push(b);
            cumulative += b.duration;
        }
    }
    return active;
};

type WorkBreakPoint = { point: number; duration: number; cumulativeAfter: number };

/**
 * Convert active breaks into work-minute breakpoints. `point` is the amount of
 * productive work completed when the break begins; `cumulativeAfter` is the
 * total wall-clock offset (sum of break durations) once it is over.
 */
export const computeWorkBreakPoints = (activeBreaks: BreakConfig[]): WorkBreakPoint[] => {
    let cumulative = 0;
    return [...activeBreaks]
        .sort((a, b) => a.start - b.start)
        .map(b => {
            const point = b.start - cumulative;
            cumulative += b.duration;
            return { point, duration: b.duration, cumulativeAfter: cumulative };
        });
};

/**
 * Map a productive work-minute to a wall-clock minute (from shift start),
 * inserting break time as it is crossed.
 *
 * mode 'start': a value sitting exactly on a breakpoint is pushed past the
 *   break (it starts after the break). mode 'end': a value on a breakpoint
 *   stays before the break (it finished right as the break began).
 */
export const mapWorkToWall = (
    workMin: number,
    workBreakPoints: WorkBreakPoint[],
    mode: 'start' | 'end',
): number => {
    let offset = 0;
    for (const bp of workBreakPoints) {
        const crossed = mode === 'start' ? workMin >= bp.point : workMin > bp.point;
        if (crossed) offset = bp.cumulativeAfter;
    }
    return workMin + offset;
};

/**
 * Split a work-minute segment at every break it spans, so each resulting part
 * sits inside a single working block.
 */
export const splitSegmentAtBreaks = (
    start: number,
    end: number,
    workBreakPoints: WorkBreakPoint[],
): { start: number; end: number }[] => {
    const s = Number(start);
    const e = Number(end);
    const parts: { start: number; end: number }[] = [];
    let current = s;
    for (const bp of workBreakPoints) {
        if (current < bp.point && e > bp.point) {
            parts.push({ start: current, end: bp.point });
            current = bp.point;
        }
    }
    if (current < e) parts.push({ start: current, end: e });
    return parts;
};
