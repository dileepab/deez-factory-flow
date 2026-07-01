import { describe, it, expect } from 'vitest';
import {
    DEFAULT_BREAKS,
    cloneDefaultBreaks,
    computeWorkBreakPoints,
    getActiveBreaks,
    mapWorkToWall,
    parseShiftStartMinutes,
    splitSegmentAtBreaks,
} from './shift-schedule';

describe('shift-schedule', () => {
    it('parses shift start, falling back to 07:30', () => {
        expect(parseShiftStartMinutes('08:00')).toBe(480);
        expect(parseShiftStartMinutes('07:30')).toBe(450);
        expect(parseShiftStartMinutes(undefined)).toBe(450);
        expect(parseShiftStartMinutes('garbage')).toBe(450);
    });

    it('reproduces the legacy work->wall mapping for a standard 8h shift', () => {
        // Legacy hardcoded behaviour: breakpoints 165/315/420 with offsets 15/45/60.
        const active = getActiveBreaks(cloneDefaultBreaks(), 480);
        const pts = computeWorkBreakPoints(active);
        expect(pts.map(p => p.point)).toEqual([165, 315, 420]);

        // Start mode pushes a value sitting on a breakpoint past the break.
        expect(mapWorkToWall(0, pts, 'start')).toBe(0);
        expect(mapWorkToWall(165, pts, 'start')).toBe(180);
        expect(mapWorkToWall(200, pts, 'start')).toBe(215);
        expect(mapWorkToWall(315, pts, 'start')).toBe(360);
        expect(mapWorkToWall(420, pts, 'start')).toBe(480);

        // End mode keeps a value on a breakpoint before the break.
        expect(mapWorkToWall(165, pts, 'end')).toBe(165);
        expect(mapWorkToWall(315, pts, 'end')).toBe(330);
        expect(mapWorkToWall(420, pts, 'end')).toBe(465);
    });

    it('drops breaks that fall outside a short shift', () => {
        const active = getActiveBreaks(cloneDefaultBreaks(), 240);
        // Only the morning tea (work-point 165) fits inside a 240-min shift.
        expect(active).toHaveLength(1);
        expect(active[0].name).toBe('Tea');
        expect(active.reduce((s, b) => s + b.duration, 0)).toBe(15);
    });

    it('keeps all breaks for an overtime shift', () => {
        const active = getActiveBreaks(cloneDefaultBreaks(), 600);
        expect(active).toHaveLength(DEFAULT_BREAKS.length);
    });

    it('splits a segment at every break it crosses', () => {
        const pts = computeWorkBreakPoints(getActiveBreaks(cloneDefaultBreaks(), 480));
        // 100 -> 350 crosses the 165 and 315 breakpoints.
        const parts = splitSegmentAtBreaks(100, 350, pts);
        expect(parts).toEqual([
            { start: 100, end: 165 },
            { start: 165, end: 315 },
            { start: 315, end: 350 },
        ]);
    });

    it('leaves a segment intact when it spans no break', () => {
        const pts = computeWorkBreakPoints(getActiveBreaks(cloneDefaultBreaks(), 480));
        expect(splitSegmentAtBreaks(10, 120, pts)).toEqual([{ start: 10, end: 120 }]);
    });

    it('honours a custom break schedule', () => {
        const custom = [{ id: 'b1', name: 'Lunch', start: 240, duration: 45 }];
        const active = getActiveBreaks(custom, 480);
        const pts = computeWorkBreakPoints(active);
        expect(pts).toEqual([{ point: 240, duration: 45, cumulativeAfter: 45 }]);
        expect(mapWorkToWall(240, pts, 'start')).toBe(285);
        expect(mapWorkToWall(240, pts, 'end')).toBe(240);
    });
});
