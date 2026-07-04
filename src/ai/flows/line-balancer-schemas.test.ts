import { describe, expect, it } from 'vitest';

import { LineBalancerInputSchema } from './line-balancer-schemas';

describe('LineBalancerInputSchema', () => {
  it('accepts current-plan context for an AI improvement pass', () => {
    const parsed = LineBalancerInputSchema.safeParse({
      style: {
        id: 'polo',
        name: 'Premium Polo',
        quantity: 400,
        totalSmv: 17,
        operations: [
          {
            id: 'placket',
            name: 'Placket Attach',
            smv: 216,
            machineType: 'Single Needle Lockstitch',
            dependencies: [],
          },
        ],
      },
      operators: [
        {
          id: 'pushpa',
          name: 'Pushpa OP',
          skills: ['Single Needle Lockstitch'],
          efficiency: 100,
          reworkRate: 0,
        },
      ],
      machineCounts: {
        'Single Needle Lockstitch': 3,
      },
      currentAssignments: [
        {
          operationId: 'placket',
          operatorIds: ['pushpa'],
          variantId: 'navy',
          variantColor: 'Solid Navy',
        },
      ],
      currentPlanSummary: {
        currentStyleOutput: 52,
        nextStyleOutput: 0,
        totalOutput: 52,
        estimatedWip: 104,
        primaryWip: 104,
        nextWip: 0,
        capacityTarget: 95,
        salaryTarget: 46,
      },
      improvementGoal: 'Improve this baseline without reducing finished output.',
    });

    expect(parsed.success).toBe(true);
  });
});
