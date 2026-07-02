import type {
  LineBalancerInput,
  LineBalancerOutput,
} from './line-balancer-schemas';

type Operation = LineBalancerInput['style']['operations'][number];
type Operator = LineBalancerInput['operators'][number];

const getOperatorEffectiveness = (operator: Operator) => {
  const efficiency = Number.isFinite(operator.efficiency) && operator.efficiency! > 0
    ? operator.efficiency!
    : 100;
  const reworkRate = Number.isFinite(operator.reworkRate) && operator.reworkRate! > 0
    ? operator.reworkRate!
    : 0;

  return Math.max(0.01, efficiency / 100) * Math.max(0.01, 1 - (reworkRate / 100));
};

const getAdjustedSmv = (operation: Operation, operator: Operator) =>
  operation.smv / getOperatorEffectiveness(operator);

const compareOperators = (left: Operator, right: Operator) => {
  const scoreDelta = getOperatorEffectiveness(right) - getOperatorEffectiveness(left);
  if (Math.abs(scoreDelta) > 0.0001) return scoreDelta;
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
};

const getOperationIndexMap = (operations: Operation[]) =>
  new Map(operations.map((operation, index) => [operation.id, index]));

const getOperationDepth = (
  operation: Operation,
  operationsById: Map<string, Operation>,
  cache: Map<string, number>,
  visiting = new Set<string>()
): number => {
  const cached = cache.get(operation.id);
  if (cached !== undefined) return cached;
  if (visiting.has(operation.id)) return 0;

  visiting.add(operation.id);
  const depth = Math.max(
    0,
    ...(operation.dependencies || [])
      .map(dependencyId => operationsById.get(dependencyId))
      .filter((dependency): dependency is Operation => Boolean(dependency))
      .map(dependency => getOperationDepth(dependency, operationsById, cache, visiting) + 1)
  );
  visiting.delete(operation.id);
  cache.set(operation.id, depth);
  return depth;
};

const getCauseSummary = (cause?: string) => {
  const text = cause || 'Gemini capacity or quota was unavailable';
  if (/quota|rate limit|too many requests|free_tier/i.test(text)) {
    return 'Gemini quota or rate limit was reached';
  }
  if (/503|service unavailable|high demand|overloaded|unavailable/i.test(text)) {
    return 'Gemini capacity was temporarily unavailable';
  }
  return text;
};

export function buildFallbackLineBalance(
  input: LineBalancerInput,
  cause?: string
): LineBalancerOutput {
  const operations = input.style.operations;
  const operationIndex = getOperationIndexMap(operations);
  const operationsById = new Map(operations.map(operation => [operation.id, operation]));
  const operatorById = new Map(input.operators.map(operator => [operator.id, operator]));
  const depthCache = new Map<string, number>();
  const machinePools = new Map<string, Operator[]>();
  const assignmentsByOperation = new Map<string, string[]>();
  const operatorLoad = new Map<string, number>();
  const operatorMachineTypes = new Map<string, Set<string>>();
  const unavoidableSerializations: string[] = [];

  const getMachinePool = (machineType: string) => {
    const cachedPool = machinePools.get(machineType);
    if (cachedPool) return cachedPool;

    const machineCount = input.machineCounts[machineType];
    if (!Number.isFinite(machineCount) || machineCount < 1) {
      throw new Error(`Local fallback cannot balance ${machineType}: machine count is not configured.`);
    }

    const skilledOperators = input.operators
      .filter(operator => operator.skills.includes(machineType))
      .sort(compareOperators);

    if (skilledOperators.length === 0) {
      throw new Error(`Local fallback cannot balance ${machineType}: no available operator has this skill.`);
    }

    const pool = skilledOperators.slice(0, Math.min(Math.floor(machineCount), skilledOperators.length));
    machinePools.set(machineType, pool);
    return pool;
  };

  const orderedOperations = [...operations].sort((left, right) => {
    const depthDelta = getOperationDepth(left, operationsById, depthCache) - getOperationDepth(right, operationsById, depthCache);
    if (depthDelta !== 0) return depthDelta;
    const smvDelta = right.smv - left.smv;
    if (smvDelta !== 0) return smvDelta;
    return (operationIndex.get(left.id) || 0) - (operationIndex.get(right.id) || 0);
  });

  orderedOperations.forEach(operation => {
    const pool = getMachinePool(operation.machineType);
    const directDependencyOperatorIds = new Set(
      (operation.dependencies || [])
        .flatMap(dependencyId => assignmentsByOperation.get(dependencyId) || [])
    );
    const nonSerialCandidates = pool.filter(operator => !directDependencyOperatorIds.has(operator.id));
    const candidates = nonSerialCandidates.length > 0 ? nonSerialCandidates : pool;

    const selected = [...candidates].sort((left, right) => {
      const leftMachineTypes = operatorMachineTypes.get(left.id) || new Set<string>();
      const rightMachineTypes = operatorMachineTypes.get(right.id) || new Set<string>();
      const leftSwitchPenalty = leftMachineTypes.size > 0 && !leftMachineTypes.has(operation.machineType)
        ? getAdjustedSmv(operation, left) * 0.25
        : 0;
      const rightSwitchPenalty = rightMachineTypes.size > 0 && !rightMachineTypes.has(operation.machineType)
        ? getAdjustedSmv(operation, right) * 0.25
        : 0;
      const leftProjectedLoad = (operatorLoad.get(left.id) || 0) + getAdjustedSmv(operation, left) + leftSwitchPenalty;
      const rightProjectedLoad = (operatorLoad.get(right.id) || 0) + getAdjustedSmv(operation, right) + rightSwitchPenalty;
      if (Math.abs(leftProjectedLoad - rightProjectedLoad) > 0.0001) {
        return leftProjectedLoad - rightProjectedLoad;
      }
      return compareOperators(left, right);
    })[0];

    if (directDependencyOperatorIds.has(selected.id) && nonSerialCandidates.length === 0) {
      unavoidableSerializations.push(operation.name);
    }

    assignmentsByOperation.set(operation.id, [selected.id]);
    operatorLoad.set(selected.id, (operatorLoad.get(selected.id) || 0) + getAdjustedSmv(operation, selected));
    const machineTypes = operatorMachineTypes.get(selected.id) || new Set<string>();
    machineTypes.add(operation.machineType);
    operatorMachineTypes.set(selected.id, machineTypes);
  });

  const sharedRelief: string[] = [];
  const machineTypes = Array.from(new Set(operations.map(operation => operation.machineType)));
  machineTypes.forEach(machineType => {
    const machineCount = Math.floor(input.machineCounts[machineType] || 0);
    const pool = getMachinePool(machineType);
    const machineOperations = operations.filter(operation => operation.machineType === machineType);
    const usedOperatorIds = new Set(
      machineOperations.flatMap(operation => assignmentsByOperation.get(operation.id) || [])
    );

    if (usedOperatorIds.size >= machineCount) return;

    const heaviestOperation = [...machineOperations].sort((left, right) => right.smv - left.smv)[0];
    const currentAssignment = assignmentsByOperation.get(heaviestOperation.id);
    if (!currentAssignment) return;

    const reliefOperator = pool
      .filter(operator => !currentAssignment.includes(operator.id) && !usedOperatorIds.has(operator.id))
      .sort((left, right) => (operatorLoad.get(left.id) || 0) - (operatorLoad.get(right.id) || 0) || compareOperators(left, right))[0];

    if (!reliefOperator) return;

    currentAssignment.push(reliefOperator.id);
    operatorLoad.set(
      reliefOperator.id,
      (operatorLoad.get(reliefOperator.id) || 0) + getAdjustedSmv(heaviestOperation, reliefOperator) / 2
    );
    sharedRelief.push(`${reliefOperator.name} supports ${heaviestOperation.name}`);
  });

  const assignments = operations.map(operation => ({
    operationId: operation.id,
    operatorIds: assignmentsByOperation.get(operation.id) || [],
  }));

  const machineSummary = Array.from(machinePools.entries())
    .map(([machineType, pool]) => {
      const configuredCount = input.machineCounts[machineType];
      return `${machineType}: ${pool.length}/${configuredCount} machine slots`;
    })
    .join('; ');
  const fallbackNotes = [
    `Local fallback balance used because ${getCauseSummary(cause)}.`,
    'This is a deterministic constraint-safe balance, not a full Gemini optimization.',
    'Every operation is assigned to skilled operators, machine use is capped to configured inventory, and direct dependency pairs are split across different operators when another skilled operator is available.',
    machineSummary ? `Machine pools used: ${machineSummary}.` : '',
    sharedRelief.length > 0 ? `Shared relief: ${sharedRelief.join('; ')}.` : '',
    unavoidableSerializations.length > 0
      ? `Unavoidable serial dependency assignments remained on: ${unavoidableSerializations.join(', ')} because no alternate skilled operator was available inside the machine limit.`
      : '',
    'Review this fallback before saving if Gemini capacity is still limited.',
  ].filter(Boolean);

  assignments.forEach(assignment => {
    const operation = operationsById.get(assignment.operationId);
    if (!operation || assignment.operatorIds.length === 0) return;
    assignment.operatorIds.forEach(operatorId => {
      const operator = operatorById.get(operatorId);
      if (!operator?.skills.includes(operation.machineType)) {
        throw new Error(`Local fallback produced an invalid assignment for ${operation.name}.`);
      }
    });
  });

  return {
    assignments,
    reasoning: fallbackNotes.join(' '),
  };
}
