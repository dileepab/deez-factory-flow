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
import type { GarmentStyle, Operator, AnyUser, Assignment, ProductionEntry, BreakConfig } from '@/lib/types';
import { cloneDefaultBreaks } from '@/lib/shift-schedule';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { useMachineTypes } from '@/hooks/use-machine-types';
import { Loader2, UserPlus, X, CheckCircle2, AlertCircle, Wand2, ClipboardList, RefreshCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MultiSelect, Option } from '@/components/ui/multi-select';
import { DailyTimeline } from './daily-timeline';
import { OperatorJobCards } from './operator-job-cards';
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
import { Save, CalendarClock, Brain, Sparkles, Coffee, Clock, Printer, Plus, Trash2 } from "lucide-react";
import { runLineBalancer } from '@/lib/actions';

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
    downstreamOverlap: 18,
    fanOut: 14,
    tinyBatch: 10,
    roleLock: 14,
} as const;
const AUTO_ASSIGN_GUARD_OUTPUT_DROP_PCT = 0.03;
const AUTO_ASSIGN_GUARD_WIP_RISE_PCT = 0.1;
const AUTO_ASSIGN_GUARD_OUTPUT_DROP_UNITS = 3;
const AUTO_ASSIGN_GUARD_WIP_RISE_UNITS = 10;

const OVERLOCK_MACHINE_TYPE = 'Overlock/Serger';
const getDefaultBallsPerMachine = (machineType: string) =>
    machineType.trim() === OVERLOCK_MACHINE_TYPE ? 5 : 1;

type PlannerScope = 'primary' | 'next';
type PlannerAssignmentScope = {
    style: PlannerScope;
    variantId?: string;
};
type AutoAssignMode = 'balanced' | 'conservative';
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

const distributeOperatorsAcrossVariants = (
    variants: { id: string; quantity: number }[],
    operatorIds: string[],
    options: { allowSecondaryCoverage?: boolean } = {}
): Record<string, string[]> => {
    const allocation: Record<string, string[]> = {};
    variants.forEach(variant => { allocation[variant.id] = []; });
    const allowSecondaryCoverage = options.allowSecondaryCoverage ?? true;

    const workers = unique(operatorIds.filter(Boolean));
    if (variants.length === 0 || workers.length === 0) return allocation;
    if (workers.length === 1) {
        variants.forEach(variant => { allocation[variant.id] = [workers[0]]; });
        return allocation;
    }

    // Keep variant ownership simple: each variant gets a primary worker,
    // and each worker covers only a small number of variants when possible.
    const maxVariantsPerWorker = Math.max(1, Math.ceil(variants.length / workers.length));
    const workerVariantCount = new Map<string, number>(workers.map(uid => [uid, 0]));
    const workerLoadByQty = new Map<string, number>(workers.map(uid => [uid, 0]));

    const variantsByPriority = variants
        .map((variant, index) => ({ variant, index }))
        .sort((a, b) => {
            const qtyDelta = (b.variant.quantity || 0) - (a.variant.quantity || 0);
            if (qtyDelta !== 0) return qtyDelta;
            return a.index - b.index;
        });

    variantsByPriority.forEach(({ variant }) => {
        const chosenWorker = workers
            .slice()
            .sort((a, b) => {
                const aCount = workerVariantCount.get(a) || 0;
                const bCount = workerVariantCount.get(b) || 0;
                const aOverCap = aCount >= maxVariantsPerWorker ? 1 : 0;
                const bOverCap = bCount >= maxVariantsPerWorker ? 1 : 0;
                if (aOverCap !== bOverCap) return aOverCap - bOverCap;

                const aLoad = workerLoadByQty.get(a) || 0;
                const bLoad = workerLoadByQty.get(b) || 0;
                if (aLoad !== bLoad) return aLoad - bLoad;
                if (aCount !== bCount) return aCount - bCount;
                return a.localeCompare(b);
            })[0];

        allocation[variant.id] = [chosenWorker];
        workerVariantCount.set(chosenWorker, (workerVariantCount.get(chosenWorker) || 0) + 1);
        workerLoadByQty.set(
            chosenWorker,
            (workerLoadByQty.get(chosenWorker) || 0) + Math.max(1, variant.quantity || 0)
        );
    });

    if (allowSecondaryCoverage) {
        const unusedWorkers = workers.filter(uid => (workerVariantCount.get(uid) || 0) === 0);
        unusedWorkers.forEach(uid => {
            const targetVariant = variants
                .slice()
                .sort((a, b) => {
                    const aCount = allocation[a.id]?.length || 0;
                    const bCount = allocation[b.id]?.length || 0;
                    if (aCount !== bCount) return aCount - bCount;
                    const qtyDelta = (b.quantity || 0) - (a.quantity || 0);
                    if (qtyDelta !== 0) return qtyDelta;
                    return a.id.localeCompare(b.id);
                })
                .find(variant => !(allocation[variant.id] || []).includes(uid));

            if (!targetVariant) return;
            allocation[targetVariant.id] = unique([...(allocation[targetVariant.id] || []), uid]);
            workerVariantCount.set(uid, (workerVariantCount.get(uid) || 0) + 1);
        });
    }

    return allocation;
};

const buildStyleVariantOpKey = (
    source: PlannerScope,
    rootStyleId: string,
    variantId: string | undefined,
    operationId: string
) => `${source}::${rootStyleId}::${variantId || '__base'}::${operationId}`;


export function AIProductionPlanner(): React.ReactNode {
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
    const [isBalancing, setIsBalancing] = useState(false);
    const [aiReasoning, setAiReasoning] = useState<string | null>(null);
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
    const [breaks, setBreaks] = useState<BreakConfig[]>(() => cloneDefaultBreaks());
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

    const buildVariantAssignmentMap = useCallback((
        style: GarmentStyle,
        baseAssigns: Assignment[],
        autoMode: AutoAssignMode = 'balanced'
    ) => {
        if (!style.variants || style.variants.length === 0) return {};
        const map: Record<string, Assignment[]> = {};
        style.variants.forEach(variant => { map[variant.id] = []; });
        const styleTotalSmv = style.totalSmv || style.operations.reduce((sum, op) => sum + (op.smv || 0), 0);
        const mappedOperators = unique(baseAssigns.flatMap(item => item.operatorIds));
        const demandMinutes = Math.max(0, (style.quantity || 0) * styleTotalSmv);
        const capacityMinutes = Math.max(1, availableMinutes * Math.max(1, mappedOperators.length));
        const demandPressure = demandMinutes / capacityMinutes;
        const allowSecondaryCoverage = autoMode !== 'conservative' || demandPressure >= 0.85;

        baseAssigns.forEach(assignment => {
            const workers = unique(assignment.operatorIds);
            if (workers.length === 0) return;

            const byVariantWorkers = distributeOperatorsAcrossVariants(style.variants!, workers, {
                allowSecondaryCoverage
            });
            style.variants!.forEach(variant => {
                const scopedWorkers = byVariantWorkers[variant.id] || [];
                if (scopedWorkers.length === 0) return;
                map[variant.id].push({
                    operationId: assignment.operationId,
                    operatorIds: scopedWorkers,
                    variantId: variant.id,
                    variantColor: variant.color,
                });
            });
        });

        return map;
    }, [availableMinutes]);

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

    const buildThreadConstraintConfig = useCallback((
        inventoryByColor: Record<string, number>,
        enabled: boolean = enableThreadConstraints
    ): ThreadConstraintConfig | undefined => {
        if (!enabled || activeThreadColors.length === 0 || activeThreadMachineTypes.length === 0) {
            return undefined;
        }

        const machineRules: Record<string, { ballsPerMachine: number; availableByColor: Record<string, number> }> = {};
        activeThreadMachineTypes.forEach(machineType => {
            const ballsPerMachine = defaultThreadBallsByMachine[machineType] ?? getDefaultBallsPerMachine(machineType);

            const availableByColor: Record<string, number> = {};
            activeThreadColors.forEach(color => {
                const value = inventoryByColor[color];
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
        defaultThreadColorInventory
    ]);

    const threadConstraintConfig = useMemo<ThreadConstraintConfig | undefined>(
        () => buildThreadConstraintConfig(threadInventoryByColor),
        [buildThreadConstraintConfig, threadInventoryByColor]
    );

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

    const evaluatePlanQuality = useCallback((
        primaryAssignments: Assignment[],
        primaryVariantAssignments: Record<string, Assignment[]>,
        nextStyleAssignments: Assignment[],
        nextStyleVariantAssignments: Record<string, Assignment[]>,
        threadConfigOverride?: ThreadConstraintConfig
    ) => {
        if (!selectedStyle) return null;
        if (!hasAnyScopedAssignments(primaryAssignments, primaryVariantAssignments)) {
            return { actualOutput: 0, estimatedWip: 0 };
        }

        const simInput = buildSimulationInputs(
            selectedStyle,
            primaryAssignments,
            primaryVariantAssignments,
            selectedNextStyle,
            nextStyleAssignments,
            nextStyleVariantAssignments
        );
        const simulated = simulateProductionSchedule(
            simInput.simulationStyles,
            simInput.simulationAssignments,
            operators,
            machineCounts,
            availableMinutes,
            switchDelay,
            operatorAttendance,
            learnedPerformance,
            undefined,
            threadConfigOverride ?? threadConstraintConfig
        );

        const output = calculateBottleneckForSchedule(selectedStyle, selectedNextStyle, simulated.schedule);
        const actualOutput = output.primary + output.next;

        const countByStyleOp = new Map<string, number>();
        Object.values(simulated.schedule).forEach(events => {
            events.forEach(event => {
                const styleIndex = typeof event.styleIndex === 'number' ? event.styleIndex : 0;
                const slot = simInput.styleSlots[styleIndex];
                if (!slot) return;
                const key = `${slot.rootStyleId}::${event.opId}`;
                countByStyleOp.set(key, (countByStyleOp.get(key) || 0) + event.count);
            });
        });

        const estimateWipForStyle = (style?: GarmentStyle) => {
            if (!style) return 0;
            let total = 0;
            style.operations.forEach(op => {
                const opKey = `${style.id}::${op.id}`;
                const outputCount = countByStyleOp.get(opKey) || 0;
                const successors = style.operations.filter(next => next.dependencies?.includes(op.id));
                if (successors.length === 0) return;
                const downstream = Math.min(
                    ...successors.map(next => countByStyleOp.get(`${style.id}::${next.id}`) || 0)
                );
                total += Math.max(0, outputCount - downstream);
            });
            return total;
        };

        const estimatedWip = estimateWipForStyle(selectedStyle) + estimateWipForStyle(selectedNextStyle);
        return { actualOutput, estimatedWip };
    }, [
        selectedStyle,
        selectedNextStyle,
        hasAnyScopedAssignments,
        buildSimulationInputs,
        operators,
        machineCounts,
        availableMinutes,
        switchDelay,
        operatorAttendance,
        learnedPerformance,
        threadConstraintConfig,
        calculateBottleneckForSchedule
    ]);

    const isPlanRegression = useCallback((
        baseline: { actualOutput: number; estimatedWip: number },
        candidate: { actualOutput: number; estimatedWip: number }
    ) => {
        const outputDrop = baseline.actualOutput - candidate.actualOutput;
        const outputDropPct = baseline.actualOutput > 0 ? outputDrop / baseline.actualOutput : 0;
        const wipRise = candidate.estimatedWip - baseline.estimatedWip;
        const wipRisePct = baseline.estimatedWip > 0 ? wipRise / baseline.estimatedWip : (wipRise > 0 ? 1 : 0);

        const isOutputRegression =
            outputDrop >= AUTO_ASSIGN_GUARD_OUTPUT_DROP_UNITS &&
            outputDropPct >= AUTO_ASSIGN_GUARD_OUTPUT_DROP_PCT;
        const isWipRegression =
            wipRise >= AUTO_ASSIGN_GUARD_WIP_RISE_UNITS &&
            wipRisePct >= AUTO_ASSIGN_GUARD_WIP_RISE_PCT;

        return isOutputRegression && isWipRegression;
    }, []);

    const handleThreadInventoryChange = useCallback((color: string, rawValue: string) => {
        const value = Math.max(0, parseInt(rawValue) || 0);
        const nextInventory = {
            ...threadInventoryByColor,
            [color]: value
        };

        if (!selectedStyle || !enableThreadConstraints) {
            setThreadInventoryByColor(nextInventory);
            return;
        }

        const hasBaselinePlan = hasAnyScopedAssignments(assignments, variantAssignments);
        if (!hasBaselinePlan) {
            setThreadInventoryByColor(nextInventory);
            return;
        }

        const baseline = evaluatePlanQuality(
            assignments,
            variantAssignments,
            nextAssignments,
            nextVariantAssignments
        );
        const candidateThreadConfig = buildThreadConstraintConfig(nextInventory, true);
        const candidate = evaluatePlanQuality(
            assignments,
            variantAssignments,
            nextAssignments,
            nextVariantAssignments,
            candidateThreadConfig
        );

        if (baseline && candidate && isPlanRegression(baseline, candidate)) {
            toast({
                title: 'Auto Assign Guard Applied',
                description: `Thread change blocked (output ${baseline.actualOutput} > ${candidate.actualOutput}, WIP ${baseline.estimatedWip} < ${candidate.estimatedWip}).`,
            });
            return;
        }

        setThreadInventoryByColor(nextInventory);
    }, [
        threadInventoryByColor,
        selectedStyle,
        enableThreadConstraints,
        hasAnyScopedAssignments,
        assignments,
        variantAssignments,
        nextAssignments,
        nextVariantAssignments,
        evaluatePlanQuality,
        buildThreadConstraintConfig,
        isPlanRegression,
        toast
    ]);

    // AI Line Balancer Handler
    const handleAILineBalance = useCallback(async () => {
        if (!selectedStyle) return;
        setIsBalancing(true);
        setAiReasoning(null);
        try {
            const candidatesPool = operators.filter(o => availableOperatorIds.includes(o.id));
            const buildBalancerInput = (style: GarmentStyle, operatorPool: typeof candidatesPool = candidatesPool) => ({
                style: {
                    id: style.id,
                    name: style.name,
                    quantity: style.quantity || 0,
                    totalSmv: style.totalSmv || 0,
                    operations: style.operations.map(op => ({
                        id: op.id,
                        name: op.name,
                        smv: op.smv,
                        machineType: op.machineType,
                        dependencies: op.dependencies || []
                    }))
                },
                operators: operatorPool.map(o => ({
                    id: o.id,
                    name: o.name,
                    skills: o.skills || [],
                    efficiency: o.efficiencyRating || 100,
                    reworkRate: o.rework || 0
                })),
                machineCounts: machineCounts
            });

            const result = await runLineBalancer(buildBalancerInput(selectedStyle));
            if ('error' in result) {
                throw new Error(result.error);
            }

            const computedPrimary: Assignment[] = result.assignments.map(a => ({
                operationId: a.operationId,
                operatorIds: a.operatorIds
            }));

            setAssignments(computedPrimary);
            setVariantAssignments(buildVariantAssignmentMap(selectedStyle, computedPrimary));
            setAiReasoning(result.reasoning);

            // Continuous Flow: auto-assign the next style to soak up idle capacity —
            // but capacity-aware, so it does NOT steal the primary's bottleneck.
            if (selectedNextStyle) {
                try {
                    // 1. Find the primary's binding-constraint operator(s) from a
                    //    primary-only simulation: the operator(s) on the terminal
                    //    operation with the lowest finished count. Their "idle" time is
                    //    constraint buffer, not free capacity, so it must be reserved.
                    let constraintOperatorIds: string[] = [];
                    try {
                        const primarySim = simulateProductionSchedule(
                            [selectedStyle], [computedPrimary], candidatesPool, machineCounts, availableMinutes, switchDelay
                        );
                        const counts: Record<string, number> = {};
                        Object.values(primarySim.schedule).forEach((segs: any[]) =>
                            segs.forEach(s => { counts[s.opId] = (counts[s.opId] || 0) + s.count; })
                        );
                        const feedsSomething = new Set<string>();
                        selectedStyle.operations.forEach(op => (op.dependencies || []).forEach(d => feedsSomething.add(d)));
                        const terminals = selectedStyle.operations.filter(op => !feedsSomething.has(op.id));
                        let bindingOpId: string | null = null;
                        let minCount = Infinity;
                        terminals.forEach(op => {
                            const c = counts[op.id] || 0;
                            if (c < minCount) { minCount = c; bindingOpId = op.id; }
                        });
                        if (bindingOpId) {
                            constraintOperatorIds = computedPrimary.find(a => a.operationId === bindingOpId)?.operatorIds || [];
                        }
                    } catch (simErr) {
                        console.error("Primary constraint detection failed:", simErr);
                    }

                    // 2. For the next style, reserve each constraint operator to their
                    //    UNIQUE skill(s) only. They can still cover a next-style op that
                    //    nobody else can do (their scarce skill), but they can't be
                    //    pulled onto shared-skill work that would starve the primary's
                    //    bottleneck. Everyone else keeps their full skill set.
                    const skillHolderCount: Record<string, number> = {};
                    candidatesPool.forEach(o => (o.skills || []).forEach(sk => {
                        skillHolderCount[sk] = (skillHolderCount[sk] || 0) + 1;
                    }));
                    const nextOperatorPool = candidatesPool.map(o => {
                        if (!constraintOperatorIds.includes(o.id)) return o;
                        const uniqueSkills = (o.skills || []).filter(sk => skillHolderCount[sk] === 1);
                        return uniqueSkills.length > 0 ? { ...o, skills: uniqueSkills } : o;
                    });

                    const nextResult = await runLineBalancer(buildBalancerInput(selectedNextStyle, nextOperatorPool));
                    if (!('error' in nextResult)) {
                        const computedNext: Assignment[] = nextResult.assignments.map(a => ({
                            operationId: a.operationId,
                            operatorIds: a.operatorIds
                        }));
                        setNextAssignments(computedNext);
                        setNextVariantAssignments(buildVariantAssignmentMap(selectedNextStyle, computedNext));
                    }
                } catch (nextErr) {
                    console.error("Next-style balancing failed:", nextErr);
                }
            }

            toast({
                title: selectedNextStyle ? "Both Styles Balanced by AI" : "Line Balanced by AI",
                description: selectedNextStyle
                    ? "Primary style optimized and the next style assigned to soak up idle capacity."
                    : "The line has been successfully optimized for maximum output.",
            });
        } catch (error: any) {
            console.error("AI Balancing Error:", error);
            toast({
                title: "AI Balancing Failed",
                description: error.message || "Failed to optimize line using AI. Please try again.",
                variant: "destructive"
            });
        } finally {
            setIsBalancing(false);
        }
    }, [
        selectedStyle,
        selectedNextStyle,
        operators,
        availableOperatorIds,
        machineCounts,
        buildVariantAssignmentMap,
        toast
    ]);

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
                <div className="flex flex-col gap-4 mb-6 p-2 md:p-0">
                    <div className="rounded-md border bg-background p-4 space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                            <div>
                                <h4 className="text-sm font-semibold">Planning Setup</h4>
                                <p className="text-xs text-muted-foreground">Choose style, team mode, and planning inputs.</p>
                            </div>
                            {selectedStyle && (
                                <div className="text-xs text-muted-foreground">
                                    Current style: <span className="font-medium text-foreground">{selectedStyle.name}</span>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-end">
                            <div className="space-y-2">
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
                            <div className="space-y-2">
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

                            <div className="space-y-2">
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

                            <div className="space-y-2">
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

                            <div className="space-y-2">
                            <label className="text-sm font-medium">Switch Delay (min)</label>
                            <Input
                                type="number"
                                value={switchDelay}
                                onChange={(e) => setSwitchDelay(Number(e.target.value))}
                                min={0}
                            />
                        </div>
                        </div>

                        </div>

                    <div className="rounded-md border bg-muted/20 p-3 space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Forecast Snapshot</div>
                    {planningMode === 'capacity' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                        <div className="p-3 bg-background rounded-md border flex justify-between items-center">
                            <span className="text-sm font-medium">Estimated Operators Needed:</span>
                            <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-bold text-primary">
                                    {Math.ceil((dailyTarget * selectedStyle.totalSmv) / availableMinutes)}
                                </span>
                                <span className="text-sm text-muted-foreground">operators</span>
                            </div>
                        </div>
                    )}
                    </div>

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

                    <div className="rounded-md border bg-background p-4 space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                            <div>
                                <h4 className="text-sm font-semibold">Execution Controls</h4>
                                <p className="text-xs text-muted-foreground">
                                    Lock assignment behavior, manage attendance, and run rebalancing.
                                </p>
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {selectedStyle ? 'Ready to optimize current plan' : 'Select a style to enable planning actions'}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-3 items-end">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="border-dashed w-full lg:w-auto justify-start">
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
                                                    const BREAK_MINUTES = breaks.reduce((sum, b) => sum + b.duration, 0);
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
                                                    const BREAK_MINUTES = breaks.reduce((sum, b) => sum + b.duration, 0);
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

                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="border-dashed w-full lg:w-auto justify-start">
                                        <Coffee className="mr-2 h-4 w-4" />
                                        Manage Breaks
                                        {breaks.length > 0 && (
                                            <Badge variant="secondary" className="ml-2">
                                                {breaks.length}
                                            </Badge>
                                        )}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-96 p-4" align="start">
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h4 className="font-medium leading-none">Break Schedule</h4>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 px-2 text-xs text-muted-foreground"
                                                onClick={() => setBreaks(cloneDefaultBreaks())}
                                            >
                                                Reset
                                            </Button>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Tea/lunch breaks pause the line. Times are relative to the shift
                                            start ({shiftStartTime}). Total: {breaks.reduce((s, b) => s + b.duration, 0)}m.
                                        </p>

                                        <div className="grid grid-cols-[1fr,70px,56px,28px] gap-2 text-[10px] font-medium text-muted-foreground">
                                            <span>Name</span>
                                            <span className="text-center">Start</span>
                                            <span className="text-center">Mins</span>
                                            <span />
                                        </div>

                                        <div className="grid gap-2 max-h-[260px] overflow-y-auto pr-1">
                                            {[...breaks].sort((a, b) => a.start - b.start).map(brk => {
                                                const [sh, sm] = shiftStartTime.split(':').map(Number);
                                                const startBase = (sh * 60) + sm;
                                                const clockMins = startBase + brk.start;
                                                const clockStr = `${String(Math.floor(clockMins / 60) % 24).padStart(2, '0')}:${String(clockMins % 60).padStart(2, '0')}`;

                                                const updateBreak = (patch: Partial<BreakConfig>) =>
                                                    setBreaks(prev => prev.map(b => b.id === brk.id ? { ...b, ...patch } : b));

                                                return (
                                                    <div key={brk.id} className="grid grid-cols-[1fr,70px,56px,28px] gap-2 items-center">
                                                        <Input
                                                            className="h-7 text-xs"
                                                            value={brk.name}
                                                            onChange={(e) => updateBreak({ name: e.target.value })}
                                                        />
                                                        <Input
                                                            type="time"
                                                            className="h-7 p-1 text-center text-[10px]"
                                                            value={clockStr}
                                                            onChange={(e) => {
                                                                const [ih, im] = e.target.value.split(':').map(Number);
                                                                if (Number.isNaN(ih) || Number.isNaN(im)) return;
                                                                updateBreak({ start: Math.max(0, ((ih * 60) + im) - startBase) });
                                                            }}
                                                        />
                                                        <Input
                                                            type="number"
                                                            min={1}
                                                            className="h-7 p-1 text-center text-[10px]"
                                                            value={brk.duration}
                                                            onChange={(e) => updateBreak({ duration: Math.max(1, parseInt(e.target.value) || 1) })}
                                                        />
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-muted-foreground hover:text-red-500"
                                                            onClick={() => setBreaks(prev => prev.filter(b => b.id !== brk.id))}
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                );
                                            })}
                                            {breaks.length === 0 && (
                                                <p className="text-xs text-muted-foreground italic py-2 text-center">
                                                    No breaks — the line runs straight through the shift.
                                                </p>
                                            )}
                                        </div>

                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full"
                                            onClick={() => {
                                                const lastStart = breaks.reduce((max, b) => Math.max(max, b.start), 0);
                                                setBreaks(prev => [...prev, {
                                                    id: `brk-${Date.now()}`,
                                                    name: 'Break',
                                                    start: lastStart + 120,
                                                    duration: 15,
                                                }]);
                                            }}
                                        >
                                            <Plus className="mr-2 h-3.5 w-3.5" />
                                            Add Break
                                        </Button>
                                    </div>
                                </PopoverContent>
                            </Popover>

                            <Button
                                className="w-full lg:w-auto bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white hover:from-indigo-600 hover:to-pink-600 border-none shadow-md shadow-purple-500/20"
                                onClick={handleAILineBalance}
                                disabled={!selectedStyle || isBalancing}
                            >
                                {isBalancing ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        AI Balancing...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="mr-2 h-4 w-4" />
                                        AI Balance Line
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>

                    {selectedStyle && (
                        <div className="rounded-md border bg-muted/20 p-4 space-y-4">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                <div>
                                    <h4 className="text-sm font-semibold">Resource Constraints</h4>
                                    <p className="text-xs text-muted-foreground">
                                        Define machine capacity and color-thread limits for this planning run.
                                    </p>
                                </div>
                            </div>

                            <div className={`grid gap-4 ${activeThreadColors.length > 0 && activeThreadMachineTypes.length > 0 ? 'xl:grid-cols-2' : 'grid-cols-1'}`}>
                                <div className="rounded-md border bg-background p-3 space-y-3">
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Machine Inventory (Constraints)
                                    </h4>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                                </div>

                                {activeThreadColors.length > 0 && activeThreadMachineTypes.length > 0 && (
                                    <div className="rounded-md border bg-background p-3 space-y-3">
                                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
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
                                                                onChange={(e) => handleThreadInventoryChange(color, e.target.value)}
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

                {/* AI Balancing Reasoning Panel */}
                {selectedStyle && aiReasoning && (
                    <Card className="mt-6 border-indigo-200 dark:border-indigo-800 bg-indigo-50/10 dark:bg-indigo-950/10 shadow-sm">
                        <CardHeader className="pb-2">
                            <CardTitle className="flex items-center gap-2 text-base font-semibold text-indigo-700 dark:text-indigo-400">
                                <Brain className="h-5 w-5 text-indigo-500" />
                                AI Balance Reasoning & Strategy
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pb-4">
                            <div className="text-xs md:text-sm text-foreground/90 whitespace-pre-line leading-relaxed">
                                {aiReasoning}
                            </div>
                        </CardContent>
                    </Card>
                )}

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
                            shiftStartTime={shiftStartTime}
                            breaks={breaks}
                        />

                        <OperatorJobCards
                            assignedOperators={
                                unique(allPlannerAssignments.flatMap(a => a.operatorIds))
                                    .map(id => operators.find(o => o.id === id)!)
                                    .filter(Boolean)
                            }
                            assignments={allPlannerAssignments}
                            selectedStyle={selectedStyle}
                            selectedNextStyle={selectedNextStyle}
                            schedule={simResult.schedule}
                            availableMinutes={availableMinutes + (
                                Object.values(operatorAttendance).reduce((max, curr) => Math.max(max, curr.shiftExtension || 0), 0)
                            )}
                            shiftStartTime={shiftStartTime}
                            breaks={breaks}
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
