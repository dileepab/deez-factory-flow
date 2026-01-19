
import type { GarmentStyle, Operator, Assignment } from '@/lib/types';

// Helper: Filter unique items
export const unique = <T,>(arr: T[]) => Array.from(new Set(arr));

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
export const solveFluidCapacity = (
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
