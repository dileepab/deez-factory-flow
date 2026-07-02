import { describe, expect, it } from 'vitest';
import { buildFallbackLineBalance } from './line-balancer-fallback';
import type { LineBalancerInput } from './line-balancer-schemas';

const baseInput: LineBalancerInput = {
  style: {
    id: 'style-1',
    name: 'Polo Tee',
    quantity: 250,
    totalSmv: 120,
    operations: [
      {
        id: 'front',
        name: 'Join Front',
        smv: 40,
        machineType: 'Single Needle',
      },
      {
        id: 'side',
        name: 'Close Side Seam',
        smv: 55,
        machineType: 'Single Needle',
        dependencies: ['front'],
      },
      {
        id: 'hem',
        name: 'Bottom Hem',
        smv: 25,
        machineType: 'Flatlock',
        dependencies: ['side'],
      },
    ],
  },
  operators: [
    { id: 'op-a', name: 'Asha', skills: ['Single Needle'], efficiency: 105 },
    { id: 'op-b', name: 'Bina', skills: ['Single Needle'], efficiency: 100 },
    { id: 'op-c', name: 'Chandra', skills: ['Flatlock'], efficiency: 95 },
  ],
  machineCounts: {
    'Single Needle': 2,
    Flatlock: 1,
  },
};

describe('line balancer fallback', () => {
  it('assigns every operation to skilled operators and avoids direct dependency serialization when possible', () => {
    const result = buildFallbackLineBalance(baseInput, 'quota exceeded');

    expect(result.assignments).toHaveLength(3);
    expect(result.reasoning).toContain('Local fallback balance');

    const front = result.assignments.find(assignment => assignment.operationId === 'front');
    const side = result.assignments.find(assignment => assignment.operationId === 'side');
    const hem = result.assignments.find(assignment => assignment.operationId === 'hem');

    expect(front?.operatorIds).toHaveLength(1);
    expect(side?.operatorIds).toHaveLength(1);
    expect(front?.operatorIds[0]).not.toBe(side?.operatorIds[0]);
    expect(hem?.operatorIds).toEqual(['op-c']);
  });

  it('does not use more unique operators than the configured machine count allows', () => {
    const result = buildFallbackLineBalance({
      ...baseInput,
      style: {
        ...baseInput.style,
        operations: [
          { id: 'op-1', name: 'Step 1', smv: 30, machineType: 'Single Needle' },
          { id: 'op-2', name: 'Step 2', smv: 30, machineType: 'Single Needle' },
          { id: 'op-3', name: 'Step 3', smv: 30, machineType: 'Single Needle' },
        ],
      },
      operators: [
        ...baseInput.operators,
        { id: 'op-d', name: 'Deepa', skills: ['Single Needle'], efficiency: 120 },
      ],
      machineCounts: {
        'Single Needle': 2,
      },
    }, 'high demand');

    const singleNeedleOperators = new Set(result.assignments.flatMap(assignment => assignment.operatorIds));
    expect(singleNeedleOperators.size).toBeLessThanOrEqual(2);
  });

  it('adds shared relief when an unused machine slot and skilled operator are available', () => {
    const result = buildFallbackLineBalance({
      ...baseInput,
      style: {
        ...baseInput.style,
        operations: [
          { id: 'heavy', name: 'Attach Collar', smv: 80, machineType: 'Single Needle' },
        ],
      },
      operators: baseInput.operators.slice(0, 2),
      machineCounts: {
        'Single Needle': 2,
      },
    }, 'service unavailable');

    expect(result.assignments).toEqual([
      { operationId: 'heavy', operatorIds: ['op-a', 'op-b'] },
    ]);
    expect(result.reasoning).toContain('Shared relief');
  });
});
