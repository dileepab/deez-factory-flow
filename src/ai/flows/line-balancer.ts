'use server';

import { ai } from '@/ai/genkit';
import {
  LineBalancerInputSchema,
  LineBalancerOutputSchema,
  type LineBalancerInput,
  type LineBalancerOutput,
} from './line-balancer-schemas';
import { getAiErrorText, isGeminiQuotaExceededError, isRetryableGeminiError, runWithGeminiRetry } from './gemini-retry';
import { buildFallbackLineBalance } from './line-balancer-fallback';
import { getLineBalancerModelChain } from './line-balancer-models';

export async function getLineBalancerSuggestions(
  input: LineBalancerInput
): Promise<LineBalancerOutput> {
  return lineBalancerFlow(input);
}

const prompt = ai.definePrompt({
  name: 'lineBalancerPrompt',
  input: { schema: LineBalancerInputSchema },
  output: { schema: LineBalancerOutputSchema },
  prompt: `You are an expert Industrial Engineer and Lean Manufacturing Specialist specializing in apparel assembly line balancing.

Your objective is to allocate available operators to operations for a garment style to maximize line efficiency and daily production output, while strictly satisfying all manufacturing constraints.

Garment Style:
- Name: {{style.name}}
- Quantity: {{style.quantity}}
- Total SMV (Standard Minute Value): {{style.totalSmv}}
- Operations:
{{#each style.operations}}
  * ID: {{this.id}} | Name: {{this.name}} | SMV: {{this.smv}}s | Machine: {{this.machineType}} | Dependencies: {{#if this.dependencies}}{{this.dependencies}}{{else}}None{{/if}}
{{/each}}

Available Operators (Skills & Efficiency):
{{#each operators}}
  * ID: {{this.id}} | Name: {{this.name}} | Skills (Machine Types they can operate): {{this.skills}} | Efficiency: {{#if this.efficiency}}{{this.efficiency}}%{{else}}100%{{/if}} | Rework Rate: {{#if this.reworkRate}}{{this.reworkRate}}%{{else}}0%{{/if}}
{{/each}}

Available Machine Inventory Constraints (Max operators on a machine type):
{{#each machineCounts}}
  * {{this}}
{{/each}}

{{#if currentAssignments}}
Current Plan Baseline To Improve:
{{#each currentAssignments}}
  * Operation ID: {{this.operationId}} | Operators: {{this.operatorIds}}{{#if this.variantColor}} | Variant: {{this.variantColor}}{{/if}}
{{/each}}

Current Plan Metrics:
{{#if currentPlanSummary}}
- Current style finished output: {{currentPlanSummary.currentStyleOutput}} pcs/day
- Next style finished output: {{#if currentPlanSummary.nextStyleOutput}}{{currentPlanSummary.nextStyleOutput}}{{else}}0{{/if}} pcs/day
- Total finished output: {{currentPlanSummary.totalOutput}} pcs/day
- Estimated WIP: {{currentPlanSummary.estimatedWip}} pcs
- Primary WIP: {{#if currentPlanSummary.primaryWip}}{{currentPlanSummary.primaryWip}}{{else}}0{{/if}} pcs
- Next-style WIP: {{#if currentPlanSummary.nextWip}}{{currentPlanSummary.nextWip}}{{else}}0{{/if}} pcs
- Capacity target: {{#if currentPlanSummary.capacityTarget}}{{currentPlanSummary.capacityTarget}}{{else}}Not provided{{/if}} pcs/day
- Salary break-even target: {{#if currentPlanSummary.salaryTarget}}{{currentPlanSummary.salaryTarget}}{{else}}Not provided{{/if}} pcs/day
{{/if}}

You are doing a SECOND-PASS improvement of a human-adjusted plan, not a fresh plan from zero. Treat the current plan as the baseline. Preserve working manual choices unless a specific change improves the baseline. If no assignment change is likely to beat the baseline, return the same assignment map and explain why the current plan should be kept.
{{/if}}

{{#if improvementGoal}}
Optimization Strategy For This Run:
{{improvementGoal}}
{{/if}}

Rules to strictly follow:
1. Every single operation in the garment style MUST be assigned to at least one operator.
2. An operator CAN ONLY be assigned to an operation if they have the skill for it. An operator's skill list corresponds to the "machineType" of the operation. (e.g. if an operation requires "Single Needle Lockstitch", the assigned operator must have "Single Needle Lockstitch" in their skills array).
   - Use each operator's FULL skills array, not just one assumed "primary" skill. If an operator is skilled on several machine types, place them wherever they best balance the FLOW.
3. Operators can be assigned to multiple operations (multitasking) if necessary to balance the line or due to operator count limits, but try to minimize excessive multitasking (max 2-3 tasks per operator).
4. Respect Machine Constraints: The total number of unique operators assigned to any operation using a specific machineType MUST NOT exceed the available count for that machineType.
5. AVOID SERIAL BOTTLENECKS (this is critical and is the most common balancing mistake):
   - Do NOT put two operations that are in a direct dependency chain (one is a predecessor of the other) on the SAME single operator when another skilled operator is available. One person doing both a step AND its successor serializes the flow through one pair of hands and becomes the line bottleneck — even when their per-operator SMV load looks perfectly balanced.
   - When several operations share the same machineType, and you have more than one operator skilled on it AND more than one machine of that type, SPREAD those operations across different operators so the machines run in parallel. Never concentrate an entire machine pool onto one operator while identical machines of that type sit idle.
   - (Exception: see Rule 7 — an operator MAY share a stage with its direct successor when that upstream stage is ALSO covered by another operator, in order to relieve a bottleneck. The scheduler time-phases such shared coverage automatically.)
6. Maximize Output (optimize FLOW, not just static SMV balance):
   - Real output is limited by the slowest STAGE in the dependency flow plus changeover losses — NOT by the average SMV per operator. Two operators each loaded to 180s can still yield a terrible line if the flow is serialized onto one of them.
   - Identify critical bottleneck operations (high SMV, or any sequential dependency chain concentrated on a single operator or a single machine) and break them up with parallel capacity.
   - Place your most efficient operators (high efficiency, low rework rate) on the true bottleneck stage.
   - Minimize changeovers: prefer keeping each operator on a single machine type for the shift; switching machine types mid-shift costs setup time and lowers output.
7. USE TRULY-SPARE OPERATORS AS SHARED RELIEF ON THE BOTTLENECK — but NEVER load the bottleneck itself:
   - First, identify the CONSTRAINT: the resource that caps total output. This is usually the heaviest operation and/or the sole operator of a scarce machine type (e.g. the only Flatlock operator on the slowest finishing operation). Protect this operator's time.
   - THE GOLDEN RULE OF BOTTLENECKS: you OFFLOAD the constraint — you NEVER add non-constraint work to it. So the constraint operator (and any operator who is the SOLE holder of a scarce skill) must stay DEDICATED to their constraint operation. Do NOT give them a second operation. Adding upstream work to the bottleneck operator steals time from the very operation that limits output and makes things worse, not better.
   - Shared relief is for a DIFFERENT operator: one who is genuinely under-utilised, is NOT the constraint, and HAS the skill for the bottleneck stage. Assign that spare operator as an ADDITIONAL, shared operator on the stage that feeds the constraint, listing BOTH operators in that operation's operatorIds (keep the original operator on it too).
   - The ONLY case where an operator may hold an operation AND its direct successor (the Rule 5 exception) is when (a) that operator is genuinely spare, AND (b) the upstream operation is also covered by another operator. The scheduler then time-phases it: the spare operator helps the upstream stage early, then shifts downstream as WIP builds.
   - If the ONLY under-utilised operators lack the skill for the bottleneck stage (or the only candidate IS the constraint operator), DO NOT force a share. Leave the assignment simple and clean, keep the constraint operator dedicated, and state in your reasoning that the line is limited by a scarce skill and would benefit from CROSS-TRAINING a second operator on that machine type.
   - Never swap ownership (don't pull the original operator off a stage to hand it entirely to someone else — that just relocates the bottleneck). Always respect Rule 4 (operators concurrently on a machineType ≤ its machine count).

Analyze the bottleneck dependencies and constraints carefully. Explicitly check: (a) for every dependency chain, is a step and its successor stuck on the same SINGLE operator? (b) for every busy machine type, are you using all the skilled operators and machines available? (c) is the constraint operator (sole scarce-skill holder of the heaviest op) kept DEDICATED, with relief coming only from genuinely-spare operators who are not themselves the constraint? Determine the optimal assignment map, and write a clear industrial engineering explanation of your choices (including the identified constraint, how you protected it, how you used genuinely-spare operators as shared relief, where cross-training is needed, and why certain operators were placed on critical steps).

Return the assignments in the "assignments" field and the explanation in the "reasoning" field.
`,
});

const lineBalancerFlow = ai.defineFlow(
  {
    name: 'lineBalancerFlow',
    inputSchema: LineBalancerInputSchema,
    outputSchema: LineBalancerOutputSchema,
  },
  async input => {
    let lastModelError: unknown;

    for (const model of getLineBalancerModelChain()) {
      try {
        const { output } = await runWithGeminiRetry(
          () => prompt(input, { model }),
          {
            shouldRetry: error => isGeminiQuotaExceededError(error) ? false : isRetryableGeminiError(error),
            onRetry: ({ nextAttempt, maxAttempts, delayMs, error }) => {
              console.warn(
                `AI line balancer retry ${nextAttempt}/${maxAttempts} on ${model} in ${delayMs}ms: ${getAiErrorText(error)}`
              );
            },
          }
        );
        return output!;
      } catch (error) {
        if (!isRetryableGeminiError(error) && !isGeminiQuotaExceededError(error)) {
          throw error;
        }

        lastModelError = error;
        console.warn(`AI line balancer model ${model} failed; trying fallback if available:`, getAiErrorText(error));
      }
    }

    try {
      console.warn('AI line balancer using local fallback after Gemini model chain failed:', getAiErrorText(lastModelError));
      return buildFallbackLineBalance(input, getAiErrorText(lastModelError));
    } catch (fallbackError) {
      console.warn('AI line balancer local fallback failed:', fallbackError);
      throw lastModelError;
    }
  }
);
