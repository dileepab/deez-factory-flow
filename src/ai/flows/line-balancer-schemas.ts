import { z } from 'genkit';

export const LineBalancerInputSchema = z.object({
  style: z.object({
    id: z.string(),
    name: z.string(),
    quantity: z.number(),
    totalSmv: z.number(),
    operations: z.array(z.object({
      id: z.string(),
      name: z.string(),
      smv: z.number(),
      machineType: z.string(),
      dependencies: z.array(z.string()).optional(),
    })),
  }).describe('GarmentStyle object including operations, SMVs, and machine types'),
  operators: z.array(z.object({
    id: z.string(),
    name: z.string(),
    skills: z.array(z.string()),
    efficiency: z.number().optional(),
    reworkRate: z.number().optional(),
  })).describe('List of available operators, their machine skills, and efficiency ratings'),
  machineCounts: z.record(z.number()).describe('Inventory of available machines by type'),
  historicalPerformance: z.record(z.record(z.number())).optional().describe('Historical operator efficiency per operation'),
  currentAssignments: z.array(z.object({
    operationId: z.string(),
    operatorIds: z.array(z.string()),
    variantId: z.string().optional(),
    variantColor: z.string().optional(),
  })).optional().describe('Existing manual or AI assignments to improve. Variant fields are context only.'),
  currentPlanSummary: z.object({
    currentStyleOutput: z.number(),
    nextStyleOutput: z.number().optional(),
    totalOutput: z.number(),
    estimatedWip: z.number(),
    primaryWip: z.number().optional(),
    nextWip: z.number().optional(),
    capacityTarget: z.number().optional(),
    salaryTarget: z.number().optional(),
  }).optional().describe('Current simulated plan quality metrics used as the baseline for improvement.'),
  improvementGoal: z.string().optional().describe('Optional instruction for improving an existing plan rather than starting from scratch.'),
});

export type LineBalancerInput = z.infer<typeof LineBalancerInputSchema>;

export const LineBalancerOutputSchema = z.object({
  assignments: z.array(z.object({
    operationId: z.string(),
    operatorIds: z.array(z.string()),
  })).describe('Optimized operator assignments for each operation'),
  reasoning: z.string().describe('Detailed explanation of the optimization logic and balancing decisions'),
});

export type LineBalancerOutput = z.infer<typeof LineBalancerOutputSchema>;
