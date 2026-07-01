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
