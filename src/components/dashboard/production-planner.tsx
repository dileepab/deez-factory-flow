'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useConfiguration } from '@/firebase/firestore/use-configuration';
import { collection, query, where } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import type { GarmentStyle, Operator, AnyUser, Assignment, ProductionEntry } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { useMachineTypes } from '@/hooks/use-machine-types';
import { Loader2, UserPlus, X, CheckCircle2, AlertCircle, Wand2, ClipboardList, RefreshCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MultiSelect, Option } from '@/components/ui/multi-select';
import { DailyTimeline } from './daily-timeline';
import {
    simulateProductionSchedule,
    solveFluidCapacity,
    unique,
    type HistoricalPerformanceMap,
    type ThreadConstraintConfig
} from '@/lib/simulation-engine';
import { useAuth } from "@/auth-provider";
import { useToast } from "@/hooks/use-toast";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import type { DailyPlan, ScheduleSegment } from "@/lib/types";
import { format, startOfDay, subDays } from "date-fns";
import { Save, CalendarClock } from "lucide-react";

// Helper function to calculate output from simulation event
// Exported for testing
export function calculateOutputFromEvent(
    event: { opId: string; count: number },
    primaryFinalOps: any[],
    nextFinalOps: any[]
): { primary: number; next: number } {
    if (primaryFinalOps.find(f => f.id === event.opId)) {
        return { primary: event.count, next: 0 };
    } else if (nextFinalOps.find(f => f.id === event.opId)) {
        return { primary: 0, next: event.count };
    }
    return { primary: 0, next: 0 };
}

// Helper function to generate operator advice based on task assignments
// Exported for testing
export function generateOperatorAdvice(
    hasMixedStyles: boolean,
    userOps: Array<{ op: any; style: 'primary' | 'next' }>,
    batchStrings: string[]
): { type: 'flow' | 'rotate'; advice: string } {
    if (hasMixedStyles) {
        const primaryTasks = userOps.filter(o => o.style === 'primary').map(o => o.op.name).join(', ');
        return {
            type: 'flow',
            advice: `Transition Required. Complete Primary Style tasks (${primaryTasks}), then switch to Next Style.`
        };
    }

    // Standard Logic for single style multi-task
    const myOpIds = userOps.map(o => o.op.id);
    let hasSelfDependency = false;

    for (const { op } of userOps) {
        if (op.dependencies?.some((d: string) => myOpIds.includes(d))) {
            hasSelfDependency = true;
            break;
        }
    }

    if (hasSelfDependency) {
        const flowSteps = batchStrings.join(' -> ');
        return {
            type: 'flow',
            advice: `Sequential Flow Required. Perform batch: ${flowSteps}. Maintain steady flow to prevent blockage.`
        };
    }

    const batchCycle = batchStrings.join(', then ');
    return {
        type: 'rotate',
        advice: `Split / Rotation Priority. Recommended Batch Cycle: ${batchCycle}.`
    };
}

const SHIFT_START_MINUTES = (7 * 60) + 30;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const parseHourlyRangeMinutes = (range: string | undefined): number => {
    if (!range) return 0;
    const [startStr, endStr] = range.split(' - ');
    if (!startStr || !endStr) return 0;
    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);
    if ([startH, startM, endH, endM].some(v => Number.isNaN(v))) return 0;
    return Math.max(0, ((endH * 60) + endM) - ((startH * 60) + startM));
};

const scaleHistoricalPerformance = (
    base: HistoricalPerformanceMap,
    factor: number
): HistoricalPerformanceMap => {
    const scaled: HistoricalPerformanceMap = {};
    Object.entries(base).forEach(([operatorId, opMap]) => {
        scaled[operatorId] = {};
        Object.entries(opMap).forEach(([opId, multiplier]) => {
            scaled[operatorId][opId] = clamp(multiplier * factor, 0.6, 1.6);
        });
    });
    return scaled;
};

const PLANNING_OBJECTIVE_WEIGHTS = {
    throughput: 100,
    starvation: 28,
    fragmentation: 12,
    shortDuration: 8,
    machineOverflow: 40,
    multitask: 10,
} as const;

const OVERLOCK_MACHINE_TYPE = 'Overlock/Serger';
const getDefaultBallsPerMachine = (machineType: string) =>
    machineType.trim() === OVERLOCK_MACHINE_TYPE ? 5 : 1;

type PlannerScope = 'primary' | 'next';
type PlannerAssignmentScope = {
    style: PlannerScope;
    variantId?: string;
};
type SimulationStyleSlot = {
    source: PlannerScope;
    rootStyleId: string;
    variantId?: string;
    variantColor?: string;
};

const cloneAssignments = (items: Assignment[]): Assignment[] =>
    items.map(item => ({
        operationId: item.operationId,
        operatorIds: [...item.operatorIds],
        ...(item.variantId ? { variantId: item.variantId } : {}),
        ...(item.variantColor ? { variantColor: item.variantColor } : {}),
    }));
const buildStyleVariantOpKey = (
    source: PlannerScope,
    rootStyleId: string,
    variantId: string | undefined,
    operationId: string
) => `${source}::${rootStyleId}::${variantId || '__base'}::${operationId}`;


export function ProductionPlanner(): React.ReactNode {
    const { user } = useAuth();
    const { toast } = useToast();
    const { data: config } = useConfiguration();
    const {
        machineCounts: globalMachineCounts,
        machineThreadBallsPerMachine: globalThreadBallsPerMachine
    } = useMachineTypes();
    const [selectedStyleId, setSelectedStyleId] = useState<string>("");
    const [selectedNextStyleId, setSelectedNextStyleId] = useState<string>(""); // NEW: Next Style
    const [dailyTarget, setDailyTarget] = useState<number>(500);
    const [switchDelay, setSwitchDelay] = useState<number>(2); // Configurable Switch Delay (mins)

    // Initialize Switch Delay from Config
    useEffect(() => {
        if (config?.defaultSwitchDelay !== undefined) {
            setSwitchDelay(config.defaultSwitchDelay);
        }
    }, [config?.defaultSwitchDelay]);

    const [isPublishing, setIsPublishing] = useState(false);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [nextAssignments, setNextAssignments] = useState<Assignment[]>([]); // NEW: Assignments for Next Style
    const [variantAssignments, setVariantAssignments] = useState<Record<string, Assignment[]>>({});
    const [nextVariantAssignments, setNextVariantAssignments] = useState<Record<string, Assignment[]>>({});
    const [planningMode, setPlanningMode] = useState<'target' | 'capacity'>('capacity');
    const [availableOperatorIds, setAvailableOperatorIds] = useState<string[]>([]);
    const [machineCounts, setMachineCounts] = useState<Record<string, number>>({});
    const [enableThreadConstraints, setEnableThreadConstraints] = useState<boolean>(true);
    const [threadInventoryByColor, setThreadInventoryByColor] = useState<Record<string, number>>({});
    const [operatorAttendance, setOperatorAttendance] = useState<Record<string, { startDelay: number, shiftExtension: number }>>({});
    const [shiftStartTime, setShiftStartTime] = useState<string>("07:30");
    const [enableRollingReplan, setEnableRollingReplan] = useState<boolean>(true);
    const [replanIntervalMinutes, setReplanIntervalMinutes] = useState<number>(60);
    const [lastReplanAt, setLastReplanAt] = useState<Date | null>(null);
    const [showExecutionGuide, setShowExecutionGuide] = useState<boolean>(true);

    // Queries
    const stylesQuery = useMemoFirebase(
        () => query(collection(firestore, 'styles'), where('status', '==', 'active')),
        []
    );
    const { data: styles, isLoading: stylesLoading } = useCollection<GarmentStyle>(stylesQuery);

    const operatorsQuery = useMemoFirebase(
        () => query(collection(firestore, 'users'), where('role', '==', 'operator')),
        []
    );
    const { data: allOperators, isLoading: operatorsLoading } = useCollection<AnyUser>(operatorsQuery);

    const todayStart = useMemo(() => startOfDay(new Date()), []);
    const recentStart = useMemo(() => subDays(startOfDay(new Date()), 30), []);

    const todayProductionQuery = useMemoFirebase(
        () => query(collection(firestore, 'production'), where('timestamp', '>=', Timestamp.fromDate(todayStart))),
        [todayStart]
    );
    const { data: todayProductionLogs } = useCollection<ProductionEntry>(todayProductionQuery);

    const historicalProductionQuery = useMemoFirebase(
        () => query(collection(firestore, 'production'), where('timestamp', '>=', Timestamp.fromDate(recentStart))),
        [recentStart]
    );
    const { data: historicalProductionLogs } = useCollection<ProductionEntry>(historicalProductionQuery);

    // Cast to Operator type safely
    const operators = useMemo(() =>
        (allOperators || []).filter(u => u.role === 'operator') as Operator[],
        [allOperators]);

    const selectedStyleRaw = styles?.find(s => s.id === selectedStyleId);
    const selectedNextStyleRaw = styles?.find(s => s.id === selectedNextStyleId); // NEW: Next Style Object

    const completedByStyleAndOp = useMemo(() => {
        const map: Record<string, Record<string, number>> = {};
        (todayProductionLogs || []).forEach(entry => {
            if (!entry.styleId || !entry.operationId) return;
            if (!map[entry.styleId]) map[entry.styleId] = {};
            map[entry.styleId][entry.operationId] = (map[entry.styleId][entry.operationId] || 0) + (entry.cumulativeQuantity || 0);
        });
        return map;
    }, [todayProductionLogs]);

    const applyLiveProgressToStyle = useCallback((style: GarmentStyle | undefined) => {
        if (!style) return undefined;
        const styleProgress = completedByStyleAndOp[style.id] || {};
        return {
            ...style,
            operations: style.operations.map(op => ({
                ...op,
                // Keep persisted cumulative progress as baseline and only elevate with fresh in-day logs.
                completedQuantity: Math.max(op.completedQuantity || 0, styleProgress[op.id] || 0),
            })),
        } satisfies GarmentStyle;
    }, [completedByStyleAndOp]);

    const selectedStyle = useMemo(
        () => applyLiveProgressToStyle(selectedStyleRaw),
        [selectedStyleRaw, applyLiveProgressToStyle]
    );
    const selectedNextStyle = useMemo(
        () => applyLiveProgressToStyle(selectedNextStyleRaw),
        [selectedNextStyleRaw, applyLiveProgressToStyle]
    );

    const activeThreadColors = useMemo(() => {
        const colors: string[] = [];
        const collectColors = (style: GarmentStyle | undefined) => {
            if (!style) return;
            if (style.variants && style.variants.length > 0) {
                style.variants.forEach(variant => {
                    const color = variant.color?.trim();
                    if (color) colors.push(color);
                });
                return;
            }

            const fallbackColor = style.colorVariant?.trim();
            if (fallbackColor) colors.push(fallbackColor);
        };

        collectColors(selectedStyle);
        collectColors(selectedNextStyle);
        return unique(colors);
    }, [selectedStyle, selectedNextStyle]);

    const activeThreadMachineTypes = useMemo(() => {
        const machineTypes = new Set<string>();
        const collectMachineTypes = (style: GarmentStyle | undefined) => {
            if (!style) return;
            style.operations.forEach(op => {
                const type = op.machineType?.trim();
                if (type) machineTypes.add(type);
            });
        };

        collectMachineTypes(selectedStyle);
        collectMachineTypes(selectedNextStyle);
        return Array.from(machineTypes);
    }, [selectedStyle, selectedNextStyle]);

    const defaultThreadBallsByMachine = useMemo(() => {
        const next: Record<string, number> = {};
        activeThreadMachineTypes.forEach(machineType => {
            const configured = globalThreadBallsPerMachine[machineType];
            next[machineType] = Math.max(
                1,
                Math.floor(
                    typeof configured === 'number' && isFinite(configured)
                        ? configured
                        : getDefaultBallsPerMachine(machineType)
                )
            );
        });
        return next;
    }, [activeThreadMachineTypes, globalThreadBallsPerMachine]);

    const defaultThreadColorInventory = useMemo(() => {
        const values = Object.values(defaultThreadBallsByMachine);
        if (values.length === 0) return 1;
        return Math.max(1, ...values);
    }, [defaultThreadBallsByMachine]);

    useEffect(() => {
        if (activeThreadColors.length === 0) {
            setThreadInventoryByColor(prev => (Object.keys(prev).length === 0 ? prev : {}));
            return;
        }

        setThreadInventoryByColor(prev => {
            const next: Record<string, number> = {};
            activeThreadColors.forEach(color => {
                next[color] = Math.max(0, Math.floor(prev[color] ?? defaultThreadColorInventory));
            });

            const prevKeys = Object.keys(prev);
            const nextKeys = Object.keys(next);
            const hasDifferentSize = prevKeys.length !== nextKeys.length;
            const hasDifferentValue = nextKeys.some(key => prev[key] !== next[key]);

            if (!hasDifferentSize && !hasDifferentValue) {
                return prev;
            }
            return next;
        });
    }, [activeThreadColors, defaultThreadColorInventory]);

    const getStyleCompletedUnits = useCallback((style: GarmentStyle | undefined): number => {
        if (!style || !style.operations.length) return 0;
        const deps = new Set(style.operations.flatMap(op => op.dependencies || []));
        const finalOps = style.operations.filter(op => !deps.has(op.id));
        if (finalOps.length === 0) return 0;
        return Math.min(...finalOps.map(op => op.completedQuantity || 0));
    }, []);

    const remainingPrimaryQty = useMemo(() => {
        if (!selectedStyle) return 0;
        const completed = getStyleCompletedUnits(selectedStyle);
        return Math.max(0, (selectedStyle.quantity || 0) - completed);
    }, [selectedStyle, getStyleCompletedUnits]);

    const remainingNextQty = useMemo(() => {
        if (!selectedNextStyle) return 0;
        const completed = getStyleCompletedUnits(selectedNextStyle);
        return Math.max(0, (selectedNextStyle.quantity || 0) - completed);
    }, [selectedNextStyle, getStyleCompletedUnits]);

    const operationSmvIndex = useMemo(() => {
        const index: Record<string, number> = {};
        (styles || []).forEach(style => {
            style.operations.forEach(op => {
                index[op.id] = Number(op.smv) || 0;
            });
        });
        return index;
    }, [styles]);

    const learnedPerformance = useMemo<HistoricalPerformanceMap>(() => {
        type PerfAccumulator = { weightedRatio: number; weight: number };
        const accum: Record<string, Record<string, PerfAccumulator>> = {};

        (historicalProductionLogs || []).forEach(log => {
            const smvSeconds = operationSmvIndex[log.operationId];
            if (!smvSeconds || !log.operatorId || !log.operationId) return;

            const duration = parseHourlyRangeMinutes(log.hourlyRange) || 60;
            const qty = Math.max(0, log.cumulativeQuantity || 0);
            if (duration <= 0 || qty <= 0) return;

            const actualPiecesPerMin = qty / duration;
            const standardPiecesPerMin = 60 / smvSeconds;
            if (standardPiecesPerMin <= 0) return;

            const ratio = clamp(actualPiecesPerMin / standardPiecesPerMin, 0.5, 1.8);
            const weight = Math.max(1, qty);

            if (!accum[log.operatorId]) accum[log.operatorId] = {};
            if (!accum[log.operatorId][log.operationId]) {
                accum[log.operatorId][log.operationId] = { weightedRatio: 0, weight: 0 };
            }

            accum[log.operatorId][log.operationId].weightedRatio += ratio * weight;
            accum[log.operatorId][log.operationId].weight += weight;
        });

        const result: HistoricalPerformanceMap = {};
        Object.entries(accum).forEach(([operatorId, opMap]) => {
            result[operatorId] = {};
            Object.entries(opMap).forEach(([opId, values]) => {
                const avg = values.weight > 0 ? values.weightedRatio / values.weight : 1;
                result[operatorId][opId] = clamp(avg, 0.6, 1.5);
            });
        });

        return result;
    }, [historicalProductionLogs, operationSmvIndex]);

    // Init machine counts when style changes
    // Init machine counts when style changes (Primary OR Next)
    useEffect(() => {
        const types = new Set<string>();
        if (selectedStyle) {
            selectedStyle.operations.forEach(o => types.add(o.machineType.trim()));
        }
        if (selectedNextStyle) {
            selectedNextStyle.operations.forEach(o => types.add(o.machineType.trim()));
        }

        if (types.size > 0) {
            setMachineCounts(prev => {
                const next = { ...prev };
                types.forEach(t => {
                    // Always try to use global count first, defaulting to 5
                    // We only want to keep 'prev' if it was explicitly user-set in this session, 
                    // but we don't track that easily. 
                    // Better approach: Sync with global settings unless we want to support temporary overrides?
                    // User expectation is "Settings -> Planner". 
                    // So we should update 'next[t]' to global count if the global count exists or if it's a new entry.
                    // However, if the user manually changed it in the Planner UI *before* we simulate, do we want to overwrite?
                    // Given the bug, let's prioritize Global Settings.

                    // Logic: If 'globalMachineCounts' has a value, use it. Else use 5.
                    // What if the user wants to override temporarily? 
                    // The UI for "Machine Inventory (Constraints)" uses 'machineCounts' state.
                    // If we overwrite it here on every render where style/global changes, it might be annoying if they are typing.
                    // But this effect only runs on [selectedStyle, selectedNextStyle, globalMachineCounts].
                    // So it should be safe to sync.

                    // Actually, 'globalMachineCounts' needs to be in dependency array for this to auto-update.
                    // I'll add it.

                    const globalCount = globalMachineCounts?.[t];
                    if (globalCount !== undefined) {
                        next[t] = globalCount;
                    } else if (next[t] === undefined) {
                        next[t] = 5;
                    }
                });
                return next;
            });
        }
    }, [selectedStyle?.id, selectedNextStyle?.id, globalMachineCounts]);
    const availableMinutes = config?.availableMinutesPerDay || 480;

    // Init availableOperatorIds
    useEffect(() => {
        if (operators?.length && availableOperatorIds.length === 0) {
            setAvailableOperatorIds(operators.map(o => o.id));
        }
    }, [operators, availableOperatorIds]);

    // Recalculate target based on capacity
    useEffect(() => {
        if (planningMode === 'capacity' && selectedStyle && selectedStyle.totalSmv > 0) {
            // Target = (Operators * Mins) / TotalSMV
            const count = availableOperatorIds.length;
            const calculatedTarget = (count * availableMinutes) / selectedStyle.totalSmv;
            const remainingOrders = selectedNextStyle
                ? remainingPrimaryQty + remainingNextQty
                : remainingPrimaryQty;
            const hasOrderBound = (selectedStyle.quantity || 0) > 0 || (selectedNextStyle?.quantity || 0) > 0;
            const boundedTarget = hasOrderBound
                ? Math.min(calculatedTarget, Math.max(0, remainingOrders))
                : calculatedTarget;

            setDailyTarget(Math.max(0, Math.floor(boundedTarget)));
        }
    }, [
        planningMode,
        availableOperatorIds,
        selectedStyle,
        selectedNextStyle,
        availableMinutes,
        remainingPrimaryQty,
        remainingNextQty
    ]);

    // Clear assignments when style changes
    useEffect(() => {
        setAssignments([]);
        setVariantAssignments({});
    }, [selectedStyle?.id]);

    useEffect(() => {
        setNextAssignments([]);
        setNextVariantAssignments({});
    }, [selectedNextStyle?.id]);

    // Memoize operator loads for calculations
    const operatorLoads = useMemo(() => {
        const loads: Record<string, number> = {};
        assignments.forEach(a => {
            a.operatorIds.forEach(id => {
                loads[id] = (loads[id] || 0) + 1;
            });
        });
        return loads;
    }, [assignments]);

    // Helper: Auto Assign (Fluid Capacity Solver + Hill Climbing)
    // Helper: Compute Assignments for a given style (Refactored for reuse)
    const computeAssignments = (targetStyle: GarmentStyle): Assignment[] => {
        // Init Assignments
        const newAssignments = new Map<string, string[]>();
        targetStyle.operations.forEach(op => newAssignments.set(op.id, []));

        const candidatesPool = operators.filter(o => availableOperatorIds.includes(o.id));
        const MAX_LOAD = 3;
        const getLoad = (map: Map<string, string[]>, id: string) => {
            let load = 0;
            map.forEach(ids => { if (ids.includes(id)) load++; });
            return load;
        };

        // Phase 1: Coverage (Greedy)
        targetStyle.operations.forEach(op => {
            const candidates = candidatesPool
                .filter(o => o.skills?.includes(op.machineType.trim() as any)) // Use trimmed match
                .filter(o => getLoad(newAssignments, o.id) < MAX_LOAD)
                .sort((a, b) => {
                    const aScore = (a.efficiencyRating || 100) * (learnedPerformance[a.id]?.[op.id] || 1);
                    const bScore = (b.efficiencyRating || 100) * (learnedPerformance[b.id]?.[op.id] || 1);
                    return bScore - aScore;
                });

            if (candidates.length > 0) {
                const best = candidates[0];
                const list = newAssignments.get(op.id) || [];
                newAssignments.set(op.id, [...list, best.id]);
            }
        });

        // Helper to Calc Global Min (Flow Aware + Fluid Output)
        const calcGlobalMin = (assignMap: Map<string, string[]>) => {
            const assignArray = Array.from(assignMap.entries()).map(([k, v]) => ({ operationId: k, operatorIds: v }));
            const solved = solveFluidCapacity(
                targetStyle,
                assignArray,
                operators,
                machineCounts,
                availableMinutes
            );

            // Dependence Prop
            const metrics = new Map<string, { effective: number, local: number }>();

            // 1. Local
            targetStyle.operations.forEach(op => {
                const res = solved.get(op.id);
                metrics.set(op.id, { effective: res?.localOutput || 0, local: res?.localOutput || 0 });
            });

            // 2. Propagate (Simple Loop)
            for (let k = 0; k < 3; k++) {
                targetStyle.operations.forEach(op => {
                    const local = metrics.get(op.id)?.local || 0;
                    if (op.dependencies?.length > 0) {
                        const upstreams = op.dependencies.map(d => metrics.get(d)?.effective ?? Infinity);
                        const limit = Math.min(...upstreams);
                        metrics.set(op.id, { local, effective: Math.min(local, limit) });
                    }
                });
            }

            // Find Min Effective
            let min = Infinity;
            let botId = null;
            targetStyle.operations.forEach(op => {
                const eff = metrics.get(op.id)?.effective || 0;
                if (eff < min) { min = eff; botId = op.id; }
            });

            // "Fragmentation Penalty"
            let fragmentationPenalty = 0;
            const opLoads = new Map<string, number>();
            assignMap.forEach(ids => ids.forEach(uid => opLoads.set(uid, (opLoads.get(uid) || 0) + 1)));

            opLoads.forEach(count => {
                if (count > 1) {
                    fragmentationPenalty += (count - 1) * 0.25;
                }
            });
            let multitaskPenalty = 0;
            opLoads.forEach(count => {
                if (count > 2) {
                    multitaskPenalty += count - 2;
                }
            });

            // MIN DURATION PENALTY (< 30 mins)
            let minDurationPenalties = 0;
            const MN_MIN = 45;

            targetStyle.operations.forEach(op => {
                const res = solved.get(op.id);
                if (res && res.finalWeights) {
                    res.finalWeights.forEach((weight, uid) => {
                        const mins = weight * availableMinutes;
                        if (mins > 0.01 && mins < MN_MIN) {
                            minDurationPenalties++;
                        }
                    });
                }
            });

            // MACHINE SHARING PENALTY
            let machineOverflowPenalty = 0;
            targetStyle.operations.forEach(op => {
                const assignedCount = assignMap.get(op.id)?.length || 0;
                const mCount = machineCounts[op.machineType] || 1;
                if (assignedCount > mCount) {
                    machineOverflowPenalty += (assignedCount - mCount);
                }
            });

            let starvationPenalty = 0;
            metrics.forEach(({ effective, local }) => {
                starvationPenalty += Math.max(0, local - effective);
            });

            const throughputScore = min;
            const score =
                (throughputScore * PLANNING_OBJECTIVE_WEIGHTS.throughput) -
                (starvationPenalty * PLANNING_OBJECTIVE_WEIGHTS.starvation) -
                (fragmentationPenalty * PLANNING_OBJECTIVE_WEIGHTS.fragmentation) -
                (minDurationPenalties * PLANNING_OBJECTIVE_WEIGHTS.shortDuration) -
                (machineOverflowPenalty * PLANNING_OBJECTIVE_WEIGHTS.machineOverflow) -
                (multitaskPenalty * PLANNING_OBJECTIVE_WEIGHTS.multitask);

            return { min, score, botId, metrics };
        };

        // Phase 2: Hill Climbing
        let iterations = 0;
        const maxIterations = targetStyle.operations.length * 4;

        while (iterations < maxIterations) {
            iterations++;
            const { min: currentGlobalMin, score: currentScore, botId: bottleneckOpId } = calcGlobalMin(newAssignments);

            if (!bottleneckOpId) break;
            const bottleneckOp = targetStyle.operations.find(o => o.id === bottleneckOpId)!;

            const mCount = machineCounts[bottleneckOp.machineType] || 1;
            const mCap = (mCount * availableMinutes) / (bottleneckOp.smv / 60);
            if (currentGlobalMin >= mCap - 0.1) break;

            const currentAssignedCount = newAssignments.get(bottleneckOpId)?.length || 0;
            const isHeadcountCapped = currentAssignedCount >= mCount * 2; // Strict cap

            let bestMove = null;
            let bestNewScore = currentScore;
            let bestHarvest: { addOpId: string, addUser: string } | null = null;
            let bestSwap: { opId: string, add: string, remove: string } | null = null;

            const currentLoads = new Map<string, number>();
            candidatesPool.forEach(o => currentLoads.set(o.id, getLoad(newAssignments, o.id)));

            // 3. Direct Add
            if (!isHeadcountCapped) {
                const candidates = candidatesPool
                    .filter(o => o.skills?.includes(bottleneckOp.machineType))
                    .filter(o => (currentLoads.get(o.id) || 0) < MAX_LOAD)
                    .filter(o => !(newAssignments.get(bottleneckOpId!)?.includes(o.id)));

                for (const candidate of candidates) {
                    const simMap = new Map<string, string[]>();
                    newAssignments.forEach((v, k) => simMap.set(k, [...v]));
                    simMap.set(bottleneckOpId, [...(simMap.get(bottleneckOpId) || []), candidate.id]);

                    const { score } = calcGlobalMin(simMap);
                    if (score > bestNewScore) {
                        bestNewScore = score;
                        bestMove = candidate.id;
                    }
                }
            }

            // 4. Swap/Offload
            if (!bestMove) {
                const bottleneckOperators = operators.filter(o => newAssignments.get(bottleneckOpId)?.includes(o.id));
                for (const botOp of bottleneckOperators) {
                    if (currentLoads.get(botOp.id)! <= 1) continue;

                    const otherOpIds = Array.from(newAssignments.entries())
                        .filter(([opId, users]) => opId !== bottleneckOpId && users.includes(botOp.id))
                        .map(([opId]) => opId);

                    for (const otherOpId of otherOpIds) {
                        const otherOp = targetStyle.operations.find(o => o.id === otherOpId)!;
                        const swapCandidates = candidatesPool
                            .filter(o => o.id !== botOp.id)
                            .filter(o => o.skills?.includes(otherOp.machineType))
                            .filter(o => (currentLoads.get(o.id) || 0) < MAX_LOAD)
                            .filter(o => !(newAssignments.get(otherOpId)?.includes(o.id)));

                        for (const candidate of swapCandidates) {
                            const simMap = new Map<string, string[]>();
                            newAssignments.forEach((v, k) => simMap.set(k, [...v]));
                            // Add replacer
                            simMap.set(otherOpId, [...(simMap.get(otherOpId) || []), candidate.id]);
                            // Remove bottleneck op from OTHER task
                            simMap.set(otherOpId, simMap.get(otherOpId)!.filter(id => id !== botOp.id));

                            const { score } = calcGlobalMin(simMap);
                            if (score > bestNewScore) {
                                bestNewScore = score;
                                bestSwap = { opId: otherOpId, add: candidate.id, remove: botOp.id };
                            }
                        }
                    }
                }
            }

            // 5. Steal (Reallocate from non-bottleneck)
            let bestSteal: { opId: string, add: string, removeOpFrom: string } | null = null;
            if (!bestMove && !bestSwap && !isHeadcountCapped) {
                const strongCandidates = candidatesPool
                    .filter(o => o.skills?.includes(bottleneckOp.machineType))
                    .filter(o => (currentLoads.get(o.id) || 0) >= MAX_LOAD)
                    .filter(o => !(newAssignments.get(bottleneckOpId!)?.includes(o.id)));

                for (const candidate of strongCandidates) {
                    const currentAssignments = Array.from(newAssignments.entries())
                        .filter(([k, v]) => v.includes(candidate.id) && k !== bottleneckOpId);

                    for (const [sourceOpId] of currentAssignments) {
                        const simMap = new Map<string, string[]>();
                        newAssignments.forEach((v, k) => simMap.set(k, [...v]));

                        simMap.set(sourceOpId, simMap.get(sourceOpId)!.filter(id => id !== candidate.id));
                        simMap.set(bottleneckOpId, [...(simMap.get(bottleneckOpId) || []), candidate.id]);

                        const { score } = calcGlobalMin(simMap);
                        if (score > bestNewScore) {
                            bestNewScore = score;
                            bestSteal = { opId: bottleneckOpId, add: candidate.id, removeOpFrom: sourceOpId };
                        }
                    }
                }
            }

            if (bestMove) {
                const list = newAssignments.get(bottleneckOpId) || [];
                newAssignments.set(bottleneckOpId, [...list, bestMove]);
            } else if (bestSwap) {
                const list = newAssignments.get(bestSwap.opId) || [];
                newAssignments.set(bestSwap.opId, [...list, bestSwap.add]);
                const reducedList = newAssignments.get(bestSwap.opId)!.filter(id => id !== bestSwap.remove);
                newAssignments.set(bestSwap.opId, reducedList);
            } else if (bestSteal) {
                const sourceList = newAssignments.get(bestSteal.removeOpFrom) || [];
                newAssignments.set(bestSteal.removeOpFrom, sourceList.filter(id => id !== bestSteal.add));
                const targetList = newAssignments.get(bestSteal.opId) || [];
                newAssignments.set(bestSteal.opId, [...targetList, bestSteal.add]);
            } else {
                // 6. Focus (Shed non-bottleneck tasks without replacement)
                let bestFocus: { removeOpId: string, removeUser: string } | null = null;
                const bottleneckOperators = operators.filter(o => newAssignments.get(bottleneckOpId)?.includes(o.id));
                for (const botOp of bottleneckOperators) {
                    const otherAssignments = Array.from(newAssignments.entries())
                        .filter(([k, v]) => v.includes(botOp.id) && k !== bottleneckOpId);
                    for (const [otherOpId] of otherAssignments) {
                        const simMap = new Map<string, string[]>();
                        newAssignments.forEach((v, k) => simMap.set(k, [...v]));
                        simMap.set(otherOpId, simMap.get(otherOpId)!.filter(id => id !== botOp.id));
                        const { score } = calcGlobalMin(simMap);
                        if (score > bestNewScore) {
                            bestNewScore = score;
                            bestFocus = { removeOpId: otherOpId, removeUser: botOp.id };
                        }
                    }
                }

                if (bestFocus) {
                    const list = newAssignments.get(bestFocus.removeOpId) || [];
                    newAssignments.set(bestFocus.removeOpId, list.filter(id => id !== bestFocus.removeUser));
                } else {
                    // 7. Prune ... 
                    let bestPrune: { opId: string, removeUser: string } | null = null;
                    const allOps = Array.from(newAssignments.keys());
                    for (const opId of allOps) {
                        const users = newAssignments.get(opId) || [];
                        if (users.length <= 1) continue;
                        for (const uid of users) {
                            const simMap = new Map<string, string[]>();
                            newAssignments.forEach((v, k) => simMap.set(k, [...v]));
                            simMap.set(opId, simMap.get(opId)!.filter(id => id !== uid));
                            const { score } = calcGlobalMin(simMap);
                            if (score > bestNewScore) {
                                bestNewScore = score;
                                bestPrune = { opId, removeUser: uid };
                            }
                        }
                    }

                    if (bestPrune) {
                        const list = newAssignments.get(bestPrune.opId) || [];
                        newAssignments.set(bestPrune.opId, list.filter(id => id !== bestPrune.removeUser));
                    } else {
                        // 8. Deconflict
                        let bestDeconflict: { opId: string, removeUser: string } | null = null;
                        const criticalUsers = new Set<string>();
                        newAssignments.forEach((users, opId) => { if (users.length === 1) criticalUsers.add(users[0]); });
                        for (const critUid of criticalUsers) {
                            const sharedOps = Array.from(newAssignments.entries()).filter(([k, v]) => v.includes(critUid) && v.length > 1).map(([k]) => k);
                            for (const opId of sharedOps) {
                                const simMap = new Map<string, string[]>();
                                newAssignments.forEach((v, k) => simMap.set(k, [...v]));
                                simMap.set(opId, simMap.get(opId)!.filter(id => id !== critUid));
                                const { score } = calcGlobalMin(simMap);
                                const biasedScore = score + 0.5;
                                if (biasedScore > bestNewScore) {
                                    bestNewScore = biasedScore;
                                    bestDeconflict = { opId, removeUser: critUid };
                                }
                            }
                        }

                        if (bestDeconflict) {
                            const list = newAssignments.get(bestDeconflict.opId) || [];
                            newAssignments.set(bestDeconflict.opId, list.filter(id => id !== bestDeconflict.removeUser));
                        } else {
                            // 9. Swap-Clean
                            let bestSwapClean: { removeOpId: string, removeUser: string, addOpId: string } | null = null;
                            const violatedOps = targetStyle.operations.filter(op => {
                                const count = newAssignments.get(op.id)?.length || 0;
                                const mCount = machineCounts[op.machineType] || 1;
                                return count > mCount;
                            });
                            for (const op of violatedOps) {
                                const users = newAssignments.get(op.id) || [];
                                for (const uid of users) {
                                    const userObj = operators.find(u => u.id === uid);
                                    if (!userObj) continue;
                                    const possibleMoves = targetStyle.operations.filter(o => o.id !== op.id && userObj.skills?.includes(o.machineType) && !(newAssignments.get(o.id)?.includes(uid)));
                                    for (const moveOp of possibleMoves) {
                                        const simMap = new Map<string, string[]>();
                                        newAssignments.forEach((v, k) => simMap.set(k, [...v]));
                                        simMap.set(op.id, simMap.get(op.id)!.filter(id => id !== uid));
                                        simMap.set(moveOp.id, [...(simMap.get(moveOp.id) || []), uid]);
                                        const { score } = calcGlobalMin(simMap);
                                        if (score > bestNewScore) {
                                            bestNewScore = score;
                                            bestSwapClean = { removeOpId: op.id, removeUser: uid, addOpId: moveOp.id };
                                        }
                                    }
                                }
                            }

                            if (bestSwapClean) {
                                const list = newAssignments.get(bestSwapClean.removeOpId) || [];
                                newAssignments.set(bestSwapClean.removeOpId, list.filter(id => id !== bestSwapClean.removeUser));
                                const targetList = newAssignments.get(bestSwapClean.addOpId) || [];
                                newAssignments.set(bestSwapClean.addOpId, [...targetList, bestSwapClean.removeUser]);
                            } else {
                                // 10. Harvest Starvation
                                const { botId, metrics } = calcGlobalMin(newAssignments);
                                const starvedOps = targetStyle.operations.filter(op => {
                                    const m = metrics.get(op.id);
                                    return m && m.effective < m.local * 0.9;
                                });
                                if (botId) {
                                    const targetOp = targetStyle.operations.find(o => o.id === botId);
                                    if (targetOp && starvedOps.length > 0) {
                                        for (const sOp of starvedOps) {
                                            const users = newAssignments.get(sOp.id) || [];
                                            for (const uid of users) {
                                                const userObj = operators.find(o => o.id === uid);
                                                if (userObj && userObj.skills?.includes(targetOp.machineType) && !(newAssignments.get(targetOp.id)?.includes(uid))) {
                                                    const simMap = new Map<string, string[]>();
                                                    newAssignments.forEach((v, k) => simMap.set(k, [...v]));
                                                    simMap.set(targetOp.id, [...(simMap.get(targetOp.id) || []), uid]);
                                                    const { score } = calcGlobalMin(simMap);
                                                    if (score > bestNewScore) {
                                                        bestNewScore = score;
                                                        bestHarvest = { addOpId: targetOp.id, addUser: uid };
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                if (bestHarvest) {
                                    const list = newAssignments.get(bestHarvest.addOpId) || [];
                                    newAssignments.set(bestHarvest.addOpId, [...list, bestHarvest.addUser]);
                                } else {
                                    break; // END OF HILL CLIMBING
                                }
                            }
                        }
                    }
                }
            }
        }

        // Phase 3: Utilization (Assign idle operators to best fit)
        candidatesPool.forEach(candidate => {
            if (getLoad(newAssignments, candidate.id) === 0) {
                const skilledOps = targetStyle.operations
                    .filter(op => candidate.skills?.includes(op.machineType))
                    .sort((a, b) => b.smv - a.smv);

                for (const targetOp of skilledOps) {
                    const currentAssigned = newAssignments.get(targetOp.id)?.length || 0;
                    const mCount = machineCounts[targetOp.machineType] || 1;

                    if (currentAssigned < mCount) {
                        const list = newAssignments.get(targetOp.id) || [];
                        newAssignments.set(targetOp.id, [...list, candidate.id]);
                        break;
                    }
                }
            }
        });

        // Phase 4: Cleanup
        const cleanupAssignArr = Array.from(newAssignments.entries()).map(([k, v]) => ({ operationId: k, operatorIds: v }));
        const cleanupSolved = solveFluidCapacity(
            targetStyle,
            cleanupAssignArr,
            operators,
            machineCounts,
            availableMinutes
        );

        cleanupSolved.forEach((res, opId) => {
            res.finalWeights.forEach((weight, uid) => {
                if (weight < 0.15 && (newAssignments.get(opId)?.length || 0) > 1) {
                    const list = newAssignments.get(opId) || [];
                    newAssignments.set(opId, list.filter(id => id !== uid));
                }
            });
        });

        return Array.from(newAssignments.entries()).map(([opId, ids]) => ({
            operationId: opId,
            operatorIds: ids
        })).filter(a => a.operatorIds.length > 0);
    };

    const buildVariantAssignmentMap = useCallback((style: GarmentStyle, baseAssigns: Assignment[]) => {
        if (!style.variants || style.variants.length === 0) return {};
        const map: Record<string, Assignment[]> = {};
        style.variants.forEach(variant => {
            map[variant.id] = cloneAssignments(baseAssigns).map(assignment => ({
                ...assignment,
                variantId: variant.id,
                variantColor: variant.color,
            }));
        });
        return map;
    }, []);

    const upsertOperatorInAssignmentList = useCallback((
        list: Assignment[],
        opId: string,
        operatorId: string,
        variantId?: string,
        variantColor?: string
    ) => {
        const existing = list.find(a => a.operationId === opId);
        if (existing) {
            if (existing.operatorIds.includes(operatorId)) return list;
            return list.map(a => a.operationId === opId ? { ...a, operatorIds: [...a.operatorIds, operatorId] } : a);
        }
        return [
            ...list,
            {
                operationId: opId,
                operatorIds: [operatorId],
                ...(variantId ? { variantId } : {}),
                ...(variantColor ? { variantColor } : {}),
            }
        ];
    }, []);

    const removeOperatorFromAssignmentList = useCallback((list: Assignment[], opId: string, operatorId: string) => {
        return list
            .map(a => {
                if (a.operationId === opId) {
                    return { ...a, operatorIds: a.operatorIds.filter(id => id !== operatorId) };
                }
                return a;
            })
            .filter(a => a.operatorIds.length > 0);
    }, []);

    const getAssignmentListForScope = useCallback((scope: PlannerAssignmentScope): Assignment[] => {
        if (scope.style === 'next') {
            if (scope.variantId) return nextVariantAssignments[scope.variantId] || [];
            return nextAssignments;
        }
        if (scope.variantId) return variantAssignments[scope.variantId] || [];
        return assignments;
    }, [assignments, nextAssignments, variantAssignments, nextVariantAssignments]);

    // Actual Auto Assign Handler
    const handleAutoAssign = useCallback(() => {
        if (selectedStyle) {
            const computed = computeAssignments(selectedStyle);
            setAssignments(computed);
            setVariantAssignments(buildVariantAssignmentMap(selectedStyle, computed));
        }
        if (selectedNextStyle) {
            const computed = computeAssignments(selectedNextStyle);
            setNextAssignments(computed);
            setNextVariantAssignments(buildVariantAssignmentMap(selectedNextStyle, computed));
        }
    }, [
        selectedStyle,
        selectedNextStyle,
        operators,
        availableOperatorIds,
        machineCounts,
        availableMinutes,
        operatorAttendance,
        learnedPerformance,
        buildVariantAssignmentMap
    ]);

    useEffect(() => {
        if (!enableRollingReplan || !selectedStyle) return;
        const intervalMinutes = clamp(replanIntervalMinutes, 30, 180);
        const timer = window.setInterval(() => {
            handleAutoAssign();
            setLastReplanAt(new Date());
        }, intervalMinutes * 60 * 1000);

        return () => window.clearInterval(timer);
    }, [enableRollingReplan, replanIntervalMinutes, handleAutoAssign, selectedStyle?.id, selectedNextStyle?.id]);

    // Helper: Assign Operator (Supports style + variant scope)
    const handleAssignOperator = (
        opId: string,
        operatorId: string,
        scope: PlannerAssignmentScope,
        variantColor?: string
    ) => {
        if (scope.style === 'next') {
            if (scope.variantId) {
                setNextVariantAssignments(prev => {
                    const current = prev[scope.variantId!] || [];
                    const updated = upsertOperatorInAssignmentList(current, opId, operatorId, scope.variantId, variantColor);
                    return { ...prev, [scope.variantId!]: updated };
                });
                return;
            }
            setNextAssignments(prev => upsertOperatorInAssignmentList(prev, opId, operatorId));
            return;
        }

        if (scope.variantId) {
            setVariantAssignments(prev => {
                const current = prev[scope.variantId!] || [];
                const updated = upsertOperatorInAssignmentList(current, opId, operatorId, scope.variantId, variantColor);
                return { ...prev, [scope.variantId!]: updated };
            });
            return;
        }
        setAssignments(prev => upsertOperatorInAssignmentList(prev, opId, operatorId));
    };

    // Helper: Remove Operator
    const handleRemoveOperator = (opId: string, operatorId: string, scope: PlannerAssignmentScope) => {
        if (scope.style === 'next') {
            if (scope.variantId) {
                setNextVariantAssignments(prev => {
                    const current = prev[scope.variantId!] || [];
                    const updated = removeOperatorFromAssignmentList(current, opId, operatorId);
                    return { ...prev, [scope.variantId!]: updated };
                });
                return;
            }
            setNextAssignments(prev => removeOperatorFromAssignmentList(prev, opId, operatorId));
            return;
        }

        if (scope.variantId) {
            setVariantAssignments(prev => {
                const current = prev[scope.variantId!] || [];
                const updated = removeOperatorFromAssignmentList(current, opId, operatorId);
                return { ...prev, [scope.variantId!]: updated };
            });
            return;
        }
        setAssignments(prev => removeOperatorFromAssignmentList(prev, opId, operatorId));
    };

    // Get assigned operators object for an operation + optional variant scope
    const getAssignedOperators = (opId: string, scope: PlannerAssignmentScope) => {
        const targetList = getAssignmentListForScope(scope);
        const assignment = targetList.find(a => a.operationId === opId);
        if (!assignment) return [];
        return assignment.operatorIds.map(id => operators.find(o => o.id === id)).filter(Boolean) as Operator[];
    };

    const allPlannerAssignments = useMemo(() => {
        return [
            ...assignments,
            ...Object.values(variantAssignments).flat(),
            ...nextAssignments,
            ...Object.values(nextVariantAssignments).flat()
        ];
    }, [assignments, variantAssignments, nextAssignments, nextVariantAssignments]);

    const handlePublishSchedule = async () => {
        if (!simResult || !simResult.schedule) return;
        setIsPublishing(true);
        try {
            const todayStr = format(new Date(), 'yyyy-MM-dd');
            const planRef = doc(firestore, 'daily_plans', todayStr);

            const planData: DailyPlan = {
                date: Timestamp.now(),
                publishedBy: user?.uid || 'unknown',
                publishedAt: Timestamp.now(),
                styleId: selectedStyleId,
                ...(selectedNextStyleId && { nextStyleId: selectedNextStyleId }),
                assignments: allPlannerAssignments,
                schedules: simResult.schedule as unknown as Record<string, ScheduleSegment[]>
            };


            await setDoc(planRef, planData);

            toast({
                title: "Schedule Published",
                description: `Production plan for ${todayStr} has been published to all operators.`,
            });
        } catch (error) {
            console.error("Error publishing schedule:", error);
            toast({
                title: "Error",
                description: "Failed to publish schedule. Please try again.",
                variant: "destructive"
            });
        } finally {
            setIsPublishing(false);
        }
    };

    // Calculate Flow Metrics (Local + Upstream Constraints)
    const calculateMetrics = (
        style: GarmentStyle | undefined,
        assigns: Assignment[]
    ) => {
        if (!style) return {};

        // Use Fluid Solver to distribute operator capacity
        const solved = solveFluidCapacity(
            style,
            assigns,
            operators,
            machineCounts,
            availableMinutes
        );

        const metrics: Record<string, {
            localCapacity: number;
            upstreamLimit: number;
            effectiveOutput: number;
            isStarved: boolean;
            assignedOps: Operator[];
            percentFilled: number;
            reqOperators: number;
            operatorWeights: Map<string, number>;
        }> = {};

        style.operations.forEach(op => {
            const res = solved.get(op.id);
            const localOutput = res?.localOutput || 0;
            const reqOps = (dailyTarget * (op.smv / 60)) / availableMinutes;
            const pct = (localOutput / dailyTarget) * 100;

            metrics[op.id] = {
                localCapacity: localOutput,
                upstreamLimit: Infinity,
                effectiveOutput: localOutput,
                isStarved: false,
                assignedOps: res?.assignedOps || [],
                percentFilled: pct,
                reqOperators: reqOps,
                operatorWeights: res?.finalWeights || new Map()
            };
        });

        // 2. Propagate Dependency Flow
        style.operations.forEach(op => {
            if (op.dependencies && op.dependencies.length > 0) {
                const upstreamOutputs = op.dependencies.map(depId => metrics[depId]?.effectiveOutput ?? Infinity);
                const limit = Math.min(...upstreamOutputs);

                metrics[op.id].upstreamLimit = limit;
                if (limit < metrics[op.id].localCapacity) {
                    metrics[op.id].effectiveOutput = limit;
                    metrics[op.id].isStarved = true;
                }
            }
        });

        return metrics;
    };

    const flowMetrics = useMemo(
        () => calculateMetrics(selectedStyle, assignments),
        [selectedStyle, assignments, machineCounts, dailyTarget, availableMinutes, operators, operatorAttendance, learnedPerformance]
    );
    const nextFlowMetrics = useMemo(
        () => calculateMetrics(selectedNextStyle, nextAssignments),
        [selectedNextStyle, nextAssignments, machineCounts, dailyTarget, availableMinutes, operators, operatorAttendance, learnedPerformance]
    );

    const hasAnyScopedAssignments = useCallback(
        (baseAssigns: Assignment[], byVariant: Record<string, Assignment[]>) => {
            if (baseAssigns.length > 0) return true;
            return Object.values(byVariant).some(items => items.length > 0);
        },
        []
    );

    const buildSimulationInputs = useCallback((
        primaryStyle: GarmentStyle,
        primaryAssignments: Assignment[],
        primaryVariantAssignments: Record<string, Assignment[]>,
        nextStyle?: GarmentStyle,
        nextStyleAssignments: Assignment[] = [],
        nextStyleVariantAssignments: Record<string, Assignment[]> = {}
    ) => {
        const simulationStyles: GarmentStyle[] = [];
        const simulationAssignments: Assignment[][] = [];
        const styleSlots: SimulationStyleSlot[] = [];
        const scalingFactor = 1;

        const toSimulationAssignmentList = (items: Assignment[]) => (
            items.map(item => ({
                operationId: item.operationId,
                operatorIds: [...item.operatorIds]
            }))
        );

        const addStyle = (
            source: PlannerScope,
            base: GarmentStyle,
            baseAssigns: Assignment[],
            byVariantAssigns: Record<string, Assignment[]>
        ) => {
            if (base.variants && base.variants.length > 0) {
                base.variants.forEach(variant => {
                    simulationStyles.push({
                        ...base,
                        id: `${base.id}_${variant.id}`,
                        name: `${base.name} - ${variant.color}`,
                        colorVariant: variant.color,
                        quantity: Math.ceil(variant.quantity * scalingFactor),
                    });

                    const scopedAssigns = byVariantAssigns[variant.id]?.length
                        ? byVariantAssigns[variant.id]
                        : baseAssigns;
                    simulationAssignments.push(toSimulationAssignmentList(scopedAssigns));
                    styleSlots.push({
                        source,
                        rootStyleId: base.id,
                        variantId: variant.id,
                        variantColor: variant.color,
                    });
                });
                return;
            }

            simulationStyles.push({
                ...base,
                quantity: Math.ceil((base.quantity || 1000) * scalingFactor)
            });
            simulationAssignments.push(toSimulationAssignmentList(baseAssigns));
            styleSlots.push({
                source,
                rootStyleId: base.id,
                variantColor: base.colorVariant
            });
        };

        addStyle('primary', primaryStyle, primaryAssignments, primaryVariantAssignments);
        if (nextStyle) {
            addStyle('next', nextStyle, nextStyleAssignments, nextStyleVariantAssignments);
        }

        return { simulationStyles, simulationAssignments, styleSlots };
    }, []);

    const threadConstraintConfig = useMemo<ThreadConstraintConfig | undefined>(() => {
        if (!enableThreadConstraints || activeThreadColors.length === 0 || activeThreadMachineTypes.length === 0) {
            return undefined;
        }

        const machineRules: Record<string, { ballsPerMachine: number; availableByColor: Record<string, number> }> = {};
        activeThreadMachineTypes.forEach(machineType => {
            const ballsPerMachine = defaultThreadBallsByMachine[machineType] ?? getDefaultBallsPerMachine(machineType);

            const availableByColor: Record<string, number> = {};
            activeThreadColors.forEach(color => {
                const value = threadInventoryByColor[color];
                availableByColor[color] = Math.max(0, Math.floor(value ?? defaultThreadColorInventory));
            });

            machineRules[machineType] = {
                ballsPerMachine,
                availableByColor
            };
        });

        return { machineRules };
    }, [
        enableThreadConstraints,
        activeThreadColors,
        activeThreadMachineTypes,
        defaultThreadBallsByMachine,
        threadInventoryByColor,
        defaultThreadColorInventory
    ]);

    const simulationInputSet = useMemo(() => {
        if (!selectedStyle) return undefined;

        const hasPrimaryAssignments = hasAnyScopedAssignments(assignments, variantAssignments);
        if (!hasPrimaryAssignments) return undefined;

        return buildSimulationInputs(
            selectedStyle,
            assignments,
            variantAssignments,
            selectedNextStyle,
            nextAssignments,
            nextVariantAssignments
        );
    }, [
        selectedStyle,
        assignments,
        variantAssignments,
        selectedNextStyle,
        nextAssignments,
        nextVariantAssignments,
        buildSimulationInputs,
        hasAnyScopedAssignments
    ]);

    // Simulate Schedule for Visualization
    const simResult = useMemo(() => {
        if (!simulationInputSet) return { schedule: {}, logs: [] };

        return simulateProductionSchedule(
            simulationInputSet.simulationStyles,
            simulationInputSet.simulationAssignments,
            operators,
            machineCounts,
            availableMinutes,
            switchDelay,
            operatorAttendance,
            learnedPerformance,
            undefined,
            threadConstraintConfig
        );
    }, [
        simulationInputSet,
        operators,
        machineCounts,
        availableMinutes,
        switchDelay,
        operatorAttendance,
        learnedPerformance,
        threadConstraintConfig,
        planningMode,
    ]);

    // Global bottleneck: "Actual Output" derived from Simulation (Final Good Count)
    const bottleneckOutput = useMemo(() => {
        if (!selectedStyle || !simResult.schedule) return { primary: 0, next: 0 };

        // Identify Final Operations for Primary Style
        const allDeps = new Set(selectedStyle.operations.flatMap(o => o.dependencies || []));
        const finalOps = selectedStyle.operations.filter(o => !allDeps.has(o.id));

        // Identify Final Operations for Next Style
        let nextFinalOps: any[] = [];
        if (selectedNextStyle) {
            const nextDeps = new Set(selectedNextStyle.operations.flatMap(o => o.dependencies || []));
            nextFinalOps = selectedNextStyle.operations.filter(o => !nextDeps.has(o.id));
        }

        // Track totals per operation ID to find the bottleneck (min) among final ops
        const primaryOpsOutput = new Map<string, number>();
        finalOps.forEach(op => primaryOpsOutput.set(op.id, 0));

        const nextOpsOutput = new Map<string, number>();
        nextFinalOps.forEach(op => nextOpsOutput.set(op.id, 0));

        // Determine split index between Primary and Next
        let primaryStyleCount = 0;
        if (selectedStyle) {
            if (selectedStyle.variants && selectedStyle.variants.length > 0) {
                primaryStyleCount = selectedStyle.variants.length;
            } else {
                primaryStyleCount = 1;
            }
        }

        Object.values(simResult.schedule).forEach(events => {
            events.forEach(ev => {
                const styleIndex = typeof ev.styleIndex === 'number' ? ev.styleIndex : 0;
                const belongsPrimaryByOp = primaryOpsOutput.has(ev.opId);
                const belongsNextByOp = nextOpsOutput.has(ev.opId);

                const isPrimaryEvent =
                    (typeof ev.styleIndex === 'number' && styleIndex < primaryStyleCount) ||
                    (typeof ev.styleIndex !== 'number' && belongsPrimaryByOp && !belongsNextByOp);
                const isNextEvent =
                    (typeof ev.styleIndex === 'number' && styleIndex >= primaryStyleCount) ||
                    (typeof ev.styleIndex !== 'number' && belongsNextByOp && !belongsPrimaryByOp);

                // Accumulate for Primary Style Final Ops
                if (primaryOpsOutput.has(ev.opId)) {
                    // Check if it belongs to Primary Style range
                    if (isPrimaryEvent) {
                        primaryOpsOutput.set(ev.opId, (primaryOpsOutput.get(ev.opId) || 0) + ev.count);
                    }
                }

                // Accumulate for Next Style Final Ops
                if (nextOpsOutput.has(ev.opId)) {
                    // Check if it belongs to Next Style range
                    if (isNextEvent) {
                        nextOpsOutput.set(ev.opId, (nextOpsOutput.get(ev.opId) || 0) + ev.count);
                    }
                }
            });
        });

        // The output is the MINIMUM of all final operations (bottleneck)
        // If no final ops, 0. If multiple, min.
        const primaryMin = finalOps.length > 0 ? Math.min(...Array.from(primaryOpsOutput.values())) : 0;
        const nextMin = nextFinalOps.length > 0 ? Math.min(...Array.from(nextOpsOutput.values())) : 0;

        return { primary: Math.floor(primaryMin), next: Math.floor(nextMin) };
    }, [selectedStyle, selectedNextStyle, simResult.schedule]);


    // Calculate actual scheduled completion count per operation from simulation
    const scheduledCountPerOp = useMemo(() => {
        const counts: Record<string, number> = {};
        if (!simResult.schedule) return counts;

        // Sum up all completion events for each operation
        Object.values(simResult.schedule).forEach(events => {
            events.forEach(ev => {
                if (!counts[ev.opId]) counts[ev.opId] = 0;
                counts[ev.opId] += ev.count;
            });
        });

        return counts;
    }, [simResult.schedule]);

    const scheduledCountPerStyleVariantOp = useMemo(() => {
        const counts: Record<string, number> = {};
        if (!simResult.schedule || !simulationInputSet) return counts;

        Object.values(simResult.schedule).forEach(events => {
            events.forEach(event => {
                const styleIndex = typeof event.styleIndex === 'number' ? event.styleIndex : 0;
                const slot = simulationInputSet.styleSlots[styleIndex];
                if (!slot) return;
                const key = buildStyleVariantOpKey(slot.source, slot.rootStyleId, slot.variantId, event.opId);
                counts[key] = (counts[key] || 0) + event.count;
            });
        });

        return counts;
    }, [simResult.schedule, simulationInputSet]);

    const calculateBottleneckForSchedule = useCallback((
        primaryStyle: GarmentStyle | undefined,
        nextStyle: GarmentStyle | undefined,
        schedule: Record<string, { start: number, end: number, opId: string, count: number, styleIndex: number }[]>
    ) => {
        if (!primaryStyle) return { primary: 0, next: 0 };

        const primaryDependencies = new Set(primaryStyle.operations.flatMap(op => op.dependencies || []));
        const primaryFinalOps = primaryStyle.operations.filter(op => !primaryDependencies.has(op.id));

        const nextDependencies = new Set((nextStyle?.operations || []).flatMap(op => op.dependencies || []));
        const nextFinalOps = (nextStyle?.operations || []).filter(op => !nextDependencies.has(op.id));

        const primaryTotals = new Map<string, number>();
        primaryFinalOps.forEach(op => primaryTotals.set(op.id, 0));
        const nextTotals = new Map<string, number>();
        nextFinalOps.forEach(op => nextTotals.set(op.id, 0));

        const primaryStyleCount = primaryStyle.variants?.length ? primaryStyle.variants.length : 1;

        Object.values(schedule).forEach(events => {
            events.forEach(event => {
                const styleIndex = typeof event.styleIndex === 'number' ? event.styleIndex : 0;
                const belongsPrimaryByOp = primaryTotals.has(event.opId);
                const belongsNextByOp = nextTotals.has(event.opId);

                const isPrimaryEvent =
                    (typeof event.styleIndex === 'number' && styleIndex < primaryStyleCount) ||
                    (typeof event.styleIndex !== 'number' && belongsPrimaryByOp && !belongsNextByOp);
                const isNextEvent =
                    (typeof event.styleIndex === 'number' && styleIndex >= primaryStyleCount) ||
                    (typeof event.styleIndex !== 'number' && belongsNextByOp && !belongsPrimaryByOp);

                if (primaryTotals.has(event.opId) && isPrimaryEvent) {
                    primaryTotals.set(event.opId, (primaryTotals.get(event.opId) || 0) + event.count);
                }
                if (nextTotals.has(event.opId) && isNextEvent) {
                    nextTotals.set(event.opId, (nextTotals.get(event.opId) || 0) + event.count);
                }
            });
        });

        const primaryMin = primaryFinalOps.length > 0 ? Math.min(...Array.from(primaryTotals.values())) : 0;
        const nextMin = nextFinalOps.length > 0 ? Math.min(...Array.from(nextTotals.values())) : 0;

        return { primary: Math.floor(primaryMin), next: Math.floor(nextMin) };
    }, []);

    const scenarioOutputs = useMemo(() => {
        if (!selectedStyle || !simulationInputSet) return [];

        const { simulationStyles, simulationAssignments } = simulationInputSet;

        const scenarios = [
            { id: 'conservative', label: 'Conservative', perfScale: 0.92, startDelayDelta: 10, shiftExtensionDelta: -15 },
            { id: 'expected', label: 'Expected', perfScale: 1, startDelayDelta: 0, shiftExtensionDelta: 0 },
            { id: 'optimistic', label: 'Optimistic', perfScale: 1.08, startDelayDelta: -5, shiftExtensionDelta: 10 },
        ] as const;

        return scenarios.map(scenario => {
            const adjustedAttendance: Record<string, { startDelay: number; shiftExtension: number }> = {};
            operators.forEach(op => {
                const base = operatorAttendance[op.id] || { startDelay: 0, shiftExtension: 0 };
                adjustedAttendance[op.id] = {
                    startDelay: Math.max(0, base.startDelay + scenario.startDelayDelta),
                    shiftExtension: base.shiftExtension + scenario.shiftExtensionDelta,
                };
            });

            const simulated = simulateProductionSchedule(
                simulationStyles,
                simulationAssignments,
                operators,
                machineCounts,
                availableMinutes,
                switchDelay,
                adjustedAttendance,
                scaleHistoricalPerformance(learnedPerformance, scenario.perfScale),
                undefined,
                threadConstraintConfig
            );

            const output = calculateBottleneckForSchedule(selectedStyle, selectedNextStyle, simulated.schedule);
            return {
                id: scenario.id,
                label: scenario.label,
                ...output,
                total: output.primary + output.next,
            };
        });
    }, [
        selectedStyle,
        selectedNextStyle,
        simulationInputSet,
        operators,
        machineCounts,
        availableMinutes,
        switchDelay,
        operatorAttendance,
        learnedPerformance,
        threadConstraintConfig,
        calculateBottleneckForSchedule,
    ]);

    const confidenceBand = useMemo(() => {
        if (scenarioOutputs.length === 0) return null;
        const totals = scenarioOutputs.map(s => s.total);
        const expected = scenarioOutputs.find(s => s.id === 'expected')?.total ?? totals[0];
        return {
            low: Math.min(...totals),
            expected,
            high: Math.max(...totals),
        };
    }, [scenarioOutputs]);

    const planningKpis = useMemo(() => {
        if (!selectedStyle || !simResult.schedule) {
            return {
                throughputPerHour: 0,
                machineUtilization: 0,
                changeoverLossMinutes: 0,
                estimatedWip: 0,
                scheduleAdherence: 0,
            };
        }

        const totalOutput = bottleneckOutput.primary + bottleneckOutput.next;
        const throughputPerHour = availableMinutes > 0 ? (totalOutput / (availableMinutes / 60)) : 0;

        const styleOpById = new Map<string, { machineType: string }>();
        selectedStyle.operations.forEach(op => styleOpById.set(op.id, { machineType: op.machineType }));
        selectedNextStyle?.operations.forEach(op => styleOpById.set(op.id, { machineType: op.machineType }));

        let productiveMachineMinutes = 0;
        let changeoverLossMinutes = 0;

        Object.values(simResult.schedule).forEach(events => {
            const sorted = [...events].sort((a, b) => a.start - b.start);
            sorted.forEach((event, index) => {
                productiveMachineMinutes += Math.max(0, event.end - event.start);
                if (index === 0) return;
                const previous = sorted[index - 1];
                const prevMachine = styleOpById.get(previous.opId)?.machineType;
                const currentMachine = styleOpById.get(event.opId)?.machineType;
                if (prevMachine && currentMachine && prevMachine !== currentMachine) {
                    changeoverLossMinutes += Math.max(0, event.start - previous.end);
                }
            });
        });

        const usedMachineTypes = new Set<string>();
        styleOpById.forEach(value => usedMachineTypes.add(value.machineType));
        const totalMachineCapacity = Array.from(usedMachineTypes).reduce((sum, machineType) => {
            return sum + ((machineCounts[machineType] || 1) * availableMinutes);
        }, 0);
        const machineUtilization = totalMachineCapacity > 0
            ? (productiveMachineMinutes / totalMachineCapacity) * 100
            : 0;

        const estimateWipForStyle = (style?: GarmentStyle) => {
            if (!style) return 0;
            let total = 0;
            style.operations.forEach(op => {
                const output = scheduledCountPerOp[op.id] || 0;
                const successors = style.operations.filter(next => next.dependencies?.includes(op.id));
                if (successors.length === 0) return;
                const downstream = Math.min(...successors.map(next => scheduledCountPerOp[next.id] || 0));
                total += Math.max(0, output - downstream);
            });
            return total;
        };
        const estimatedWip = estimateWipForStyle(selectedStyle) + estimateWipForStyle(selectedNextStyle);

        const [shiftHour, shiftMinute] = shiftStartTime.split(':').map(Number);
        const shiftStart = Number.isFinite(shiftHour) && Number.isFinite(shiftMinute)
            ? (shiftHour * 60) + shiftMinute
            : SHIFT_START_MINUTES;
        const now = new Date();
        const currentShiftMinute = Math.max(0, ((now.getHours() * 60) + now.getMinutes()) - shiftStart);
        let plannedTillNow = 0;
        Object.values(simResult.schedule).forEach(events => {
            events.forEach(event => {
                if (event.end <= currentShiftMinute) {
                    plannedTillNow += event.count;
                }
            });
        });

        const selectedStyleIds = new Set([selectedStyle.id, selectedNextStyle?.id].filter(Boolean));
        const actualTillNow = (todayProductionLogs || [])
            .filter(log => selectedStyleIds.has(log.styleId))
            .reduce((sum, log) => sum + (log.cumulativeQuantity || 0), 0);
        const scheduleAdherence = plannedTillNow > 0 ? (actualTillNow / plannedTillNow) * 100 : 0;

        return {
            throughputPerHour,
            machineUtilization,
            changeoverLossMinutes,
            estimatedWip,
            scheduleAdherence,
        };
    }, [
        selectedStyle,
        selectedNextStyle,
        simResult.schedule,
        bottleneckOutput.primary,
        bottleneckOutput.next,
        availableMinutes,
        machineCounts,
        scheduledCountPerOp,
        todayProductionLogs,
        shiftStartTime,
    ]);

    const theoreticalCapacityPotential = useMemo(() => {
        const totalSmv = (selectedStyle?.totalSmv || 0) + (selectedNextStyle?.totalSmv || 0);
        const avgSmv = totalSmv / (selectedNextStyle ? 2 : 1);
        const count = availableOperatorIds.length || 0;
        if (!avgSmv || !count) return 0;
        return Math.floor((availableMinutes * count * 0.85) / avgSmv);
    }, [selectedStyle?.totalSmv, selectedNextStyle?.totalSmv, selectedNextStyle?.id, availableOperatorIds.length, availableMinutes]);

    const orderBoundedPotential = useMemo(() => {
        const remainingOrders = selectedNextStyle
            ? remainingPrimaryQty + remainingNextQty
            : remainingPrimaryQty;
        const hasOrderBound = (selectedStyle?.quantity || 0) > 0 || (selectedNextStyle?.quantity || 0) > 0;
        if (!hasOrderBound) return theoreticalCapacityPotential;
        if (remainingOrders <= 0) return 0;
        return Math.min(theoreticalCapacityPotential, remainingOrders);
    }, [
        selectedStyle?.quantity,
        selectedNextStyle?.id,
        selectedNextStyle?.quantity,
        remainingPrimaryQty,
        remainingNextQty,
        theoreticalCapacityPotential
    ]);

    const isPlannedOrderComplete = useMemo(() => {
        const primaryComplete = !selectedStyle || bottleneckOutput.primary >= remainingPrimaryQty;
        const nextComplete = !selectedNextStyle || bottleneckOutput.next >= remainingNextQty;
        return primaryComplete && nextComplete;
    }, [
        selectedStyle?.id,
        selectedNextStyle?.id,
        bottleneckOutput.primary,
        bottleneckOutput.next,
        remainingPrimaryQty,
        remainingNextQty
    ]);

    // Helper to generate instructions
    const instructions = useMemo(() => {
        if (!selectedStyle) return [];

        // Group by Operator (Merge both styles)
        const opMap = new Map<string, { opId: string, style: 'primary' | 'next' }[]>();

        assignments.forEach(a => {
            a.operatorIds.forEach(uid => {
                const list = opMap.get(uid) || [];
                list.push({ opId: a.operationId, style: 'primary' });
                opMap.set(uid, list);
            });
        });

        nextAssignments.forEach(a => {
            a.operatorIds.forEach(uid => {
                const list = opMap.get(uid) || [];
                // Avoid duplicates if any (unlikely but safe)
                if (!list.find(x => x.opId === a.operationId)) {
                    list.push({ opId: a.operationId, style: 'next' });
                }
                opMap.set(uid, list);
            });
        });

        const list: { operatorId: string; name: string; operations: string[]; advice: string; type: 'focus' | 'rotate' | 'flow' }[] = [];

        opMap.forEach((tasks, uid) => {
            const user = operators.find(o => o.id === uid);
            if (!user) return;

            // Resolve Operation Objects
            const userOps = tasks.map(t => {
                const styleObj = t.style === 'primary' ? selectedStyle : selectedNextStyle;
                const op = styleObj?.operations.find(o => o.id === t.opId);
                return { op, style: t.style };
            }).filter(item => !!item.op) as { op: typeof selectedStyle.operations[0], style: 'primary' | 'next' }[];

            if (userOps.length === 0) return;

            // Sort: Primary first, then Next
            userOps.sort((a, b) => {
                if (a.style !== b.style) return a.style === 'primary' ? -1 : 1;
                return 0;
            });

            let advice = "";
            let type: 'focus' | 'rotate' | 'flow' = 'focus';

            const opNames = userOps.map(u => u.op.name);

            if (userOps.length === 1) {
                advice = `Focus exclusively on ${userOps[0].op.name} (${userOps[0].style === 'next' ? 'Next Style' : 'Current Style'}). Maintain steady flow.`;
                type = 'focus';
            } else {
                // 1. Calculate Recommended Volumes
                const batchItems = userOps.map(({ op, style }) => {
                    const metrics = style === 'primary' ? flowMetrics : nextFlowMetrics;
                    const metric = metrics[op.id];
                    const weight = metric?.operatorWeights?.get(uid) || 0;
                    const pcs = ((user.efficiencyRating || 100) / 100 * availableMinutes * weight) / (op.smv / 60);
                    return { name: op.name, pcs: Math.round(pcs), style };
                }).filter(t => t.pcs > 0);

                // 2. Normalize
                const minPcs = Math.min(...(batchItems.length ? batchItems.map(t => t.pcs) : [1]));
                const scale = minPcs > 0 ? (15 / minPcs) : 1;

                const batchStrings = batchItems.map(t => {
                    const batch = Math.max(10, Math.round(t.pcs * scale / 5) * 5);
                    return `${batch} pcs ${t.name}${t.style === 'next' ? ' (Next)' : ''}`;
                });

                // Check dependencies (Self-loop check only within same style)
                let hasSelfDependency = false;
                // Simplified check: if mixed styles, usually flow implies finish primary then next
                const hasMixedStyles = userOps.some(o => o.style === 'primary') && userOps.some(o => o.style === 'next');

                const adviceResult = generateOperatorAdvice(hasMixedStyles, userOps, batchStrings);
                type = adviceResult.type;
                advice = adviceResult.advice;
            }

            list.push({
                operatorId: uid,
                name: user.name,
                operations: opNames,
                advice,
                type
            });
        });

        return list.sort((a, b) => b.type.localeCompare(a.type));
    }, [assignments, nextAssignments, selectedStyle, selectedNextStyle, operators, flowMetrics, nextFlowMetrics]);

    const optimizationRecommendations = useMemo(() => {
        if (!selectedStyle || assignments.length === 0) return [];

        const operationsWithMetrics = selectedStyle.operations
            .map(op => ({ op, metric: flowMetrics[op.id] }))
            .filter(item => !!item.metric);

        if (operationsWithMetrics.length === 0) return [];

        const bottleneck = operationsWithMetrics.reduce((lowest, current) =>
            current.metric.effectiveOutput < lowest.metric.effectiveOutput ? current : lowest
        );

        const currentMin = bottleneck.metric.effectiveOutput || 0;
        if (currentMin <= 0) return [];

        const candidateRecommendations: {
            operatorId: string;
            operatorName: string;
            fromOperation: string;
            toOperation: string;
            estimatedGain: number;
        }[] = [];

        const surplusOps = operationsWithMetrics.filter(item =>
            item.op.id !== bottleneck.op.id &&
            item.metric.effectiveOutput > currentMin * 1.15 &&
            item.metric.assignedOps.length > 1
        );

        surplusOps.forEach(surplus => {
            const assignment = assignments.find(a => a.operationId === surplus.op.id);
            if (!assignment) return;

            assignment.operatorIds.forEach(operatorId => {
                const operator = operators.find(op => op.id === operatorId);
                if (!operator) return;
                if (!operator.skills?.includes(bottleneck.op.machineType)) return;
                const alreadyOnBottleneck = assignments
                    .find(a => a.operationId === bottleneck.op.id)
                    ?.operatorIds.includes(operatorId);
                if (alreadyOnBottleneck) return;

                const shiftedAssignments = assignments
                    .map(a => {
                        if (a.operationId === surplus.op.id) {
                            return { ...a, operatorIds: a.operatorIds.filter(id => id !== operatorId) };
                        }
                        if (a.operationId === bottleneck.op.id) {
                            return { ...a, operatorIds: [...a.operatorIds, operatorId] };
                        }
                        return a;
                    })
                    .filter(a => a.operatorIds.length > 0);

                const shiftedMetrics = calculateMetrics(selectedStyle, shiftedAssignments);
                const shiftedMin = selectedStyle.operations.reduce((min, op) => {
                    const value = shiftedMetrics[op.id]?.effectiveOutput || 0;
                    return Math.min(min, value);
                }, Number.POSITIVE_INFINITY);

                const estimatedGain = Math.max(0, shiftedMin - currentMin);
                if (estimatedGain > 0.25) {
                    candidateRecommendations.push({
                        operatorId,
                        operatorName: operator.name,
                        fromOperation: surplus.op.name,
                        toOperation: bottleneck.op.name,
                        estimatedGain,
                    });
                }
            });
        });

        const deduped = new Map<string, typeof candidateRecommendations[0]>();
        candidateRecommendations.forEach(item => {
            const key = `${item.operatorId}:${item.toOperation}`;
            const existing = deduped.get(key);
            if (!existing || existing.estimatedGain < item.estimatedGain) {
                deduped.set(key, item);
            }
        });

        return Array.from(deduped.values())
            .sort((a, b) => b.estimatedGain - a.estimatedGain)
            .slice(0, 3);
    }, [selectedStyle, assignments, flowMetrics, operators, calculateMetrics]);

    if (stylesLoading || operatorsLoading) {

        return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    }

    return (
        <Card className="w-full">
            <CardHeader>
                <CardTitle>Production Planner</CardTitle>
                <CardDescription>Plan daily targets and balance the production line.</CardDescription>
            </CardHeader>
            <CardContent className=' p-2 md:p-6'>
                <div className="flex flex-col gap-6 mb-6 p-2 md:p-0">
                    <div className="flex flex-col md:flex-row gap-4 items-end">
                        <div className="w-full md:w-1/3 space-y-2">
                            <label className="text-sm font-medium">Select Style</label>
                            <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Choose a style..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {styles?.map(style => (
                                        <SelectItem key={style.id} value={style.id}>
                                            {style.name} <span className="text-muted-foreground ml-2">({style.totalSmv.toFixed(2)} mins)</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* NEW: Next Style Selector */}
                        <div className="w-full md:w-1/3 space-y-2">
                            <label className="text-sm font-medium">Next Style (Continuous Flow)</label>
                            <Select
                                value={selectedNextStyleId || 'none'}
                                onValueChange={(value) => setSelectedNextStyleId(value === 'none' ? '' : value)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Next Style (Optional)" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    {styles?.filter(s => s.id !== selectedStyleId).map(s => ( // Exclude current style
                                        <SelectItem key={s.id} value={s.id}>{s.name} ({s.totalSmv.toFixed(2)} mins)</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="w-full md:w-1/3 space-y-2">
                            <label className="text-sm font-medium">Planning Mode</label>
                            <Select
                                value={planningMode}
                                onValueChange={(v: 'target' | 'capacity') => setPlanningMode(v)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="target">Target Driven (Set Qty)</SelectItem>
                                    <SelectItem value="capacity">Capacity Driven (Set Team Size)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="w-full md:w-1/3 space-y-2">
                            <label className="text-sm font-medium">
                                {planningMode === 'target' ? 'Daily Target (Pcs)' : 'Available Operators'}
                            </label>
                            {planningMode === 'capacity' ? (
                                <MultiSelect
                                    options={operators.map(o => ({ label: o.name, value: o.id }))}
                                    selected={availableOperatorIds}
                                    onChange={setAvailableOperatorIds}
                                    placeholder="Select operators..."
                                />
                            ) : (
                                <Input
                                    type="number"
                                    value={dailyTarget}
                                    onChange={(e) => setDailyTarget(Number(e.target.value))}
                                />
                            )}
                        </div>

                        <div className="w-full md:w-1/6 space-y-2">
                            <label className="text-sm font-medium">Switch Delay (min)</label>
                            <Input
                                type="number"
                                value={switchDelay}
                                onChange={(e) => setSwitchDelay(Number(e.target.value))}
                                min={0}
                            />
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row md:items-end gap-3 p-3 border rounded-md bg-muted/30">
                        <div className="space-y-1">
                            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rolling Re-Plan</div>
                            <div className="text-sm text-muted-foreground">
                                Recompute assignments from live logs every {clamp(replanIntervalMinutes, 30, 180)} minutes.
                            </div>
                        </div>
                        <div className="flex items-center gap-2 md:ml-auto">
                            <Button
                                variant={enableRollingReplan ? "default" : "outline"}
                                onClick={() => setEnableRollingReplan(prev => !prev)}
                            >
                                {enableRollingReplan ? 'Enabled' : 'Disabled'}
                            </Button>
                            <Input
                                type="number"
                                className="w-24"
                                min={30}
                                max={180}
                                step={15}
                                value={replanIntervalMinutes}
                                onChange={(e) => setReplanIntervalMinutes(Number(e.target.value) || 60)}
                            />
                            <Button
                                variant="outline"
                                onClick={() => {
                                    handleAutoAssign();
                                    setLastReplanAt(new Date());
                                }}
                                disabled={!selectedStyle}
                            >
                                Re-plan Now
                            </Button>
                        </div>
                        {lastReplanAt && (
                            <div className="text-xs text-muted-foreground md:ml-2">
                                Last: {format(lastReplanAt, 'HH:mm')}
                            </div>
                        )}
                    </div>

                    {planningMode === 'capacity' && (
                        <div className="flex gap-4 justify-end w-full">
                            <div className="p-3 bg-muted/50 rounded-md flex flex-col items-end min-w-[120px]">
                                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider" title="Theoretical max based on team size">Max Potential</span>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-xl font-bold text-muted-foreground">
                                        {orderBoundedPotential}
                                    </span>
                                    <span className="text-xs text-muted-foreground">pcs/day</span>
                                </div>
                            </div>
                            <div className="p-3 bg-primary/10 border border-primary/20 rounded-md flex flex-col items-end min-w-[150px]">
                                <span className="text-xs text-primary font-medium uppercase tracking-wider" title="Actual simulation output containing specific order quantities">Actual Output</span>
                                <div className="flex flex-col items-end">
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-3xl font-bold text-primary">
                                            {assignments.length > 0 ? bottleneckOutput.primary : 0}
                                        </span>
                                        <span className="text-sm text-primary/80">pcs (Current)</span>
                                    </div>
                                    {selectedNextStyle && (
                                        <div className="flex items-baseline gap-1 mt-1">
                                            <span className="text-lg font-bold text-blue-600">
                                                +{bottleneckOutput.next}
                                            </span>
                                            <span className="text-xs text-blue-600/80">pcs (Next)</span>
                                        </div>
                                    )}
                                </div>
                                {assignments.length > 0 &&
                                    orderBoundedPotential < theoreticalCapacityPotential &&
                                    (bottleneckOutput.primary + bottleneckOutput.next) >= orderBoundedPotential && (
                                    <div className="text-[10px] text-amber-600 font-medium mt-1">
                                        ⚠ Limited by Order Qty
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    {planningMode === 'target' && selectedStyle && (
                        <div className="p-3 bg-muted rounded-md flex justify-between items-center">
                            <span className="text-sm font-medium">Estimated Operators Needed:</span>
                            <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-bold text-primary">
                                    {Math.ceil((dailyTarget * selectedStyle.totalSmv) / availableMinutes)}
                                </span>
                                <span className="text-sm text-muted-foreground">operators</span>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                        <div className="p-3 border rounded-md bg-background">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Throughput</div>
                            <div className="text-lg font-semibold">{planningKpis.throughputPerHour.toFixed(1)} pcs/hr</div>
                        </div>
                        <div className="p-3 border rounded-md bg-background">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Machine Utilization</div>
                            <div className="text-lg font-semibold">{planningKpis.machineUtilization.toFixed(1)}%</div>
                        </div>
                        <div className="p-3 border rounded-md bg-background">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Changeover Loss</div>
                            <div className="text-lg font-semibold">{Math.round(planningKpis.changeoverLossMinutes)} min</div>
                        </div>
                        <div className="p-3 border rounded-md bg-background">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated WIP</div>
                            <div className="text-lg font-semibold">{Math.round(planningKpis.estimatedWip)} pcs</div>
                        </div>
                        <div className="p-3 border rounded-md bg-background">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Schedule Adherence</div>
                            <div className="text-lg font-semibold">{planningKpis.scheduleAdherence.toFixed(0)}%</div>
                        </div>
                    </div>

                    {confidenceBand && (
                        <div className="p-3 border rounded-md bg-muted/20">
                            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                                Scenario Confidence
                            </div>
                            <div className="flex flex-wrap items-center gap-6">
                                <div className="text-sm">Low: <span className="font-semibold">{confidenceBand.low}</span></div>
                                <div className="text-sm">Expected: <span className="font-semibold">{confidenceBand.expected}</span></div>
                                <div className="text-sm">High: <span className="font-semibold">{confidenceBand.high}</span></div>
                            </div>
                        </div>
                    )}

                    {optimizationRecommendations.length > 0 && (
                        <div className="p-3 border rounded-md bg-blue-50/50 dark:bg-blue-950/10">
                            <div className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300 mb-2">
                                Recommended Rebalance Actions
                            </div>
                            <div className="space-y-2">
                                {optimizationRecommendations.map((item) => (
                                    <div key={`${item.operatorId}-${item.toOperation}`} className="text-sm">
                                        Move <span className="font-semibold">{item.operatorName}</span> from{' '}
                                        <span className="font-medium">{item.fromOperation}</span> to{' '}
                                        <span className="font-medium">{item.toOperation}</span>{' '}
                                        <span className="text-blue-700 dark:text-blue-300">(+{item.estimatedGain.toFixed(1)} pcs/day)</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex items-end gap-2">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="border-dashed">
                                    <CalendarClock className="mr-2 h-4 w-4" />
                                    Manage Attendance
                                    {Object.keys(operatorAttendance).length > 0 && (
                                        <Badge variant="secondary" className="ml-2">
                                            {Object.keys(operatorAttendance).length}
                                        </Badge>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-96 p-4" align="start">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="font-medium leading-none">Attendance & Overtime</h4>
                                    </div>

                                    <div className="flex items-center justify-between gap-4 p-2 bg-muted/50 rounded-md">
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-sm font-medium whitespace-nowrap">Shift Start:</label>
                                            <Input
                                                type="time"
                                                className="h-8 w-32"
                                                value={shiftStartTime}
                                                onChange={(e) => {
                                                    setShiftStartTime(e.target.value);
                                                }}
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-sm font-medium whitespace-nowrap">Global OT (Hrs):</label>
                                            <Input
                                                type="number"
                                                className="h-8 w-24 text-right"
                                                placeholder="0"
                                                min="0"
                                                step="0.5"
                                                onChange={(e) => {
                                                    const val = parseFloat(e.target.value) || 0;
                                                    setOperatorAttendance(prev => {
                                                        const next = { ...prev };
                                                        // Update all visible operators
                                                        operators.filter(o => availableOperatorIds.includes(o.id)).forEach(op => {
                                                            const current = next[op.id] || { startDelay: 0, shiftExtension: 0 };
                                                            next[op.id] = { ...current, shiftExtension: val * 60 };
                                                            if (next[op.id].startDelay === 0 && next[op.id].shiftExtension === 0) delete next[op.id];
                                                        });
                                                        return next;
                                                    });
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Standard Shift: {Math.floor(availableMinutes / 60)}h {(availableMinutes % 60)}m
                                    </p>

                                    <div className="grid gap-2 max-h-[300px] overflow-y-auto pr-2">
                                        <div className="grid grid-cols-[1fr,60px,60px,60px] gap-2 text-xs font-medium text-muted-foreground mb-1">
                                            <span>Operator</span>
                                            <span className="text-center">Start</span>
                                            <span className="text-center">End</span>
                                            <span className="text-right">OT/Early</span>
                                        </div>
                                        {operators.filter(o => availableOperatorIds.includes(o.id)).map(op => {
                                            const att = operatorAttendance[op.id] || { startDelay: 0, shiftExtension: 0 };

                                            // Helper to convert delay to time string
                                            const getStartTime = () => {
                                                const [h, m] = shiftStartTime.split(':').map(Number);
                                                const totalMins = (h * 60) + m + att.startDelay;
                                                const newH = Math.floor(totalMins / 60);
                                                const newM = totalMins % 60;
                                                return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
                                            };

                                            // Helper to calc delay from time string
                                            const updateStartTime = (timeStr: string) => {
                                                const [globalH, globalM] = shiftStartTime.split(':').map(Number);
                                                const globalMins = (globalH * 60) + globalM;

                                                const [inH, inM] = timeStr.split(':').map(Number);
                                                const inMins = (inH * 60) + inM;

                                                const diff = Math.max(0, inMins - globalMins);

                                                setOperatorAttendance(prev => {
                                                    const next = { ...prev };
                                                    const current = next[op.id] || { startDelay: 0, shiftExtension: 0 };
                                                    next[op.id] = { ...current, startDelay: diff };

                                                    // Cleanup if clean
                                                    if (next[op.id].startDelay === 0 && next[op.id].shiftExtension === 0) delete next[op.id];
                                                    return next;
                                                });
                                            };

                                            // Helper to get End Time
                                            const getEndTime = () => {
                                                const [h, m] = shiftStartTime.split(':').map(Number);
                                                const startMins = (h * 60) + m;
                                                const BREAK_MINUTES = 60; // 2x15m Tea + 30m Lunch
                                                const standardEnd = startMins + availableMinutes + BREAK_MINUTES;
                                                const actualEnd = standardEnd + att.shiftExtension;

                                                const newH = Math.floor(actualEnd / 60) % 24;
                                                const newM = actualEnd % 60;
                                                return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
                                            };

                                            // Helper to update End Time
                                            const updateEndTime = (timeStr: string) => {
                                                const [globalH, globalM] = shiftStartTime.split(':').map(Number);
                                                const startMins = (globalH * 60) + globalM;
                                                const BREAK_MINUTES = 60; // 2x15m Tea + 30m Lunch
                                                const standardEnd = startMins + availableMinutes + BREAK_MINUTES;

                                                const [inH, inM] = timeStr.split(':').map(Number);
                                                const inMins = (inH * 60) + inM;

                                                // Calculate difference from standard end
                                                // If inMins < standardEnd, it's negative (early leave)
                                                // If inMins > standardEnd, it's positive (OT)
                                                const diff = inMins - standardEnd;

                                                setOperatorAttendance(prev => {
                                                    const next = { ...prev };
                                                    const current = next[op.id] || { startDelay: 0, shiftExtension: 0 };
                                                    next[op.id] = { ...current, shiftExtension: diff };

                                                    if (next[op.id].startDelay === 0 && next[op.id].shiftExtension === 0) delete next[op.id];
                                                    return next;
                                                });
                                            };

                                            return (
                                                <div key={op.id} className="grid grid-cols-[1fr,60px,60px,60px] gap-2 items-center">
                                                    <span className="text-sm truncate" title={op.name}>{op.name}</span>
                                                    <Input
                                                        type="time"
                                                        className="h-7 p-1 text-center text-[10px]"
                                                        value={getStartTime()}
                                                        onChange={(e) => updateStartTime(e.target.value)}
                                                    />
                                                    <Input
                                                        type="time"
                                                        className="h-7 p-1 text-center text-[10px]"
                                                        value={getEndTime()}
                                                        onChange={(e) => updateEndTime(e.target.value)}
                                                    />
                                                    <div className={`text-[10px] text-right font-mono ${att.shiftExtension > 0 ? 'text-green-600 font-bold' : att.shiftExtension < 0 ? 'text-red-500 font-bold' : 'text-muted-foreground'}`}>
                                                        {att.shiftExtension > 0 ? '+' : ''}{Math.round(att.shiftExtension / 60 * 10) / 10}h
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-full text-muted-foreground"
                                        onClick={() => setOperatorAttendance({})}
                                    >
                                        Clear All
                                    </Button>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Button onClick={handleAutoAssign} disabled={!selectedStyle}>
                            <Wand2 className="mr-2 h-4 w-4" />
                            Auto Assign
                        </Button>
                    </div>

                    {selectedStyle && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 mb-4 border rounded-md bg-slate-50 dark:bg-slate-900/50">
                            <h4 className="col-span-full text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                Machine Inventory (Constraints)
                            </h4>
                            {Object.entries(machineCounts).map(([type, count]) => (
                                <div key={type} className="space-y-1">
                                    <label className="text-[10px] font-medium truncate block" title={type}>{type}</label>
                                    <Input
                                        type="number"
                                        className="h-7 text-xs bg-background"
                                        value={count}
                                        min={1}
                                        onChange={(e) => setMachineCounts(prev => ({ ...prev, [type]: parseInt(e.target.value) || 1 }))}
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    {selectedStyle && activeThreadColors.length > 0 && activeThreadMachineTypes.length > 0 && (
                        <div className="p-4 mb-4 border rounded-md bg-slate-50 dark:bg-slate-900/50">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                                <div>
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Thread Inventory (Color Constraints)
                                    </h4>
                                    <p className="text-[11px] text-muted-foreground mt-1">
                                        Enter total balls per color. Thread per machine comes from Settings {'->'} Machine Inventory.
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    variant={enableThreadConstraints ? "default" : "outline"}
                                    onClick={() => setEnableThreadConstraints(prev => !prev)}
                                >
                                    {enableThreadConstraints ? 'Enabled' : 'Disabled'}
                                </Button>
                            </div>

                            {enableThreadConstraints && (
                                <div className="space-y-4">
                                    <div className="flex flex-wrap gap-2">
                                        {activeThreadMachineTypes.map(machineType => (
                                            <Badge key={machineType} variant="outline" className="text-[10px]">
                                                {machineType}: {defaultThreadBallsByMachine[machineType] ?? getDefaultBallsPerMachine(machineType)} balls/machine
                                            </Badge>
                                        ))}
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        {activeThreadColors.map(color => (
                                            <div key={color} className="space-y-1">
                                                <label className="text-[10px] font-medium truncate block" title={color}>
                                                    {color} (balls)
                                                </label>
                                                <Input
                                                    type="number"
                                                    className="h-7 text-xs bg-background"
                                                    value={threadInventoryByColor[color] ?? defaultThreadColorInventory}
                                                    min={0}
                                                    onChange={(e) => {
                                                        const value = Math.max(0, parseInt(e.target.value) || 0);
                                                        setThreadInventoryByColor(prev => ({
                                                            ...prev,
                                                            [color]: value
                                                        }));
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {!enableThreadConstraints && (
                                <div className="text-[11px] text-muted-foreground">
                                    Constraints are off. Enable to enforce per-machine color limits.
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {[
                    { title: `Current Style: ${selectedStyle?.name}`, style: selectedStyle, metrics: flowMetrics },
                    { title: `Next Style: ${selectedNextStyle?.name} (Continuous Flow)`, style: selectedNextStyle, metrics: nextFlowMetrics }
                ].map(({ title, style, metrics }, i) => {
                    if (!style) return null;
                    return (
                        <div key={`${style.id}-${i}`} className="rounded-md border mb-6">
                            <div className="p-3 bg-muted/30 border-b">
                                <h4 className="font-semibold text-sm">{title}</h4>
                            </div>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Operation</TableHead>
                                        <TableHead>Variants</TableHead>
                                        <TableHead>SMV</TableHead>
                                        <TableHead>Machine</TableHead>
                                        <TableHead className="text-right">Req. Operators</TableHead>
                                        <TableHead>Assigned Operators</TableHead>
                                        <TableHead className="text-right">Daily Target</TableHead>
                                        <TableHead className="text-center">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {(() => {
                                        const styleScope: PlannerScope = i === 0 ? 'primary' : 'next';
                                        const styleRemainingTarget = planningMode === 'capacity'
                                            ? (
                                                style.id === selectedStyle?.id
                                                    ? remainingPrimaryQty
                                                    : style.id === selectedNextStyle?.id
                                                        ? remainingNextQty
                                                        : dailyTarget
                                            )
                                            : dailyTarget;
                                        const styleQty = Math.max(
                                            1,
                                            style.variants?.reduce((sum, variant) => sum + (variant.quantity || 0), 0) || style.quantity || 1
                                        );
                                        const hasVariants = !!style.variants?.length;
                                        const styleVariants = hasVariants
                                            ? style.variants!.map(variant => ({
                                                variantId: variant.id,
                                                variantColor: variant.color,
                                                variantQuantity: variant.quantity || 0
                                            }))
                                            : [{
                                                variantId: undefined as string | undefined,
                                                variantColor: style.colorVariant || 'Base',
                                                variantQuantity: style.quantity || 0
                                            }];

                                        return style.operations.map(op => {
                                            const metric = metrics[op.id] || {
                                                localCapacity: 0,
                                                upstreamLimit: Infinity,
                                                effectiveOutput: 0,
                                                isStarved: false,
                                                assignedOps: [] as Operator[],
                                                percentFilled: 0,
                                                reqOperators: 0,
                                                operatorWeights: new Map<string, number>()
                                            };
                                            const variantRows = styleVariants.map(variant => {
                                                const scope: PlannerAssignmentScope = {
                                                    style: styleScope,
                                                    ...(variant.variantId ? { variantId: variant.variantId } : {})
                                                };
                                                const assignedOps = getAssignedOperators(op.id, scope);
                                                const targetForDisplay = hasVariants
                                                    ? Math.max(
                                                        0,
                                                        Math.floor((Math.max(0, styleRemainingTarget) * (variant.variantQuantity || 0)) / styleQty)
                                                    )
                                                    : Math.max(0, styleRemainingTarget);
                                                const scheduledCount = variant.variantId
                                                    ? Math.floor(
                                                        scheduledCountPerStyleVariantOp[
                                                        buildStyleVariantOpKey(styleScope, style.id, variant.variantId, op.id)
                                                        ] || 0
                                                    )
                                                    : Math.floor(scheduledCountPerOp[op.id] || 0);

                                                return {
                                                    ...variant,
                                                    scope,
                                                    assignedOps,
                                                    targetForDisplay,
                                                    scheduledCount,
                                                };
                                            });

                                            const totalScheduled = variantRows.reduce((sum, row) => sum + row.scheduledCount, 0);
                                            const totalTarget = hasVariants
                                                ? variantRows.reduce((sum, row) => sum + row.targetForDisplay, 0)
                                                : Math.max(0, styleRemainingTarget);
                                            const isTargetMet = totalTarget > 0 ? totalScheduled >= totalTarget : false;
                                            const isNearTarget = totalTarget > 0 ? totalScheduled >= totalTarget * 0.8 : false;

                                            return (
                                                <TableRow key={op.id}>
                                                    <TableCell className="font-medium">
                                                        <div className="flex flex-col">
                                                            <span>{op.name}</span>
                                                            {op.dependencies?.length > 0 && (
                                                                <span className="text-[10px] text-muted-foreground">
                                                                    Dep: {op.dependencies.map(d => style.operations.find(o => o.id === d)?.name).join(', ')}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {variantRows.map(variant => (
                                                                <Badge key={`${op.id}-${variant.variantId || 'base'}-variant`} variant="outline" className="text-[10px]">
                                                                    {variant.variantColor}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>{(op.smv / 60).toFixed(2)} min</TableCell>
                                                    <TableCell><Badge variant="outline">{op.machineType}</Badge></TableCell>
                                                    <TableCell className="text-right font-bold">
                                                        {metric.reqOperators.toFixed(2)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="space-y-2">
                                                            {variantRows.map(variant => (
                                                                <div key={`${op.id}-${variant.variantId || 'base'}-assign`} className="flex flex-wrap gap-2 items-center">
                                                                    {hasVariants && (
                                                                        <span className="text-[10px] text-muted-foreground min-w-[84px]">
                                                                            {variant.variantColor}
                                                                        </span>
                                                                    )}
                                                                    {variant.assignedOps.map(opUser => {
                                                                        const weight = metric.operatorWeights?.get(opUser.id) || 1;
                                                                        const eff = (opUser.efficiencyRating || 100) * weight;

                                                                        return <Badge key={`${opUser.id}-${variant.variantId || 'base'}`} variant="secondary" className="flex items-center gap-1 pr-1" data-testid="operator-badge">
                                                                            {opUser.name}
                                                                            <span className="text-[10px] text-muted-foreground">({Math.round(eff)}%)</span>
                                                                            {operatorLoads[opUser.id] > 1 && (
                                                                                <span className="text-[10px] text-amber-600 font-bold">
                                                                                    (x{operatorLoads[opUser.id]})
                                                                                </span>
                                                                            )}
                                                                            <X
                                                                                className="h-3 w-3 cursor-pointer hover:text-destructive"
                                                                                onClick={() => handleRemoveOperator(op.id, opUser.id, variant.scope)}
                                                                                data-testid="remove-operator"
                                                                            />
                                                                        </Badge>;
                                                                    })}

                                                                    <Popover>
                                                                        <PopoverTrigger asChild>
                                                                            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full border border-dashed">
                                                                                <UserPlus className="h-3 w-3" />
                                                                            </Button>
                                                                        </PopoverTrigger>
                                                                        <PopoverContent className="p-0 w-64" align="start" avoidPortal={true}>
                                                                            <Command>
                                                                                <CommandInput placeholder="Search operator..." />
                                                                                <ScrollArea className="h-[200px]">
                                                                                    <CommandEmpty>No skilled operators found.</CommandEmpty>
                                                                                    <CommandGroup heading="Skilled">
                                                                                        {operators
                                                                                            .filter(o => !variant.assignedOps.find(ao => ao.id === o.id))
                                                                                            .filter(o => o.skills?.includes(op.machineType))
                                                                                            .map(o => (
                                                                                                <CommandItem
                                                                                                    key={o.id}
                                                                                                    onSelect={() => handleAssignOperator(op.id, o.id, variant.scope, variant.variantColor)}
                                                                                                >
                                                                                                    <div className="flex flex-col">
                                                                                                        <span>{o.name}</span>
                                                                                                        <span className="text-xs text-muted-foreground">Eff: {o.efficiencyRating || 100}%</span>
                                                                                                    </div>
                                                                                                </CommandItem>
                                                                                            ))}
                                                                                    </CommandGroup>
                                                                                    <CommandGroup heading="Other">
                                                                                        {operators
                                                                                            .filter(o => !variant.assignedOps.find(ao => ao.id === o.id))
                                                                                            .filter(o => !o.skills?.includes(op.machineType))
                                                                                            .map(o => (
                                                                                                <CommandItem
                                                                                                    key={o.id}
                                                                                                    onSelect={() => handleAssignOperator(op.id, o.id, variant.scope, variant.variantColor)}
                                                                                                    className="opacity-50"
                                                                                                >
                                                                                                    <div className="flex flex-col">
                                                                                                        <span>{o.name}</span>
                                                                                                        <span className="text-xs text-muted-foreground">No matching skill</span>
                                                                                                    </div>
                                                                                                </CommandItem>
                                                                                            ))}
                                                                                    </CommandGroup>
                                                                                </ScrollArea>
                                                                            </Command>
                                                                        </PopoverContent>
                                                                    </Popover>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex flex-col items-end gap-0.5">
                                                            <span className={`text-sm font-semibold ${isTargetMet
                                                                ? 'text-green-600'
                                                                : isNearTarget
                                                                ? 'text-amber-600'
                                                                : 'text-red-600'
                                                                }`}>
                                                                {totalScheduled}
                                                            </span>
                                                            <span className="text-[10px] text-muted-foreground">
                                                                / {totalTarget} units
                                                            </span>
                                                            {hasVariants && (
                                                                <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground text-right">
                                                                    {variantRows.map(variant => (
                                                                        <div key={`${op.id}-${variant.variantId || 'base'}-target`}>
                                                                            {variant.variantColor}: {variant.scheduledCount} / {variant.targetForDisplay}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <div className="flex flex-col items-center gap-1">
                                                            {metric.isStarved ? (
                                                                <div className="flex flex-col items-center justify-center text-amber-600" title={`Restricted by Flow`}>
                                                                    <AlertCircle className="h-4 w-4 mb-0.5" />
                                                                    <span className="text-[10px] font-bold">STARVED</span>
                                                                    <span className="text-[9px] opacity-80 whitespace-nowrap">
                                                                        (Wait for {op.dependencies?.map(d => style.operations.find(o => o.id === d)?.name).join(',') || 'Input'})
                                                                    </span>
                                                                </div>
                                                            ) : totalTarget > 0 && totalScheduled >= totalTarget ? (
                                                                <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" />
                                                            ) : (
                                                                <div className="flex items-center justify-center text-amber-500" title={`Local Capacity: ${Math.floor(metric.localCapacity)}`}>
                                                                    <span className="text-xs">{Math.round(metric.percentFilled)}% Cap</span>
                                                                </div>
                                                            )}

                                                            {metric.localCapacity > 0 && (
                                                                <Badge variant="outline" className={`text-[9px] h-4 px-1 ${(metric.effectiveOutput / metric.localCapacity) > 0.95 ? "bg-green-50 text-green-700 border-green-200" :
                                                                    (metric.effectiveOutput / metric.localCapacity) > 0.80 ? "bg-amber-50 text-amber-700 border-amber-200" :
                                                                        "bg-red-50 text-red-700 border-red-200"
                                                                    }`}>
                                                                    Flow: {Math.round((metric.effectiveOutput / metric.localCapacity) * 100)}%
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        });
                                    })()}
                                </TableBody>
                            </Table>
                        </div>
                    );
                })}

                {/* Visual Timeline */}
                {selectedStyle && allPlannerAssignments.length > 0 && (
                    <>
                        <div className="flex items-center justify-between mb-4 mt-8">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                <CalendarClock className="h-5 w-5" />
                                Visual Timeline
                            </h3>
                            <Button
                                onClick={handlePublishSchedule}
                                disabled={isPublishing || !simResult.schedule}
                                className="bg-green-600 hover:bg-green-700 text-white"
                            >
                                {isPublishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Publish Plan
                            </Button>
                        </div>

                        <div className="flex flex-wrap gap-6 mb-4 px-4 py-3 bg-muted/30 rounded-lg border border-border/50">
                            {selectedStyle && (
                                <div className="flex items-center gap-3">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Primary</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-foreground">{selectedStyle.name}</span>
                                        {selectedStyle.colorVariant && (
                                            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs font-medium border border-blue-200 dark:border-blue-800">
                                                {selectedStyle.colorVariant}
                                            </span>
                                        )}
                                        <span className="text-muted-foreground text-sm">({selectedStyle.quantity} pcs)</span>
                                    </div>
                                </div>
                            )}
                            {selectedNextStyle && (
                                <div className="flex items-center gap-3 pl-6 border-l border-border/50">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-foreground">{selectedNextStyle.name}</span>
                                        {selectedNextStyle.colorVariant && (
                                            <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 text-xs font-medium border border-orange-200 dark:border-orange-800">
                                                {selectedNextStyle.colorVariant}
                                            </span>
                                        )}
                                        <span className="text-muted-foreground text-sm">({selectedNextStyle.quantity} pcs)</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <DailyTimeline
                            assignedOperators={
                                unique(allPlannerAssignments.flatMap(a => a.operatorIds))
                                    .map(id => operators.find(o => o.id === id)!)
                                    .filter(Boolean)
                            }
                            assignments={allPlannerAssignments}
                            selectedStyle={selectedStyle}
                            selectedNextStyle={selectedNextStyle}
                            flowMetrics={{ ...flowMetrics, ...nextFlowMetrics }}
                            availableMinutes={availableMinutes + (
                                Object.values(operatorAttendance).reduce((max, curr) => Math.max(max, curr.shiftExtension || 0), 0)
                            )}
                            schedule={simResult.schedule}
                            productionLogs={(todayProductionLogs || []).filter(log =>
                                log.styleId === selectedStyle.id || log.styleId === selectedNextStyle?.id
                            )}
                            isOrderComplete={isPlannedOrderComplete}
                            switchDelay={switchDelay}
                        />
                    </>
                )}

                {selectedStyle && instructions.length > 0 && (
                    <Card className="mt-6 border-dashed shadow-sm">
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between gap-2">
                                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                                    <ClipboardList className="h-5 w-5 text-indigo-500" />
                                    Operational Execution Guide
                                </CardTitle>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowExecutionGuide(prev => !prev)}
                                    className="h-7 px-2"
                                >
                                    {showExecutionGuide ? (
                                        <>
                                            <ChevronUp className="h-4 w-4 mr-1" />
                                            Collapse
                                        </>
                                    ) : (
                                        <>
                                            <ChevronDown className="h-4 w-4 mr-1" />
                                            Expand
                                        </>
                                    )}
                                </Button>
                            </div>
                        </CardHeader>
                        {showExecutionGuide && (
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {instructions.map(inst => (
                                        <div key={inst.operatorId} className={`relative p-4 rounded-lg border text-sm transition-colors ${inst.type === 'focus' ? 'bg-secondary/20 border-secondary/50' :
                                            inst.type === 'flow' ? 'bg-amber-500/10 border-amber-500/30' :
                                                'bg-blue-500/10 border-blue-500/30'
                                            }`}>
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="font-bold text-foreground">{inst.name}</div>
                                                <Badge variant={inst.type === 'focus' ? 'secondary' : 'outline'} className="text-[10px] h-5">
                                                    {inst.type === 'focus' ? 'Single Role' : 'Multi-Task'}
                                                </Badge>
                                            </div>
                                            <div className="mb-3 text-muted-foreground text-xs font-medium">
                                                Assignments: {inst.operations.join(', ')}
                                            </div>
                                            <div className="flex items-start gap-2 bg-background/80 p-2 rounded border border-border/50">
                                                {inst.type === 'focus' ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-500 shrink-0" /> : <RefreshCcw className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />}
                                                <p className="italic text-xs leading-relaxed text-foreground/90">{inst.advice}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        )}
                    </Card>
                )}
            </CardContent>
        </Card >
    );
}
