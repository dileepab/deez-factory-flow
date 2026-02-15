
import type { GarmentStyle, Operator, Assignment } from '@/lib/types';

// Helper: Filter unique items
export const unique = <T,>(arr: T[]) => Array.from(new Set(arr));

// Helper: Simulate Minute-by-Minute Production for Timeline
// Returns a schedule of segments for each operator
export const simulateProductionSchedule = (
    styles: GarmentStyle[],
    allAssignments: Assignment[][], // Array of assignment/arrays corresponding to styles
    operators: Operator[],
    machineCounts: Record<string, number>,
    availableMinutes: number,
    switchDelay: number = 5,
    operatorAttendance: Record<string, { startDelay: number; shiftExtension: number }> = {}
) => {
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

        // 2. Initialize State
        const inventory = new Map<string, number>();
        const remainingTargets = new Map<string, number>();
        const totalOrderQty = style.quantity || 10000;

        style.operations.forEach(op => {
            const done = op.completedQuantity || 0;
            const left = Math.max(0, totalOrderQty - done);
            remainingTargets.set(op.id, left);
        });

        // Initial Inventory
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

        const userProcessedCounts = new Map<string, Map<string, number>>();
        operators.forEach(u => userProcessedCounts.set(u.id, new Map()));

        return {
            effectiveDependencies,
            targetRatios,
            successors,
            inventory,
            remainingTargets,
            userProcessedCounts,
            assignments
        };
    });

    const machineUsage = new Map<string, number>();
    const opState = new Map<string, { busyUntil: number, opId: string, startTick: number, count: number, styleIndex: number, colorVariant?: string }>();

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

                const currentInv = meta.inventory.get(op.id) || 0;
                meta.inventory.set(op.id, currentInv + state.count);

                const uMap = meta.userProcessedCounts.get(uid);
                if (uMap) uMap.set(op.id, (uMap.get(op.id) || 0) + state.count);

                const left = meta.remainingTargets.get(op.id) || 0;
                meta.remainingTargets.set(op.id, Math.max(0, left - state.count));

                log(`T=${t.toFixed(0)} RELEASE ${uid} ${mType}. Output ${op.name} (S${state.styleIndex}): +${state.count}`);
            }
            opState.delete(uid);
        });

        // B. Assign Idle Operators
        operators.forEach(user => {
            if (opState.has(user.id)) return;

            const att = operatorAttendance[user.id] || { startDelay: 0, shiftExtension: 0 };
            const startCheck = att.startDelay || 0;
            const endCheck = availableMinutes + (att.shiftExtension || 0);

            if (t < startCheck || t >= endCheck) return;

            // Try assigning tasks in style order (0 -> 1 -> N)
            for (let sIdx = 0; sIdx < styles.length; sIdx++) {
                const style = styles[sIdx];
                const meta = styleMeta[sIdx];

                // --- ASSIGNMENT LOGIC (Inlined for scope access) ---
                const myAssignments = meta.assignments.filter(a => a.operatorIds.includes(user.id));
                if (myAssignments.length === 0) continue; // Try next style

                let candidates = myAssignments
                    .map(a => style.operations.find(o => o.id === a.operationId))
                    .filter(Boolean) as typeof style.operations;

                candidates.sort((a, b) => {
                    const getInventoryScore = (op: typeof style.operations[0]) => {
                        const currentInv = meta.inventory.get(op.id) || 0;
                        const succs = meta.successors.get(op.id) || [];
                        const isFinal = !meta.successors.has(op.id) || meta.successors.get(op.id)!.length === 0;

                        const successorBlocked = succs.some(sId => (meta.inventory.get(sId) || 0) > 15);
                        if (successorBlocked) return 2;
                        if (!isFinal && currentInv < 15) return 0;
                        return 1;
                    };

                    const aInv = getInventoryScore(a);
                    const bInv = getInventoryScore(b);
                    if (aInv !== bInv) return aInv - bInv;

                    // Simple score
                    return style.operations.indexOf(a) - style.operations.indexOf(b);
                });

                let assigned = false;
                for (const op of candidates) {
                    const mType = op.machineType.trim();
                    const mUsed = machineUsage.get(mType) || 0;
                    const mTotal = machineCounts[mType] || 1;
                    if (mUsed >= mTotal) continue;

                    let maxInput = Infinity;
                    const deps = meta.effectiveDependencies.get(op.id) || [];
                    if (deps.length > 0) {
                        const inputs = deps.map(d => meta.inventory.get(d) || 0);
                        maxInput = Math.min(...inputs);
                    }
                    const leftToMake = meta.remainingTargets.get(op.id) || 0;
                    if (leftToMake <= 0) continue;
                    if (maxInput > leftToMake) maxInput = leftToMake;
                    if (maxInput <= 0 && deps.length > 0) continue;

                    const MIN_BATCH = 5;
                    const isEndOfShift = (endCheck - t) < 60;

                    // Check if upstream operations are finished producing
                    const upstreamFinished = deps.every(dId => (meta.remainingTargets.get(dId) || 0) <= 0);

                    if (maxInput < MIN_BATCH && !isEndOfShift && !upstreamFinished && deps.length) continue;

                    const efficiency = (user.efficiencyRating || 100) / 100;
                    const smvMinutes = op.smv / 60; // Treated as minutes directly
                    const minutesPerPc = smvMinutes / efficiency;
                    const rawTarget = Math.floor(60 / minutesPerPc); // Target per Hour (was 20? 20 mins? No, usually hourly target)
                    // Wait, rawTarget logic was '20 / minutesPerPc'. 
                    // If 20 means "20 minutes batch", then okay.
                    // But standard is Minutes.
                    // Let's keep original logic for target, just fix SMV unit.
                    const rawTargetBatch = Math.floor(20 / minutesPerPc); // Batch for 20 mins?
                    const targetPcs = Math.max(10, Math.min(100, rawTargetBatch));
                    const actualPcs = Math.min(maxInput, targetPcs);

                    // Switch Delay
                    const lastType = operatorLastMachine.get(user.id);
                    const lastOpId = operatorLastOpId.get(user.id);
                    const lastColor = operatorLastColor.get(user.id);
                    let delay = 0;
                    const currentColor = style.colorVariant;

                    if (lastType && (lastType !== mType || (lastOpId && lastOpId !== op.id))) {
                        delay = switchDelay;
                    } else if (lastColor && currentColor && lastColor !== currentColor) {
                        delay = switchDelay;
                    }

                    const duration = (actualPcs * minutesPerPc) + delay;

                    opState.set(user.id, {
                        busyUntil: t + duration,
                        opId: op.id,
                        startTick: t + delay,
                        count: actualPcs,
                        styleIndex: sIdx,
                        colorVariant: currentColor
                    });

                    machineUsage.set(mType, mUsed + 1);
                    operatorLastMachine.set(user.id, mType);
                    operatorLastOpId.set(user.id, op.id);
                    // Note: Color is updated on release to handle delays correctly for next task? 
                    // No, update here too for immediate sequential checks if needed, but standard is on-assign or on-complete.
                    // Doing it on-assign is safer for "current state".
                    if (currentColor) operatorLastColor.set(user.id, currentColor);

                    if (deps.length > 0) {
                        deps.forEach(d => {
                            const cur = meta.inventory.get(d) || 0;
                            meta.inventory.set(d, cur - actualPcs);
                        });
                    }

                    assigned = true;
                    log(`T=${t.toFixed(0)} CLAIM ${user.name} ${mType}. Task: ${op.name} (S${sIdx}). Batch: ${actualPcs}.`);
                    break;
                }
                if (assigned) break; // Move to next operator
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
            console.log(`DEBUG: SIM FINISHED EARLY at T=${t}. Targets met.`);
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
    operatorAttendance: Record<string, { startDelay: number; shiftExtension: number }> = {}
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

    // For shared operations, adjust weights based on available capacity
    const opCapacity = new Map<string, number>();
    operators.forEach(o => {
        const att = operatorAttendance[o.id] || { startDelay: 0, shiftExtension: 0 };
        opCapacity.set(o.id, Math.max(0, availableMinutes + (att.shiftExtension || 0) - (att.startDelay || 0)));
    });

    // Re-distribute shared weights
    assignments.forEach(a => {
        if (a.operatorIds.length > 1) {
            const totalCap = a.operatorIds.reduce((sum, uid) => sum + (opCapacity.get(uid) || 0), 0);
            if (totalCap > 0) {
                a.operatorIds.forEach(uid => {
                    const share = (opCapacity.get(uid) || 0) / totalCap;
                    // This is a simplification. Real balancing happens in loop. 
                    // But initial weights should reflect capacity.
                    // opWeights.get(uid)?.set(a.operationId, ...);
                });
            }
        }
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

                // Calculate effective available minutes for this user
                const att = operatorAttendance[user?.id || ""] || { startDelay: 0, shiftExtension: 0 };
                const userMinutes = Math.max(0, availableMinutes + (att.shiftExtension || 0) - (att.startDelay || 0));

                if (user && weight > 0) {
                    // Mins contributed = Avail * Weight
                    // Pcs = Mins / (OpSMV / 60)
                    // console.log(`User ${user.name} Minutes: ${userMinutes}. Weight: ${weight}`);
                    hCap += ((user.efficiencyRating || 100) / 100 * userMinutes * weight) / (op.smv / 60);
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

                const att = operatorAttendance[user.id] || { startDelay: 0, shiftExtension: 0 };
                const userMinutes = Math.max(0, availableMinutes + (att.shiftExtension || 0) - (att.startDelay || 0));

                hCap += ((user.efficiencyRating || 100) / 100 * userMinutes * weight) / (op.smv / 60);
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
