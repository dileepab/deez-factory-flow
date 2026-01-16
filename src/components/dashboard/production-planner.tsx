'use client';

import { useState, useMemo, useEffect } from 'react';
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
import type { GarmentStyle, Operator, AnyUser } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { Loader2, UserPlus, X, CheckCircle2, AlertCircle, Wand2, ClipboardList, RefreshCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MultiSelect, Option } from '@/components/ui/multi-select';
import { DailyTimeline } from './daily-timeline';

interface Assignment {
    operationId: string;
    operatorIds: string[];
}

// Helper: Filter unique items (not used in this specific block, but good to keep if it was elsewhere)
const unique = <T,>(arr: T[]) => Array.from(new Set(arr));

// Helper: Simulate Minute-by-Minute Production for Timeline
// Returns a schedule of segments for each operator
export const simulateProductionSchedule = (
    style: GarmentStyle,
    assignments: Assignment[],
    operators: Operator[],
    machineCounts: Record<string, number>,
    availableMinutes: number,
    switchDelay: number = 5,
    nextStyle?: GarmentStyle,
    nextAssignments?: Assignment[]
) => {
    // 1. Setup Logging & Output
    const logs: string[] = [];
    const log = (msg: string) => { if (logs.length < 500) logs.push(msg); };
    log(`SIM START. Machines=${JSON.stringify(machineCounts)}. Delay=${switchDelay}`);

    // Track Last Machine for Delay Logic
    const operatorLastMachine = new Map<string, string>();

    // 1.1 Redundant Dependency Removal (Transitive Reduction)
    const effectiveDependencies = new Map<string, string[]>();

    // Helper to get all ancestors
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
                const otherAncestors = getAncestors(other, ancestorsMap);
                if (otherAncestors.has(dep)) {
                    toRemove.add(dep);
                }
            });
        });

        effectiveDependencies.set(op.id, originalDeps.filter(d => !toRemove.has(d)));
    });

    const schedule: Record<string, { start: number, end: number, opId: string, count: number }[]> = {};
    operators.forEach(o => schedule[o.id] = []);

    // 1.2 Calculate Ideal Weights (Target Ratios)
    const assignArr = assignments.map(a => ({ operationId: a.operationId, operatorIds: a.operatorIds }));
    const solvedWeights = solveFluidCapacity(style, assignArr, operators, machineCounts, availableMinutes);

    const targetRatios = new Map<string, Map<string, number>>();
    operators.forEach(u => targetRatios.set(u.id, new Map()));

    solvedWeights.forEach((res, opId) => {
        if (res.finalWeights) {
            res.finalWeights.forEach((w, uid) => {
                targetRatios.get(uid)?.set(opId, w);
            });
        }
    });

    const userProcessedCounts = new Map<string, Map<string, number>>();
    operators.forEach(u => userProcessedCounts.set(u.id, new Map()));

    // 1.5 Pre-calculate Successors
    const successors = new Map<string, string[]>();
    style.operations.forEach(op => {
        if (op.dependencies) {
            op.dependencies.forEach(depId => {
                const list = successors.get(depId) || [];
                list.push(op.id);
                successors.set(depId, list);
            });
        }
    });

    // 2. Initialize World State & Targets
    const inventory = new Map<string, number>();
    const remainingTargets = new Map<string, number>();
    const totalOrderQty = style.quantity || 10000;

    style.operations.forEach(op => {
        const done = op.completedQuantity || 0;
        const left = Math.max(0, totalOrderQty - done);
        remainingTargets.set(op.id, left);
    });

    // B. Calculate Initial Inventory (WIP)
    style.operations.forEach(op => {
        let myOutputBuffer = op.completedQuantity || 0;
        const consumers = style.operations.filter(c => {
            const deps = effectiveDependencies.get(c.id) || [];
            return deps.includes(op.id);
        });
        consumers.forEach(c => {
            myOutputBuffer -= (c.completedQuantity || 0);
        });
        inventory.set(op.id, Math.max(0, myOutputBuffer));
    });

    // 2.5 Initialize Next Style State
    const nextInventory = new Map<string, number>();
    const nextRemainingTargets = new Map<string, number>();
    const nextSuccessors = new Map<string, string[]>();
    const nextEffectiveDependencies = new Map<string, string[]>();
    const nextTargetRatios = new Map<string, Map<string, number>>();
    const nextUserProcessedCounts = new Map<string, Map<string, number>>();

    if (nextStyle && nextAssignments) {
        const getNextAncestors = (opId: string, memo = new Map<string, Set<string>>()): Set<string> => {
            if (memo.has(opId)) return memo.get(opId)!;
            const ancestors = new Set<string>();
            const op = nextStyle.operations.find(o => o.id === opId);
            if (op && op.dependencies) {
                op.dependencies.forEach(d => {
                    ancestors.add(d);
                    getNextAncestors(d, memo).forEach(a => ancestors.add(a));
                });
            }
            memo.set(opId, ancestors);
            return ancestors;
        };

        nextStyle.operations.forEach(op => {
            if (!op.dependencies || op.dependencies.length === 0) {
                nextEffectiveDependencies.set(op.id, []);
                return;
            }
            const originalDeps = [...op.dependencies];
            const ancestorsMap = new Map<string, Set<string>>();
            const toRemove = new Set<string>();
            originalDeps.forEach(dep => {
                originalDeps.forEach(other => {
                    if (dep === other) return;
                    if (getNextAncestors(other, ancestorsMap).has(dep)) toRemove.add(dep);
                });
            });
            nextEffectiveDependencies.set(op.id, originalDeps.filter(d => !toRemove.has(d)));
        });

        nextStyle.operations.forEach(op => {
            if (op.dependencies) {
                op.dependencies.forEach(depId => {
                    const list = nextSuccessors.get(depId) || [];
                    list.push(op.id);
                    nextSuccessors.set(depId, list);
                });
            }
        });

        const nextAssignArr = nextAssignments.map(a => ({ operationId: a.operationId, operatorIds: a.operatorIds }));
        const nextSolvedWeights = solveFluidCapacity(nextStyle, nextAssignArr, operators, machineCounts, availableMinutes);
        operators.forEach(u => nextTargetRatios.set(u.id, new Map()));
        nextSolvedWeights.forEach((res, opId) => {
            if (res.finalWeights) {
                res.finalWeights.forEach((w, uid) => {
                    nextTargetRatios.get(uid)?.set(opId, w);
                });
            }
        });
        operators.forEach(u => nextUserProcessedCounts.set(u.id, new Map()));

        const nextOrderQty = nextStyle.quantity || 10000;
        nextStyle.operations.forEach(op => {
            const done = op.completedQuantity || 0;
            const left = Math.max(0, nextOrderQty - done);
            nextRemainingTargets.set(op.id, left);

            let myOutput = op.completedQuantity || 0;
            const consumers = nextStyle.operations.filter(c => {
                const deps = nextEffectiveDependencies.get(c.id) || [];
                return deps.includes(op.id);
            });
            consumers.forEach(c => myOutput -= (c.completedQuantity || 0));
            nextInventory.set(op.id, Math.max(0, myOutput));
        });
    }

    const machineUsage = new Map<string, number>();
    const opState = new Map<string, { busyUntil: number, opId: string, startTick: number, count: number, isNextStyle?: boolean }>();

    // 3. Simulation Loop
    for (let t = 0; t < availableMinutes; t++) {

        // A. Release Resources
        const finishedIds: string[] = [];
        opState.forEach((state, uid) => {
            if (state.busyUntil <= t) {
                finishedIds.push(uid);
            }
        });

        finishedIds.forEach(uid => {
            const state = opState.get(uid)!;
            const isNext = state.isNextStyle;
            const currentStyle = isNext ? nextStyle! : style;
            const op = currentStyle.operations.find(o => o.id === state.opId);

            schedule[uid].push({
                start: state.startTick,
                end: state.busyUntil,
                opId: state.opId,
                count: state.count
            });

            if (op) {
                // Update Last Machine Type Logic
                operatorLastMachine.set(uid, op.machineType.trim());

                const mType = op.machineType.trim();
                const currentUse = machineUsage.get(mType) || 1;
                machineUsage.set(mType, Math.max(0, currentUse - 1));

                const targetInventory = isNext ? nextInventory : inventory;
                const currentInv = targetInventory.get(op.id) || 0;
                targetInventory.set(op.id, currentInv + state.count);

                const targetUserCounts = isNext ? nextUserProcessedCounts : userProcessedCounts;
                const uMap = targetUserCounts.get(uid);
                if (uMap) uMap.set(op.id, (uMap.get(op.id) || 0) + state.count);

                const targetRemaining = isNext ? nextRemainingTargets : remainingTargets;
                const left = targetRemaining.get(op.id) || 0;
                targetRemaining.set(op.id, Math.max(0, left - state.count));

                const styleLabel = isNext ? "(NEXT)" : "";
                log(`T=${t.toFixed(0)} RELEASE ${uid} ${mType}. Output ${op.name} ${styleLabel}: +${state.count}`);
            }
            opState.delete(uid);
        });

        // B. Assign Idle Operators
        operators.forEach(user => {
            if (opState.has(user.id)) return;

            const tryAssign = (
                currentStyle: GarmentStyle,
                currentAssignments: Assignment[],
                currentInventory: Map<string, number>,
                currentRemainingTargets: Map<string, number>,
                currentSuccessors: Map<string, string[]>,
                currentEffectiveDependencies: Map<string, string[]>,
                currentTargetRatios: Map<string, Map<string, number>>,
                currentUserProcessedCounts: Map<string, Map<string, number>>,
                isNext: boolean
            ): boolean => {
                const myAssignments = currentAssignments.filter(a => a.operatorIds.includes(user.id));
                if (myAssignments.length === 0) return false;

                let candidates = myAssignments
                    .map(a => currentStyle.operations.find(o => o.id === a.operationId))
                    .filter(Boolean) as typeof currentStyle.operations;

                candidates.sort((a, b) => {
                    const getInventoryScore = (op: typeof style.operations[0]) => {
                        const currentInv = currentInventory.get(op.id) || 0;
                        const succs = currentSuccessors.get(op.id) || [];
                        const isFinal = !currentSuccessors.has(op.id) || currentSuccessors.get(op.id)!.length === 0;

                        const successorBlocked = succs.some(sId => (currentInventory.get(sId) || 0) > 15);
                        if (successorBlocked) return 2;
                        if (!isFinal && currentInv < 15) return 0;
                        return 1;
                    };

                    const aInv = getInventoryScore(a);
                    const bInv = getInventoryScore(b);
                    if (aInv !== bInv) return aInv - bInv;

                    const getComplianceScore = (op: typeof style.operations[0]) => {
                        const target = currentTargetRatios.get(user.id)?.get(op.id) || 0;
                        if (target <= 0.01) return 1000;
                        const processedMap = currentUserProcessedCounts.get(user.id);
                        const currentPcs = processedMap?.get(op.id) || 0;
                        const smv = op.smv / 60;
                        const eff = (user.efficiencyRating || 100) / 100;
                        const minsSpent = (currentPcs * smv) / eff;
                        let totalMins = 0;
                        if (processedMap) {
                            processedMap.forEach((cnt, oid) => {
                                const obj = currentStyle.operations.find(o => o.id === oid);
                                if (obj) totalMins += (cnt * (obj.smv / 60)) / eff;
                            });
                        }
                        const currentShare = totalMins > 0 ? minsSpent / totalMins : 0;
                        return currentShare / target;
                    };

                    const aRatio = getComplianceScore(a);
                    const bRatio = getComplianceScore(b);
                    if (Math.abs(aRatio - bRatio) > 0.1) return aRatio - bRatio;
                    return currentStyle.operations.indexOf(a) - currentStyle.operations.indexOf(b);
                });

                for (const op of candidates) {
                    const mType = op.machineType.trim();
                    const mUsed = machineUsage.get(mType) || 0;
                    const mTotal = machineCounts[mType] || 1;
                    if (mUsed >= mTotal) continue;

                    let maxInput = Infinity;
                    const deps = currentEffectiveDependencies.get(op.id) || [];
                    if (deps.length > 0) {
                        const inputs = deps.map(d => currentInventory.get(d) || 0);
                        maxInput = Math.min(...inputs);
                    }
                    const leftToMake = currentRemainingTargets.get(op.id) || 0;
                    if (leftToMake <= 0) continue;
                    if (maxInput > leftToMake) maxInput = leftToMake;
                    if (maxInput <= 0 && deps.length > 0) continue;

                    const MIN_BATCH = 10;
                    const isEndOfShift = (availableMinutes - t) < 60;
                    if (maxInput < MIN_BATCH && !isEndOfShift && deps.length) continue;

                    const efficiency = (user.efficiencyRating || 100) / 100;
                    const smvMinutes = op.smv / 60;
                    const minutesPerPc = smvMinutes / efficiency;

                    const rawTarget = Math.floor(20 / minutesPerPc);
                    const targetPcs = Math.max(10, Math.min(100, rawTarget));
                    const actualPcs = Math.min(maxInput, targetPcs);

                    // NEW: Determine Switch Delay
                    const lastType = operatorLastMachine.get(user.id);
                    let delay = 0;
                    if (lastType && lastType !== mType) {
                        delay = switchDelay;
                    }

                    const duration = (actualPcs * minutesPerPc) + delay;

                    opState.set(user.id, {
                        busyUntil: t + duration,
                        opId: op.id,
                        startTick: t + delay,
                        count: actualPcs,
                        isNextStyle: isNext
                    });

                    machineUsage.set(mType, mUsed + 1);

                    if (deps.length > 0) {
                        deps.forEach(d => {
                            const cur = currentInventory.get(d) || 0;
                            currentInventory.set(d, cur - actualPcs);
                        });
                    }

                    const styleLabel = isNext ? "(NEXT)" : "";
                    const delayMsg = delay > 0 ? `(Delay ${delay}m)` : "";
                    log(`T=${t.toFixed(0)} CLAIM ${user.name} ${mType}. Task: ${op.name} ${styleLabel}. Batch: ${actualPcs}. ${delayMsg}`);
                    return true;
                }
                return false;
            };

            if (!tryAssign(
                style, assignments, inventory, remainingTargets, successors,
                effectiveDependencies, targetRatios, userProcessedCounts, false
            )) {
                if (nextStyle && nextAssignments) {
                    tryAssign(
                        nextStyle, nextAssignments, nextInventory, nextRemainingTargets, nextSuccessors,
                        nextEffectiveDependencies, nextTargetRatios, nextUserProcessedCounts, true
                    );
                }
            }
        });
    }

    log(`SIM COMPLETE. Processed ${availableMinutes} ticks.`);
    return { schedule, logs };
};

// Helper: Fluid Capacity Solver (Iterative Balancing)
// Distributes operator time dynamically based on bottlenecks
const solveFluidCapacity = (
    style: GarmentStyle,
    assignments: { operationId: string, operatorIds: string[] }[],
    operators: Operator[],
    machineCounts: Record<string, number>,
    availableMinutes: number
) => {
    // 1. Initialize Weights (Proportional to SMV)
    // Map<OperatorId, Map<OpId, number>> (0.0 to 1.0)
    const opWeights = new Map<string, Map<string, number>>();

    assignments.forEach(a => {
        a.operatorIds.forEach(uid => {
            if (!opWeights.has(uid)) opWeights.set(uid, new Map());
            const op = style.operations.find(o => o.id === a.operationId);
            if (op) opWeights.get(uid)!.set(a.operationId, op.smv);
        });
    });

    // Normalize initial weights to sum to 1.0 for each operator
    opWeights.forEach((weights) => {
        const total = Array.from(weights.values()).reduce((a, b) => a + b, 0);
        weights.forEach((v, k) => weights.set(k, total > 0 ? v / total : 0));
    });

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
                if (user && weight > 0) {
                    // Mins contributed = Avail * Weight
                    // Pcs = Mins / (OpSMV / 60)
                    hCap += ((user.efficiencyRating || 100) / 100 * availableMinutes * weight) / (op.smv / 60);
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
                hCap += ((user.efficiencyRating || 100) / 100 * availableMinutes * weight) / (op.smv / 60);
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

export function ProductionPlanner(): React.ReactNode {
    const { data: config } = useConfiguration();
    const [selectedStyleId, setSelectedStyleId] = useState<string>("");
    const [selectedNextStyleId, setSelectedNextStyleId] = useState<string>(""); // NEW: Next Style
    const [dailyTarget, setDailyTarget] = useState<number>(500);
    const [switchDelay, setSwitchDelay] = useState<number>(5); // Configurable Switch Delay (mins)
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [nextAssignments, setNextAssignments] = useState<Assignment[]>([]); // NEW: Assignments for Next Style
    const [planningMode, setPlanningMode] = useState<'target' | 'capacity'>('capacity');
    const [availableOperatorIds, setAvailableOperatorIds] = useState<string[]>([]);
    const [machineCounts, setMachineCounts] = useState<Record<string, number>>({});



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

    // Cast to Operator type safely
    const operators = useMemo(() =>
        (allOperators || []).filter(u => u.role === 'operator') as Operator[],
        [allOperators]);

    const selectedStyle = styles?.find(s => s.id === selectedStyleId);
    const selectedNextStyle = styles?.find(s => s.id === selectedNextStyleId); // NEW: Next Style Object

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
                types.forEach(t => { if (!next[t]) next[t] = 5; });
                return next;
            });
        }
    }, [selectedStyle?.id, selectedNextStyle?.id]);
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
            setDailyTarget(Math.floor(calculatedTarget));
        }
    }, [planningMode, availableOperatorIds, selectedStyle, availableMinutes]);

    // Clear assignments when style changes
    useEffect(() => {
        setAssignments([]);
    }, [selectedStyle?.id]);

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
                .sort((a, b) => (b.efficiencyRating || 100) - (a.efficiencyRating || 100));

            if (candidates.length > 0) {
                const best = candidates[0];
                const list = newAssignments.get(op.id) || [];
                newAssignments.set(op.id, [...list, best.id]);
            }
        });

        // Helper to Calc Global Min (Flow Aware + Fluid Output)
        const calcGlobalMin = (assignMap: Map<string, string[]>) => {
            const assignArray = Array.from(assignMap.entries()).map(([k, v]) => ({ operationId: k, operatorIds: v }));
            const solved = solveFluidCapacity(targetStyle, assignArray, operators, machineCounts, availableMinutes);

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

            let score = min * (1 - (fragmentationPenalty * 0.1));

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

            if (minDurationPenalties > 0) {
                score -= (minDurationPenalties * 50);
            }

            // MACHINE SHARING PENALTY
            let sharingPenalties = 0;
            targetStyle.operations.forEach(op => {
                const assignedCount = assignMap.get(op.id)?.length || 0;
                const mCount = machineCounts[op.machineType] || 1;
                if (assignedCount > mCount) {
                    sharingPenalties += (assignedCount - mCount);
                }
            });

            if (sharingPenalties > 0) {
                score -= (sharingPenalties * 500);
            }

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
        const cleanupSolved = solveFluidCapacity(targetStyle, cleanupAssignArr, operators, machineCounts, availableMinutes);

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

    // Actual Auto Assign Handler
    const handleAutoAssign = () => {
        if (selectedStyle) {
            setAssignments(computeAssignments(selectedStyle));
        }
        if (selectedNextStyle) {
            setNextAssignments(computeAssignments(selectedNextStyle));
        }
    };

    // Helper: Assign Operator (Supports both Primary and Next Style)
    const handleAssignOperator = (opId: string, operatorId: string) => {
        const isNext = selectedNextStyle?.operations.some(o => o.id === opId);
        const setTarget = isNext ? setNextAssignments : setAssignments;

        setTarget(prev => {
            const existing = prev.find(a => a.operationId === opId);
            if (existing) {
                if (existing.operatorIds.includes(operatorId)) return prev;
                return prev.map(a => a.operationId === opId ? { ...a, operatorIds: [...a.operatorIds, operatorId] } : a);
            }
            return [...prev, { operationId: opId, operatorIds: [operatorId] }];
        });
    };

    // Helper: Remove Operator
    const handleRemoveOperator = (opId: string, operatorId: string) => {
        const isNext = selectedNextStyle?.operations.some(o => o.id === opId);
        const setTarget = isNext ? setNextAssignments : setAssignments;

        setTarget(prev => {
            return prev.map(a => {
                if (a.operationId === opId) {
                    return { ...a, operatorIds: a.operatorIds.filter(id => id !== operatorId) };
                }
                return a;
            }).filter(a => a.operatorIds.length > 0);
        });
    };

    // Get assigned operators object for an operation (Checked against both lists)
    const getAssignedOperators = (opId: string) => {
        const isNext = selectedNextStyle?.operations.some(o => o.id === opId);
        const targetList = isNext ? nextAssignments : assignments;
        const assignment = targetList.find(a => a.operationId === opId);
        if (!assignment) return [];
        return assignment.operatorIds.map(id => operators.find(o => o.id === id)).filter(Boolean) as Operator[];
    };

    // Calculate Flow Metrics (Local + Upstream Constraints)
    const calculateMetrics = (
        style: GarmentStyle | undefined,
        assigns: Assignment[]
    ) => {
        if (!style) return {};

        // Use Fluid Solver to distribute operator capacity
        const solved = solveFluidCapacity(style, assigns, operators, machineCounts, availableMinutes);

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

    const flowMetrics = useMemo(() => calculateMetrics(selectedStyle, assignments), [selectedStyle, assignments, machineCounts, dailyTarget, availableMinutes, operators]);
    const nextFlowMetrics = useMemo(() => calculateMetrics(selectedNextStyle, nextAssignments), [selectedNextStyle, nextAssignments, machineCounts, dailyTarget, availableMinutes, operators]);

    // Global bottleneck is the minimum effective output (considering flow)
    // Simulate Schedule for Visualization
    const simResult = useMemo(() => {
        if (!selectedStyle || assignments.length === 0) return { schedule: {}, logs: [] };
        return simulateProductionSchedule(selectedStyle, assignments, operators, machineCounts, availableMinutes, switchDelay, selectedNextStyle, nextAssignments);
    }, [selectedStyle, assignments, operators, machineCounts, availableMinutes, switchDelay, selectedNextStyle, nextAssignments]);

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

        let primaryTotal = 0;
        let nextTotal = 0;

        Object.values(simResult.schedule).forEach(events => {
            events.forEach(ev => {
                // If the event OP ID matches a final op of Primary Style
                // Note: Op IDs might clash if styles are same but we handle this via simulation context normally
                // Ideally simResult should tag events with styleId. 
                // Currently simResult events don't have styleId, but we can infer or checking if opId is unique enough? 
                // Actually if same style selected twice, opIDs overlap.
                // FIX: Simulation was updated to store 'isNextStyle' in opState, but maybe not in schedule event?
                // Let's check schedule event structure. 
                // The schedule event object: { start, end, opId, count }
                // It does NOT have 'isNext'. 
                // Assume OpIDs are unique across styles usually, or we need to update simulation logic to store style tag.
                // For now, let's sum based on ID match. If same style twice, it double counts unless we distinguish.

                // WAIT: If User selects SAME style for Next, OpIDs match.
                // We need to differentiate.
                // However, without changing simulation to output style tag, we can't perfectly distinguish if IDs clash.
                // But generally styles are different.

                // Let's sum based on OpId matching FinalOps list.
                // If same style, primaryTotal will capture ALL output (which is technically correct for "Total"), 
                // but we want split.
                // For now, if styles are different, this works.

                if (finalOps.find(f => f.id === ev.opId)) {
                    primaryTotal += ev.count;
                } else if (nextFinalOps.find(f => f.id === ev.opId)) {
                    nextTotal += ev.count;
                }
            });
        });

        return { primary: Math.floor(primaryTotal), next: Math.floor(nextTotal) };
    }, [selectedStyle, selectedNextStyle, simResult.schedule]);

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

                if (hasMixedStyles) {
                    type = 'flow';
                    advice = `Transition Required. Complete Primary Style tasks (${userOps.filter(o => o.style === 'primary').map(o => o.op.name).join(', ')}), then switch to Next Style.`;
                } else {
                    // Standard Logic for single style multi-task
                    const style = userOps[0].style; // All same
                    const myOpIds = userOps.map(o => o.op.id);
                    for (const { op } of userOps) {
                        if (op.dependencies?.some(d => myOpIds.includes(d))) {
                            hasSelfDependency = true;
                        }
                    }

                    if (hasSelfDependency) {
                        type = 'flow';
                        const flowSteps = batchStrings.join(' -> ');
                        advice = `Sequential Flow Required. Perform batch: ${flowSteps}. Maintain steady flow to prevent blockage.`;
                    } else {
                        type = 'rotate';
                        const batchCycle = batchStrings.join(', then ');
                        advice = `Split / Rotation Priority. Recommended Batch Cycle: ${batchCycle}.`;
                    }
                }
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
                            <Select value={selectedNextStyleId} onValueChange={setSelectedNextStyleId}>
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

                    {planningMode === 'capacity' && (
                        <div className="flex gap-4 justify-end w-full">
                            <div className="p-3 bg-muted/50 rounded-md flex flex-col items-end min-w-[120px]">
                                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider" title="Based on team size only">Theoretical</span>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-xl font-bold text-muted-foreground">{dailyTarget}</span>
                                    <span className="text-xs text-muted-foreground">pcs</span>
                                </div>
                            </div>
                            <div className="p-3 bg-primary/10 border border-primary/20 rounded-md flex flex-col items-end min-w-[150px]">
                                <span className="text-xs text-primary font-medium uppercase tracking-wider" title="Total finished goods produced today">Actual Output</span>
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
                                {assignments.length > 0 && dailyTarget > 0 && (bottleneckOutput.primary + bottleneckOutput.next) < dailyTarget && (
                                    <div className="text-[10px] text-destructive font-medium mt-1">
                                        Loss: {(dailyTarget - (bottleneckOutput.primary + bottleneckOutput.next)).toFixed(0)} pcs ({(((dailyTarget - (bottleneckOutput.primary + bottleneckOutput.next)) / dailyTarget) * 100).toFixed(1)}%)
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
                    <div className="flex items-end mb-1">
                        <Button onClick={handleAutoAssign} disabled={!selectedStyle} variant="secondary">
                            <Wand2 className="mr-2 h-4 w-4" /> Auto Assign
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
                                        <TableHead>SMV</TableHead>
                                        <TableHead>Machine</TableHead>
                                        <TableHead className="text-right">Req. Operators</TableHead>
                                        <TableHead>Assigned Operators</TableHead>
                                        <TableHead className="text-center">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {style.operations.map(op => {
                                        const metric = metrics[op.id];
                                        if (!metric) return null;

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
                                                <TableCell>{(op.smv / 60).toFixed(2)} min</TableCell>
                                                <TableCell><Badge variant="outline">{op.machineType}</Badge></TableCell>
                                                <TableCell className="text-right font-bold">
                                                    {metric.reqOperators.toFixed(2)}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-2 items-center">
                                                        {metric.assignedOps.map(opUser => {
                                                            const weight = metric.operatorWeights?.get(opUser.id) || 1;
                                                            const eff = (opUser.efficiencyRating || 100) * weight;

                                                            return (
                                                                <Badge key={opUser.id} variant="secondary" className="flex items-center gap-1 pr-1">
                                                                    {opUser.name}
                                                                    <span className="text-[10px] text-muted-foreground">({Math.round(eff)}%)</span>
                                                                    {operatorLoads[opUser.id] > 1 && (
                                                                        <span className="text-[10px] text-amber-600 font-bold">
                                                                            (x{operatorLoads[opUser.id]})
                                                                        </span>
                                                                    )}
                                                                    <X
                                                                        className="h-3 w-3 cursor-pointer hover:text-destructive"
                                                                        onClick={() => handleRemoveOperator(op.id, opUser.id)}
                                                                    />
                                                                </Badge>
                                                            )
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
                                                                                .filter(o => !metric.assignedOps.find(ao => ao.id === o.id)) // Not already assigned
                                                                                .filter(o => o.skills?.includes(op.machineType)) // Has skill
                                                                                .map(o => (
                                                                                    <CommandItem key={o.id} onSelect={() => handleAssignOperator(op.id, o.id)}>
                                                                                        <div className="flex flex-col">
                                                                                            <span>{o.name}</span>
                                                                                            <span className="text-xs text-muted-foreground">Eff: {o.efficiencyRating || 100}%</span>
                                                                                        </div>
                                                                                    </CommandItem>
                                                                                ))}
                                                                        </CommandGroup>
                                                                        <CommandGroup heading="Other">
                                                                            {operators
                                                                                .filter(o => !metric.assignedOps.find(ao => ao.id === o.id))
                                                                                .filter(o => !o.skills?.includes(op.machineType))
                                                                                .map(o => (
                                                                                    <CommandItem key={o.id} onSelect={() => handleAssignOperator(op.id, o.id)} className="opacity-50">
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
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <div className="flex flex-col items-center gap-1">
                                                        {/* Status & Starvation */}
                                                        {metric.isStarved ? (
                                                            <div className="flex flex-col items-center justify-center text-amber-600" title={`Restricted by Flow`}>
                                                                <AlertCircle className="h-4 w-4 mb-0.5" />
                                                                <span className="text-[10px] font-bold">STARVED</span>
                                                                <span className="text-[9px] opacity-80 whitespace-nowrap">
                                                                    (Wait for {op.dependencies?.map(d => style.operations.find(o => o.id === d)?.name).join(',') || 'Input'})
                                                                </span>
                                                            </div>
                                                        ) : metric.effectiveOutput >= dailyTarget ? (
                                                            <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" />
                                                        ) : (
                                                            <div className="flex items-center justify-center text-amber-500" title={`Local Capacity: ${Math.floor(metric.localCapacity)}`}>
                                                                <span className="text-xs">{Math.round(metric.percentFilled)}% Cap</span>
                                                            </div>
                                                        )}

                                                        {/* EXPERT: Flow Efficiency KPI */}
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
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    );
                })}

                {selectedStyle && instructions.length > 0 && (
                    <Card className="mt-6 border-dashed shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base font-semibold">
                                <ClipboardList className="h-5 w-5 text-indigo-500" />
                                Operational Execution Guide
                            </CardTitle>
                        </CardHeader>
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
                            {/* {simResult && simResult.logs && simResult.logs.length > 0 && (
                                <div className="mt-6 p-4 bg-slate-950 text-green-400 text-xs font-mono h-64 overflow-y-auto rounded-md border border-slate-800 shadow-inner">
                                    <h4 className="font-bold mb-2 pb-2 border-b border-green-900/50 sticky top-0 bg-slate-950 flex justify-between">
                                        <span>Simulation Traces</span>
                                        <span className="text-green-600">{simResult.logs.length} events</span>
                                    </h4>
                                    <div className="space-y-0.5">
                                        {simResult.logs.map((L: string, i: number) => <div key={i} className="whitespace-nowrap font-mono">{L}</div>)}
                                    </div>
                                </div>
                            )} */}
                        </CardContent>
                    </Card>
                )}

                {/* Visual Timeline */}
                {/* Visual Timeline */}
                {selectedStyle && (assignments.length > 0 || nextAssignments.length > 0) && (
                    <DailyTimeline
                        assignedOperators={
                            unique([...assignments, ...nextAssignments].flatMap(a => a.operatorIds))
                                .map(id => operators.find(o => o.id === id)!)
                                .filter(Boolean)
                        }
                        assignments={[...assignments, ...nextAssignments]}
                        selectedStyle={selectedStyle}
                        selectedNextStyle={selectedNextStyle}
                        flowMetrics={flowMetrics}
                        availableMinutes={availableMinutes}
                        schedule={simResult.schedule}
                    />
                )}
            </CardContent>
        </Card>
    );
}