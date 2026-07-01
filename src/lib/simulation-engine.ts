
import type { GarmentStyle, Operator, Assignment } from '@/lib/types';

// Helper: Filter unique items
export const unique = <T,>(arr: T[]) => Array.from(new Set(arr));

export type HistoricalPerformanceMap = Record<string, Record<string, number>>;
export type ThreadConstraintRule = {
    ballsPerMachine: number;
    availableByColor: Record<string, number>;
};
export type ThreadConstraintConfig =
    | { machineRules: Record<string, ThreadConstraintRule> }
    | { machineType: string; ballsPerMachine: number; availableByColor: Record<string, number> };

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

const getOperatorMinutes = (
    availableMinutes: number,
    attendance: { startDelay: number; shiftExtension: number } | undefined
): number => {
    const startDelay = attendance?.startDelay || 0;
    const shiftExtension = attendance?.shiftExtension || 0;
    return Math.max(0, availableMinutes + shiftExtension - startDelay);
};

const getHistoricalMultiplier = (
    historicalPerformance: HistoricalPerformanceMap,
    operatorId: string,
    operationId: string
): number => {
    const value = historicalPerformance?.[operatorId]?.[operationId];
    if (typeof value !== 'number' || !isFinite(value)) {
        return 1;
    }
    return clamp(value, 0.6, 1.5);
};

const deriveWipCapForOperation = (opSmvSeconds: number): number => {
    const smvMinutes = Math.max(0.25, opSmvSeconds / 60);
    // Cap WIP to roughly 45 minutes of work. A slightly larger buffer keeps an
    // operator on the same station for longer contiguous runs (fewer, chunkier
    // blocks on the floor) without letting upstream overproduce excessively.
    const suggested = Math.round(45 / smvMinutes);
    return clamp(suggested, 10, 75);
};

// Helper: Simulate Minute-by-Minute Production for Timeline
// Returns a schedule of segments for each operator
export const simulateProductionSchedule = (
    stylesInput: GarmentStyle[] | GarmentStyle,
    allAssignmentsInput: Assignment[][] | Assignment[], // Array of assignment arrays corresponding to styles
    operators: Operator[],
    machineCounts: Record<string, number>,
    availableMinutes: number,
    switchDelay: number = 5,
    operatorAttendanceOrNextStyle: Record<string, { startDelay: number; shiftExtension: number }> | GarmentStyle = {},
    historicalPerformanceOrNextStyle: HistoricalPerformanceMap | GarmentStyle | Assignment[] = {},
    legacyNextAssignmentsOrAttendance: Assignment[] | Record<string, number | { startDelay?: number; shiftExtension?: number }> = [],
    threadConstraints?: ThreadConstraintConfig
) => {
    const isStyleArg = (value: unknown): value is GarmentStyle =>
        !!value &&
        typeof value === 'object' &&
        'operations' in (value as any) &&
        Array.isArray((value as any).operations);

    const isAssignmentArrayArg = (value: unknown): value is Assignment[] =>
        Array.isArray(value) &&
        (value.length === 0 || (typeof value[0] === 'object' && value[0] !== null && 'operationId' in (value[0] as any)));

    const normalizeAttendanceArg = (value: unknown): Record<string, { startDelay: number; shiftExtension: number }> | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const rawEntries = Object.entries(value as Record<string, unknown>);
        if (rawEntries.length === 0) return {};

        const normalized: Record<string, { startDelay: number; shiftExtension: number }> = {};
        for (const [uid, raw] of rawEntries) {
            if (typeof raw === 'number' && isFinite(raw)) {
                normalized[uid] = { startDelay: Math.max(0, raw), shiftExtension: 0 };
                continue;
            }

            if (raw && typeof raw === 'object') {
                const startRaw = (raw as any).startDelay;
                const extensionRaw = (raw as any).shiftExtension;
                if (startRaw === undefined && extensionRaw === undefined) return null;

                const startDelay = Number(startRaw ?? 0);
                const shiftExtension = Number(extensionRaw ?? 0);
                normalized[uid] = {
                    startDelay: isFinite(startDelay) ? Math.max(0, startDelay) : 0,
                    shiftExtension: isFinite(shiftExtension) ? shiftExtension : 0
                };
                continue;
            }

            return null;
        }

        return normalized;
    };

    const baseStyles = Array.isArray(stylesInput) ? stylesInput : [stylesInput];
    const baseAssignments = Array.isArray(allAssignmentsInput[0])
        ? allAssignmentsInput as Assignment[][]
        : [allAssignmentsInput as Assignment[]];

    let operatorAttendance: Record<string, { startDelay: number; shiftExtension: number }> = {};
    let historicalPerformance: HistoricalPerformanceMap = {};
    let legacyNextStyle: GarmentStyle | undefined;
    let parsedLegacyNextAssignments: Assignment[] = [];
    const trailingLegacyAttendance = normalizeAttendanceArg(legacyNextAssignmentsOrAttendance);

    // Legacy overload A:
    // simulate(style, assignments, operators, machines, mins, delay, nextStyle, nextAssignments)
    if (isStyleArg(operatorAttendanceOrNextStyle)) {
        legacyNextStyle = operatorAttendanceOrNextStyle;
        if (isAssignmentArrayArg(historicalPerformanceOrNextStyle)) {
            parsedLegacyNextAssignments = historicalPerformanceOrNextStyle;
        } else if (isAssignmentArrayArg(legacyNextAssignmentsOrAttendance)) {
            parsedLegacyNextAssignments = legacyNextAssignmentsOrAttendance;
        } else {
            parsedLegacyNextAssignments = [];
        }
    } else {
        operatorAttendance = normalizeAttendanceArg(operatorAttendanceOrNextStyle) || {};

        // Legacy overload B:
        // simulate(style, assignments, operators, machines, mins, delay, attendance, nextStyle, nextAssignments)
        if (isStyleArg(historicalPerformanceOrNextStyle)) {
            legacyNextStyle = historicalPerformanceOrNextStyle;
            parsedLegacyNextAssignments = isAssignmentArrayArg(legacyNextAssignmentsOrAttendance)
                ? legacyNextAssignmentsOrAttendance
                : [];
        } else {
            historicalPerformance = (historicalPerformanceOrNextStyle as HistoricalPerformanceMap) || {};
        }
    }

    // Legacy overload C:
    // simulate(style, assignments, operators, machines, mins, delay, undefined, undefined, operatorDelays)
    if (Object.keys(operatorAttendance).length === 0 && trailingLegacyAttendance) {
        operatorAttendance = trailingLegacyAttendance;
    }

    const styles = legacyNextStyle ? [...baseStyles, legacyNextStyle] : baseStyles;
    const allAssignments = legacyNextStyle ? [...baseAssignments, parsedLegacyNextAssignments] : baseAssignments;
    const normalizeThreadConstraintRule = (rule: Partial<ThreadConstraintRule> | undefined): ThreadConstraintRule => ({
        ballsPerMachine: Math.max(1, Math.floor(rule?.ballsPerMachine || 1)),
        availableByColor: rule?.availableByColor || {}
    });
    const normalizedThreadConstraints = (() => {
        if (!threadConstraints) return undefined;

        // Backward compatibility: single-machine config
        if ('machineType' in threadConstraints) {
            const machineType = threadConstraints.machineType?.trim();
            if (!machineType) return undefined;
            return {
                [machineType]: normalizeThreadConstraintRule(threadConstraints)
            } as Record<string, ThreadConstraintRule>;
        }

        const rules: Record<string, ThreadConstraintRule> = {};
        Object.entries(threadConstraints.machineRules || {}).forEach(([machineTypeRaw, rule]) => {
            const machineType = machineTypeRaw.trim();
            if (!machineType) return;
            rules[machineType] = normalizeThreadConstraintRule(rule);
        });

        return Object.keys(rules).length > 0 ? rules : undefined;
    })();
    const sharedThreadInventoryByColor = (() => {
        const inventory: Record<string, number> = {};
        if (!normalizedThreadConstraints) return inventory;

        Object.values(normalizedThreadConstraints).forEach(rule => {
            Object.entries(rule.availableByColor || {}).forEach(([color, rawBalls]) => {
                if (typeof rawBalls !== 'number' || !isFinite(rawBalls)) return;
                const balls = Math.max(0, Math.floor(rawBalls));
                if (inventory[color] === undefined) {
                    inventory[color] = balls;
                    return;
                }

                // If machine rules disagree, stay conservative and use the lowest limit.
                inventory[color] = Math.min(inventory[color], balls);
            });
        });

        return inventory;
    })();

    // 1. Setup Logging & Output
    const logs: string[] = [];
    const log = (msg: string) => { if (logs.length < 500) logs.push(msg); };
    log(`SIM START. Machines=${JSON.stringify(machineCounts)}. Delay=${switchDelay}. Styles=${styles.length}`);

    // Determine Logic Simulation Duration (Base + Max OT)
    let maxSimulationTicks = availableMinutes;
    Object.values(operatorAttendance).forEach(att => {
        const userEnd = availableMinutes + (att.shiftExtension || 0);
        if (userEnd > maxSimulationTicks) maxSimulationTicks = userEnd;
    });

    // Track Last State for Delay Logic
    const operatorLastMachine = new Map<string, string>();
    const operatorLastOpId = new Map<string, string>();
    const operatorLastColor = new Map<string, string>();
    const threadBallsInUseByColor = new Map<string, number>();

    const schedule: Record<string, { start: number, end: number, opId: string, count: number, isNextStyle?: boolean, colorVariant?: string, styleIndex: number }[]> = {};
    operators.forEach(o => schedule[o.id] = []);

    // --- PRE-CALCULATION PER STYLE ---
    const styleMeta = styles.map((style, index) => {
        const assignments = allAssignments[index] || [];

        // 1.1 Redundant Dependency Removal
        const effectiveDependencies = new Map<string, string[]>();
        const getAncestors = (opId: string, memo = new Map<string, Set<string>>()): Set<string> => {
            if (memo.has(opId)) return memo.get(opId)!;
            const ancestors = new Set<string>();
            const op = style.operations.find(o => o.id === opId);
            if (op && op.dependencies) {
                op.dependencies.forEach(d => {
                    ancestors.add(d);
                    getAncestors(d, memo).forEach(a => ancestors.add(a));
                });
            }
            memo.set(opId, ancestors);
            return ancestors;
        };

        style.operations.forEach(op => {
            if (!op.dependencies || op.dependencies.length === 0) {
                effectiveDependencies.set(op.id, []);
                return;
            }
            const originalDeps = [...op.dependencies];
            const ancestorsMap = new Map<string, Set<string>>();
            const toRemove = new Set<string>();
            originalDeps.forEach(dep => {
                originalDeps.forEach(other => {
                    if (dep === other) return;
                    if (getAncestors(other, ancestorsMap).has(dep)) toRemove.add(dep);
                });
            });
            effectiveDependencies.set(op.id, originalDeps.filter(d => !toRemove.has(d)));
        });

        // 1.2 Calculate Ideal Weights (Target Ratios)
        const assignArr = assignments.map(a => ({ operationId: a.operationId, operatorIds: a.operatorIds }));
        const solvedWeights = solveFluidCapacity(style, assignArr, operators, machineCounts, availableMinutes, operatorAttendance);

        const targetRatios = new Map<string, Map<string, number>>();
        operators.forEach(u => targetRatios.set(u.id, new Map()));
        solvedWeights.forEach((res, opId) => {
            if (res.finalWeights) {
                res.finalWeights.forEach((w, uid) => {
                    targetRatios.get(uid)?.set(opId, w);
                });
            }
        });

        // 1.5 Pre-calculate effective consumers (who actually pulls each op's
        // output, after transitive reduction). Keyed off effectiveDependencies so
        // the WIP model matches the real flow restrictions.
        const successors = new Map<string, string[]>();
        style.operations.forEach(op => {
            const deps = effectiveDependencies.get(op.id) || [];
            deps.forEach(depId => {
                const list = successors.get(depId) || [];
                list.push(op.id);
                successors.set(depId, list);
            });
        });
        const finalOperationIds = new Set(
            style.operations
                .filter(op => (successors.get(op.id)?.length || 0) === 0)
                .map(op => op.id)
        );

        // 2. Initialize State
        const remainingTargets = new Map<string, number>();
        const wipCaps = new Map<string, number>();
        const totalOrderQty = style.quantity || 10000;

        style.operations.forEach(op => {
            const done = op.completedQuantity || 0;
            const left = Math.max(0, totalOrderQty - done);
            remainingTargets.set(op.id, left);
            wipCaps.set(op.id, deriveWipCapForOperation(op.smv));
        });

        // Per-edge WIP buffers: edgeInventory[producer][consumer] = pieces that
        // finished `producer` and are waiting on `consumer`. Producing one piece
        // feeds EVERY consumer edge, so a diamond split (e.g. Outseam -> Waistband
        // AND Bottom Hem) is no longer double-consumed from a shared pool.
        const edgeInventory = new Map<string, Map<string, number>>();
        const getEdge = (producer: string, consumer: string) =>
            edgeInventory.get(producer)?.get(consumer) || 0;
        const setEdge = (producer: string, consumer: string, value: number) => {
            let inner = edgeInventory.get(producer);
            if (!inner) { inner = new Map(); edgeInventory.set(producer, inner); }
            inner.set(consumer, Math.max(0, value));
        };

        // Seed buffers from any already-completed work.
        style.operations.forEach(op => {
            const produced = op.completedQuantity || 0;
            (successors.get(op.id) || []).forEach(consumerId => {
                const consumer = style.operations.find(o => o.id === consumerId);
                setEdge(op.id, consumerId, produced - (consumer?.completedQuantity || 0));
            });
        });

        // WIP sitting after a station = its most-backed-up consumer edge (0 if final).
        const ownWip = (opId: string) => {
            const consumers = successors.get(opId) || [];
            let max = 0;
            for (const c of consumers) max = Math.max(max, getEdge(opId, c));
            return max;
        };
        // Pieces available to work = the scarcest input edge. Infinity when the op
        // has no dependencies (fed directly from cutting/store).
        const inputAvailable = (opId: string) => {
            const deps = effectiveDependencies.get(opId) || [];
            if (deps.length === 0) return Infinity;
            let min = Infinity;
            for (const d of deps) min = Math.min(min, getEdge(d, opId));
            return min;
        };
        // Move finished pieces onto every consumer edge.
        const addProduction = (opId: string, count: number) => {
            (successors.get(opId) || []).forEach(c => setEdge(opId, c, getEdge(opId, c) + count));
        };
        // Pull pieces from each input edge as a batch starts.
        const consumeInput = (opId: string, count: number) => {
            (effectiveDependencies.get(opId) || []).forEach(d => setEdge(d, opId, getEdge(d, opId) - count));
        };

        const userProcessedCounts = new Map<string, Map<string, number>>();
        operators.forEach(u => userProcessedCounts.set(u.id, new Map()));
        const threadColorLimitBalls = (() => {
            const styleColor = style.colorVariant;
            if (!normalizedThreadConstraints || !styleColor) return 0;
            return Math.max(0, Math.floor(sharedThreadInventoryByColor[styleColor] ?? 0));
        })();

        return {
            effectiveDependencies,
            targetRatios,
            successors,
            finalOperationIds,
            ownWip,
            inputAvailable,
            addProduction,
            consumeInput,
            remainingTargets,
            wipCaps,
            threadColorLimitBalls,
            userProcessedCounts,
            assignments
        };
    });

    const machineUsage = new Map<string, number>();
    const opState = new Map<string, { busyUntil: number, opId: string, startTick: number, count: number, styleIndex: number, colorVariant?: string }>();
    const operatorIdleSince = new Map<string, number>();
    const COLOR_SWITCH_GRACE_MINUTES = Math.max(10, switchDelay * 3);
    const MIN_COLOR_SWITCH_BATCH = 12;

    // 3. Simulation Loop
    for (let t = 0; t < maxSimulationTicks; t++) {

        // A. Release Resources
        const finishedIds: string[] = [];
        opState.forEach((state, uid) => {
            if (state.busyUntil <= t) {
                finishedIds.push(uid);
            }
        });

        finishedIds.forEach(uid => {
            const state = opState.get(uid)!;
            const currentStyle = styles[state.styleIndex];
            const meta = styleMeta[state.styleIndex];
                const op = currentStyle.operations.find(o => o.id === state.opId);

            schedule[uid].push({
                start: state.startTick,
                end: state.busyUntil,
                opId: state.opId,
                count: state.count,
                isNextStyle: state.styleIndex > 0, // Legacy support flag
                styleIndex: state.styleIndex,
                colorVariant: state.colorVariant
            });

            if (op) {
                operatorLastMachine.set(uid, op.machineType.trim());
                if (state.colorVariant) operatorLastColor.set(uid, state.colorVariant);

                const mType = op.machineType.trim();
                const currentUse = machineUsage.get(mType) || 1;
                machineUsage.set(mType, Math.max(0, currentUse - 1));
                if (
                    normalizedThreadConstraints &&
                    state.colorVariant &&
                    normalizedThreadConstraints[mType]
                ) {
                    const rule = normalizedThreadConstraints[mType];
                    const currentThreadUse = threadBallsInUseByColor.get(state.colorVariant) || rule.ballsPerMachine;
                    threadBallsInUseByColor.set(
                        state.colorVariant,
                        Math.max(0, currentThreadUse - rule.ballsPerMachine)
                    );
                }

                meta.addProduction(op.id, state.count);

                const uMap = meta.userProcessedCounts.get(uid);
                if (uMap) uMap.set(op.id, (uMap.get(op.id) || 0) + state.count);

                const styleTag = state.styleIndex > 0 ? ' (NEXT)' : '';
                log(`T=${t.toFixed(0)} RELEASE ${uid} ${mType}. Output ${op.name} (S${state.styleIndex})${styleTag}: +${state.count}`);
            }
            opState.delete(uid);
        });

        // B. Assign Idle Operators
        operators.forEach(user => {
            if (opState.has(user.id)) {
                operatorIdleSince.delete(user.id);
                return;
            }

            const att = operatorAttendance[user.id] || { startDelay: 0, shiftExtension: 0 };
            const startCheck = att.startDelay || 0;
            const endCheck = availableMinutes + (att.shiftExtension || 0);

            if (t < startCheck || t >= endCheck) {
                operatorIdleSince.delete(user.id);
                return;
            }

            if (!operatorIdleSince.has(user.id)) {
                operatorIdleSince.set(user.id, t);
            }

            const idleSince = operatorIdleSince.get(user.id);
            const idleMinutes = idleSince === undefined ? 0 : Math.max(0, t - idleSince);

            // Prefer staying on the last processed color to reduce avoidable thread/color changeovers.
            const preferredColor = operatorLastColor.get(user.id);
            const hasFeasibleTaskForColor = (color: string) => {
                for (let colorStyleIdx = 0; colorStyleIdx < styles.length; colorStyleIdx++) {
                    const style = styles[colorStyleIdx];
                    if ((style.colorVariant || '') !== color) continue;
                    const meta = styleMeta[colorStyleIdx];

                    const myAssignments = meta.assignments.filter(a => a.operatorIds.includes(user.id));
                    if (myAssignments.length === 0) continue;

                    for (const assignment of myAssignments) {
                        const op = style.operations.find(o => o.id === assignment.operationId);
                        if (!op) continue;

                        const succs = meta.successors.get(op.id) || [];
                        const isFinal = succs.length === 0;
                        const ownInventory = meta.ownWip(op.id);
                        const opWipCap = meta.wipCaps.get(op.id) || 15;
                        const downstreamBlocked = succs.some(sId => {
                            if (meta.finalOperationIds.has(sId)) return false;
                            const succCap = meta.wipCaps.get(sId) || 15;
                            return meta.ownWip(sId) >= succCap;
                        });
                        if (downstreamBlocked) continue;
                        if (!isFinal && ownInventory >= opWipCap) continue;

                        const mType = op.machineType.trim();
                        const mUsed = machineUsage.get(mType) || 0;
                        const mTotal = machineCounts[mType] || 1;
                        if (mUsed >= mTotal) continue;

                        const currentColor = style.colorVariant;
                        if (
                            normalizedThreadConstraints &&
                            currentColor &&
                            normalizedThreadConstraints[mType]
                        ) {
                            const threadRule = normalizedThreadConstraints[mType];
                            const threadLimitBalls = meta.threadColorLimitBalls;
                            const threadUsedBalls = threadBallsInUseByColor.get(currentColor) || 0;
                            const threadNeededBalls = threadRule.ballsPerMachine;
                            if (threadUsedBalls + threadNeededBalls > threadLimitBalls) continue;
                        }

                        const deps = meta.effectiveDependencies.get(op.id) || [];
                        let maxInput = meta.inputAvailable(op.id);
                        const leftToMake = meta.remainingTargets.get(op.id) || 0;
                        if (leftToMake <= 0) continue;
                        if (maxInput > leftToMake) maxInput = leftToMake;
                        if (maxInput <= 0 && deps.length > 0) continue;

                        const isWarmup = availableMinutes >= 240 && t < 45;
                        const MIN_BATCH = isWarmup ? 1 : 5;
                        const isEndOfShift = (endCheck - t) < 60;
                        const upstreamFinished = deps.every(dId => (meta.remainingTargets.get(dId) || 0) <= 0);
                        if (maxInput < MIN_BATCH && !isEndOfShift && !upstreamFinished && deps.length) continue;

                        const efficiency =
                            ((user.efficiencyRating || 100) / 100) *
                            getHistoricalMultiplier(historicalPerformance, user.id, op.id);
                        const boundedEfficiency = clamp(efficiency, 0.45, 1.8);
                        const smvMinutes = op.smv / 60;
                        const minutesPerPc = smvMinutes / boundedEfficiency;
                        const targetBatchTime = isWarmup ? 3 : 20;
                        const rawTargetBatch = Math.floor(targetBatchTime / minutesPerPc);
                        const targetPcs = Math.max(isWarmup ? 2 : 10, Math.min(100, rawTargetBatch));
                        const actualPcs = Math.min(maxInput, targetPcs);
                        if (actualPcs <= 0) continue;

                        return true;
                    }
                }
                return false;
            };
            const styleOrder = Array.from({ length: styles.length }, (_, idx) => idx);
            if (preferredColor) {
                const sameColor = styleOrder.filter(idx => (styles[idx].colorVariant || '') === preferredColor);
                if (sameColor.length > 0 && sameColor.length < styleOrder.length) {
                    const others = styleOrder.filter(idx => (styles[idx].colorVariant || '') !== preferredColor);
                    styleOrder.splice(0, styleOrder.length, ...sameColor, ...others);
                }
            }
            const hasPreferredColorFeasibleWork = !!preferredColor && hasFeasibleTaskForColor(preferredColor);
            let userAssigned = false;

            // Try assigning tasks in preferred style order.
            for (const sIdx of styleOrder) {
                const style = styles[sIdx];
                const meta = styleMeta[sIdx];

                // --- ASSIGNMENT LOGIC (Inlined for scope access) ---
                const myAssignments = meta.assignments.filter(a => a.operatorIds.includes(user.id));
                if (myAssignments.length === 0) continue; // Try next style

                let candidates = myAssignments
                    .map(a => style.operations.find(o => o.id === a.operationId))
                    .filter(Boolean) as typeof style.operations;

                // Coarse feasibility penalty: ops that are blocked downstream or
                // already overbuilt sort last (they are also hard-skipped below).
                const getPenalty = (op: typeof style.operations[0]) => {
                    const currentInv = meta.ownWip(op.id);
                    const succs = meta.successors.get(op.id) || [];
                    const isFinal = !meta.successors.has(op.id) || meta.successors.get(op.id)!.length === 0;
                    const opWipCap = meta.wipCaps.get(op.id) || 15;

                    const successorBlocked = succs.some(sId => {
                        if (meta.finalOperationIds.has(sId)) return false;
                        const succCap = meta.wipCaps.get(sId) || 15;
                        return meta.ownWip(sId) >= succCap;
                    });

                    if (successorBlocked) return 2;
                    if (!isFinal && currentInv >= opWipCap) return 1;
                    return 0;
                };

                // Work-share balancing: keep each of an operator's assigned stations
                // progressing toward its solved time-share. This stops a station that
                // feeds a hungry successor (e.g. Waistband -> Buttonhole) from
                // monopolising the operator and starving a terminal station (e.g.
                // Bottom Hem), which previously capped completions.
                const userRatios = meta.targetRatios.get(user.id);
                const userDone = meta.userProcessedCounts.get(user.id);
                const fallbackWeight = candidates.length > 0 ? 1 / candidates.length : 1;
                const doneMinutesFor = (op: typeof style.operations[0]) =>
                    (userDone?.get(op.id) || 0) * (op.smv / 60);
                const totalDoneMinutes = candidates.reduce((sum, op) => sum + doneMinutesFor(op), 0);
                const weightFor = (op: typeof style.operations[0]) => {
                    const w = userRatios?.get(op.id);
                    return (typeof w === 'number' && w > 0) ? w : fallbackWeight;
                };
                // Stickiness bonus (in minutes): only switch off the current station
                // when another is behind by more than the changeover is worth, which
                // keeps the day to a few stable blocks instead of constant thrash.
                const lastOpId = operatorLastOpId.get(user.id);
                const stickBonus = Math.max(10, switchDelay * 2);
                const effectiveDeficit = (op: typeof style.operations[0]) => {
                    const expected = weightFor(op) * totalDoneMinutes;
                    const deficit = expected - doneMinutesFor(op);
                    return deficit + (op.id === lastOpId ? stickBonus : 0);
                };

                candidates.sort((a, b) => {
                    const penA = getPenalty(a);
                    const penB = getPenalty(b);
                    if (penA !== penB) return penA - penB;

                    // Larger deficit = further behind its fair share = work it first.
                    const defA = effectiveDeficit(a);
                    const defB = effectiveDeficit(b);
                    if (defA !== defB) return defB - defA;

                    return style.operations.indexOf(a) - style.operations.indexOf(b);
                });

                let assigned = false;
                for (const op of candidates) {
                    const succs = meta.successors.get(op.id) || [];
                    const isFinal = succs.length === 0;
                    const ownInventory = meta.ownWip(op.id);
                    const opWipCap = meta.wipCaps.get(op.id) || 15;
                    const downstreamBlocked = succs.some(sId => {
                        if (meta.finalOperationIds.has(sId)) return false;
                        const succCap = meta.wipCaps.get(sId) || 15;
                        return meta.ownWip(sId) >= succCap;
                    });

                    // Pull-based flow control:
                    // 1) don't keep feeding downstream stations when they are WIP-saturated
                    // 2) don't overbuild intermediate inventory beyond op-specific cap
                    if (downstreamBlocked) continue;
                    if (!isFinal && ownInventory >= opWipCap) continue;

                    const mType = op.machineType.trim();
                    const mUsed = machineUsage.get(mType) || 0;
                    const mTotal = machineCounts[mType] || 1;
                    if (mUsed >= mTotal) continue;
                    const currentColor = style.colorVariant;
                    const lastColor = operatorLastColor.get(user.id);
                    const isColorSwitch = !!lastColor && !!currentColor && lastColor !== currentColor;
                    if (
                        isColorSwitch &&
                        hasPreferredColorFeasibleWork &&
                        idleMinutes < COLOR_SWITCH_GRACE_MINUTES
                    ) {
                        continue;
                    }
                    if (
                        normalizedThreadConstraints &&
                        currentColor &&
                        normalizedThreadConstraints[mType]
                    ) {
                        const threadRule = normalizedThreadConstraints[mType];
                        const threadLimitBalls = meta.threadColorLimitBalls;
                        const threadUsedBalls = threadBallsInUseByColor.get(currentColor) || 0;
                        const threadNeededBalls = threadRule.ballsPerMachine;
                        if (threadUsedBalls + threadNeededBalls > threadLimitBalls) continue;
                    }

                    const deps = meta.effectiveDependencies.get(op.id) || [];
                    let maxInput = meta.inputAvailable(op.id);
                    const leftToMake = meta.remainingTargets.get(op.id) || 0;
                    if (leftToMake <= 0) continue;
                    if (maxInput > leftToMake) maxInput = leftToMake;
                    if (maxInput <= 0 && deps.length > 0) continue;

                    const isWarmup = availableMinutes >= 240 && t < 45;
                    const MIN_BATCH = isWarmup ? 1 : 5;
                    const isEndOfShift = (endCheck - t) < 60;

                    // Check if upstream operations are finished producing
                    const upstreamFinished = deps.every(dId => (meta.remainingTargets.get(dId) || 0) <= 0);

                    if (maxInput < MIN_BATCH && !isEndOfShift && !upstreamFinished && deps.length) continue;

                    const efficiency =
                        ((user.efficiencyRating || 100) / 100) *
                        getHistoricalMultiplier(historicalPerformance, user.id, op.id);
                    const boundedEfficiency = clamp(efficiency, 0.45, 1.8);
                    const smvMinutes = op.smv / 60; // Treated as minutes directly
                    const minutesPerPc = smvMinutes / boundedEfficiency;

                    const targetBatchTime = isWarmup ? 3 : 20;
                    const rawTargetBatch = Math.floor(targetBatchTime / minutesPerPc);
                    const targetPcs = Math.max(isWarmup ? 2 : 10, Math.min(100, rawTargetBatch));
                    const actualPcs = Math.min(maxInput, targetPcs);
                    if (actualPcs <= 0) continue;

                    // Avoid costly color swaps for very small runs unless we're close to shift end.
                    if (
                        isColorSwitch &&
                        hasPreferredColorFeasibleWork &&
                        actualPcs < MIN_COLOR_SWITCH_BATCH &&
                        !isEndOfShift
                    ) continue;

                    // Reserve target immediately to avoid over-allocation from concurrent claims.
                    const remainingBefore = meta.remainingTargets.get(op.id) || 0;
                    if (remainingBefore <= 0) continue;
                    const reservedPcs = Math.min(actualPcs, remainingBefore);
                    if (reservedPcs <= 0) continue;
                    meta.remainingTargets.set(op.id, Math.max(0, remainingBefore - reservedPcs));

                    // Switch Delay
                    const lastType = operatorLastMachine.get(user.id);
                    const lastOpId = operatorLastOpId.get(user.id);
                    let delay = 0;

                    if (lastType && (lastType !== mType || (lastOpId && lastOpId !== op.id))) {
                        delay = switchDelay;
                    } else if (lastColor && currentColor && lastColor !== currentColor) {
                        delay = switchDelay;
                    }

                    const duration = (reservedPcs * minutesPerPc) + delay;

                    opState.set(user.id, {
                        busyUntil: t + duration,
                        opId: op.id,
                        startTick: t + delay,
                        count: reservedPcs,
                        styleIndex: sIdx,
                        colorVariant: currentColor
                    });

                    machineUsage.set(mType, mUsed + 1);
                    if (
                        normalizedThreadConstraints &&
                        currentColor &&
                        normalizedThreadConstraints[mType]
                    ) {
                        const threadRule = normalizedThreadConstraints[mType];
                        threadBallsInUseByColor.set(
                            currentColor,
                            (threadBallsInUseByColor.get(currentColor) || 0) + threadRule.ballsPerMachine
                        );
                    }
                    operatorLastMachine.set(user.id, mType);
                    operatorLastOpId.set(user.id, op.id);
                    // Note: Color is updated on release to handle delays correctly for next task? 
                    // No, update here too for immediate sequential checks if needed, but standard is on-assign or on-complete.
                    // Doing it on-assign is safer for "current state".
                    if (currentColor) operatorLastColor.set(user.id, currentColor);

                    meta.consumeInput(op.id, reservedPcs);

                    assigned = true;
                    userAssigned = true;
                    const styleTag = sIdx > 0 ? ' (NEXT)' : '';
                    log(`T=${t.toFixed(0)} CLAIM ${user.name} ${mType}. Task: ${op.name} (S${sIdx})${styleTag}. Batch: ${reservedPcs}.`);
                    break;
                }
                if (assigned) break; // Move to next operator
            }

            if (userAssigned) {
                operatorIdleSince.delete(user.id);
            }
        });

        // Loop End Check
        // Are all targets met?
        const allPending = styles.every((s, i) => {
            const meta = styleMeta[i];
            return s.operations.every(op => {
                const rem = meta.remainingTargets.get(op.id) || 0;
                return rem <= 0;
            });
        });

        const allBusy = opState.size > 0;

        if (allPending && !allBusy) {
            log(`SIM FINISHED EARLY at T=${t}. Targets met.`);
            break;
        }
    }

    log(`SIM COMPLETE. Processed ${maxSimulationTicks} ticks.`);
    return { schedule, logs };
};

// Helper: Fluid Capacity Solver (Iterative Balancing)
// Distributes operator time dynamically based on bottlenecks
export const solveFluidCapacity = (
    style: GarmentStyle,
    assignments: { operationId: string, operatorIds: string[] }[],
    operators: Operator[],
    machineCounts: Record<string, number>,
    availableMinutes: number,
    operatorAttendance: Record<string, { startDelay: number; shiftExtension: number }> = {},
    historicalPerformance: HistoricalPerformanceMap = {}
) => {
    // 1. Initialize Weights (Proportional to SMV)
    // Map<OperatorId, Map<OpId, number>> (0.0 to 1.0)
    const opWeights = new Map<string, Map<string, number>>();

    const operatorMinutes = new Map<string, number>();
    operators.forEach(o => {
        operatorMinutes.set(o.id, getOperatorMinutes(availableMinutes, operatorAttendance[o.id]));
    });

    const sharedCapacityShares = new Map<string, Map<string, number>>();
    assignments.forEach(a => {
        const totalCapacity = a.operatorIds.reduce((sum, uid) => {
            return sum + (operatorMinutes.get(uid) || 0);
        }, 0);
        const perOpShares = new Map<string, number>();
        a.operatorIds.forEach(uid => {
            const share = totalCapacity > 0 ? (operatorMinutes.get(uid) || 0) / totalCapacity : 0;
            perOpShares.set(uid, share || 0);
        });
        sharedCapacityShares.set(a.operationId, perOpShares);
    });

    assignments.forEach(a => {
        a.operatorIds.forEach(uid => {
            if (!opWeights.has(uid)) opWeights.set(uid, new Map());
            const op = style.operations.find(o => o.id === a.operationId);
            if (op) {
                const capacityShare = sharedCapacityShares.get(a.operationId)?.get(uid) || 0;
                const perfMultiplier = getHistoricalMultiplier(historicalPerformance, uid, op.id);
                const seedWeight = op.smv * Math.max(0.05, capacityShare) * perfMultiplier;
                opWeights.get(uid)!.set(a.operationId, seedWeight);
            }
        });
    });

    // Normalize initial weights to sum to 1.0 for each operator
    // AND adjust for total capacity contribution
    opWeights.forEach((weights, uid) => {
        const total = Array.from(weights.values()).reduce((a, b) => a + b, 0);
        weights.forEach((v, k) => weights.set(k, total > 0 ? v / total : 0));
    });

    // 2. Iterative Balancing (Fluid Dynamics)
    // We need to balance load based on ACTUAL available minutes.
    // The current logic balances based on 'hCap' which includes minutes, but the *distribution* 
    // of work (weights) is currently just SMV based.
    // If Bob has 2x time, he should get more work if he is shared on an operation.

    // 2. Iterative Balancing (Fluid Dynamics)
    const ITERATIONS = 20;

    for (let i = 0; i < ITERATIONS; i++) {
        // Calculate Current Outputs for all operations based on current weights
        // Temp Map <OpId, Output>
        const currentOutputs = new Map<string, number>();

        style.operations.forEach(op => {
            // Human Capacity (hCap)
            let hCap = 0;
            const assigned = assignments.find(a => a.operationId === op.id);
            assigned?.operatorIds.forEach(uid => {
                const user = operators.find(o => o.id === uid);
                const weight = opWeights.get(uid)?.get(op.id) || 0;

                // Calculate effective available minutes for this user
                const userMinutes = operatorMinutes.get(user?.id || '') || 0;

                if (user && weight > 0) {
                    const learnedSpeed = getHistoricalMultiplier(historicalPerformance, uid, op.id);
                    const effectiveEfficiency = clamp(((user.efficiencyRating || 100) / 100) * learnedSpeed, 0.45, 1.8);
                    // Mins contributed = Avail * Weight
                    // Pcs = Mins / (OpSMV / 60)
                    // console.log(`User ${user.name} Minutes: ${userMinutes}. Weight: ${weight}`);
                    hCap += (effectiveEfficiency * userMinutes * weight) / (op.smv / 60);
                }
            });

            // Machine Capacity (mCap)
            const mCount = machineCounts[op.machineType] || 1;
            const mCap = (mCount * availableMinutes) / (op.smv / 60);

            let output = Math.min(hCap, mCap);

            // EXPERT REFINEMENT: Machine Contention Penalty
            // If utilization due to human demand is high, queueing occurs. (Queue delay factor)
            const util = hCap / (mCap || 1);
            if (util > 0.95) {
                output *= 0.85; // Heavy congestion
            } else if (util > 0.85) {
                output *= 0.95; // Moderate congestion
            }

            currentOutputs.set(op.id, output);
        });

        // Balance Weights per Operator
        opWeights.forEach((weights, uid) => {
            const assignedOpIds = Array.from(weights.keys());
            if (assignedOpIds.length < 2) return; // Single task, can't shift

            // Find their assigned op with Min Output and Max Output
            // We use GLOBAL outputs to guide local decisions for this operator
            let minOpId = assignedOpIds[0];
            let maxOpId = assignedOpIds[0];
            let minVal = currentOutputs.get(minOpId) || 0;
            let maxVal = currentOutputs.get(maxOpId) || 0;

            assignedOpIds.forEach(oid => {
                const v = currentOutputs.get(oid) || 0;
                if (v < minVal) { minVal = v; minOpId = oid; }
                if (v > maxVal) { maxVal = v; maxOpId = oid; }
            });

            // Algorithm: If Max > Min, shift time from Max to Min
            if (minOpId !== maxOpId && maxVal > minVal) {
                const wMax = weights.get(maxOpId)!;
                // Shift a small amount (e.g., 5% of the current weight on the maxOp)
                // This amount is capped to prevent overshooting or negative weights
                const shift = Math.min(0.05, wMax * 0.5); // Shift up to 5% of maxOp's weight, but not more than half

                weights.set(maxOpId, wMax - shift);
                weights.set(minOpId, (weights.get(minOpId)!) + shift);
            }
        });
    }

    // 3. Final Metrics Generation
    const results = new Map<string, { localOutput: number, assignedOps: Operator[], finalWeights: Map<string, number> }>();

    style.operations.forEach(op => {
        let hCap = 0;
        const assignedOps: Operator[] = [];
        const assignment = assignments.find(a => a.operationId === op.id);

        const finalWeights = new Map<string, number>();
        assignment?.operatorIds.forEach(uid => {
            const user = operators.find(o => o.id === uid);
            if (user) {
                assignedOps.push(user);
                const weight = opWeights.get(uid)?.get(op.id) || 0;
                finalWeights.set(uid, weight);

                const userMinutes = operatorMinutes.get(user.id) || 0;
                const learnedSpeed = getHistoricalMultiplier(historicalPerformance, uid, op.id);
                const effectiveEfficiency = clamp(((user.efficiencyRating || 100) / 100) * learnedSpeed, 0.45, 1.8);

                hCap += (effectiveEfficiency * userMinutes * weight) / (op.smv / 60);
            }
        });

        const mCount = machineCounts[op.machineType] || 1;
        const mCap = (mCount * availableMinutes) / (op.smv / 60);

        results.set(op.id, {
            localOutput: Math.min(hCap, mCap),
            assignedOps,
            finalWeights
        });
    });

    return results;
};
