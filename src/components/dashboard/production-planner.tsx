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
import type { GarmentStyle, Operator, AnyUser, Assignment } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { useMachineTypes } from '@/hooks/use-machine-types';
import { Loader2, UserPlus, X, CheckCircle2, AlertCircle, Wand2, ClipboardList, RefreshCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MultiSelect, Option } from '@/components/ui/multi-select';
import { DailyTimeline } from './daily-timeline';
import { simulateProductionSchedule, solveFluidCapacity, unique } from '@/lib/simulation-engine';
import { useAuth } from "@/auth-provider";
import { useToast } from "@/hooks/use-toast";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import type { DailyPlan, ScheduleSegment } from "@/lib/types";
import { format } from "date-fns";
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



export function ProductionPlanner(): React.ReactNode {
    const { user } = useAuth();
    const { toast } = useToast();
    const { data: config } = useConfiguration();
    const { machineCounts: globalMachineCounts } = useMachineTypes();
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
    const [planningMode, setPlanningMode] = useState<'target' | 'capacity'>('capacity');
    const [availableOperatorIds, setAvailableOperatorIds] = useState<string[]>([]);
    const [machineCounts, setMachineCounts] = useState<Record<string, number>>({});
    const [operatorAttendance, setOperatorAttendance] = useState<Record<string, { startDelay: number, shiftExtension: number }>>({});
    const [shiftStartTime, setShiftStartTime] = useState<string>("07:30");

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
                assignments: [...assignments, ...nextAssignments],
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

    // Simulate Schedule for Visualization
    const simResult = useMemo(() => {
        if (!selectedStyle || assignments.length === 0) return { schedule: {}, logs: [] };
        return simulateProductionSchedule(selectedStyle, assignments, operators, machineCounts, availableMinutes, switchDelay, selectedNextStyle, nextAssignments, operatorAttendance);
    }, [selectedStyle, assignments, operators, machineCounts, availableMinutes, switchDelay, selectedNextStyle, nextAssignments, operatorAttendance]);

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

                const outputCounts = calculateOutputFromEvent(ev, finalOps, nextFinalOps);
                primaryTotal += outputCounts.primary;
                nextTotal += outputCounts.next;
            });
        });

        return { primary: Math.floor(primaryTotal), next: Math.floor(nextTotal) };
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
                                        <TableHead className="text-right">Daily Target</TableHead>
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

                                                            return <Badge key={opUser.id} variant="secondary" className="flex items-center gap-1 pr-1" data-testid="operator-badge">
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
                                                                    data-testid="remove-operator"
                                                                />
                                                            </Badge>

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
                                                <TableCell className="text-right">
                                                    <div className="flex flex-col items-end gap-0.5">
                                                        <span className={`text-sm font-semibold ${(scheduledCountPerOp[op.id] || 0) >= dailyTarget
                                                            ? 'text-green-600'
                                                            : (scheduledCountPerOp[op.id] || 0) >= dailyTarget * 0.8
                                                                ? 'text-amber-600'
                                                                : 'text-red-600'
                                                            }`}>
                                                            {Math.floor(scheduledCountPerOp[op.id] || 0)}
                                                        </span>
                                                        <span className="text-[10px] text-muted-foreground">
                                                            / {dailyTarget} units
                                                        </span>
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
                {selectedStyle && (assignments.length > 0 || nextAssignments.length > 0) && (
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
                        {/* Placeholder until logs are fetched or passed in */}
                        {(() => {
                            const productionLogs: any[] = [];
                            return (
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
                                    availableMinutes={availableMinutes + (
                                        Object.values(operatorAttendance).reduce((max, curr) => Math.max(max, curr.shiftExtension || 0), 0)
                                    )}
                                    schedule={simResult.schedule}
                                    productionLogs={productionLogs}
                                    switchDelay={switchDelay}
                                />
                            );
                        })()}
                    </>
                )}
            </CardContent>
        </Card>
    );
}