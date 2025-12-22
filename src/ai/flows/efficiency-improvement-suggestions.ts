'use server';

/**
 * @fileOverview AI-powered suggestions for improving operator efficiency and production flow.
 *
 * - getEfficiencyImprovementSuggestions - A function that returns AI-driven suggestions based on real-time data analysis.
 * - EfficiencyImprovementSuggestionsInput - The input type for the getEfficiencyImprovementSuggestions function.
 * - EfficiencyImprovementSuggestionsOutput - The return type for the getEfficiencyImprovementSuggestions function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const EfficiencyImprovementSuggestionsInputSchema = z.object({
  realTimeData: z.string().describe('Real-time production data including operator efficiency, rework quantities, and production quantities.'),
  historicalData: z.string().optional().describe('Historical production data for comparison.'),
});
export type EfficiencyImprovementSuggestionsInput = z.infer<typeof EfficiencyImprovementSuggestionsInputSchema>;

const EfficiencyImprovementSuggestionsOutputSchema = z.object({
  suggestions: z.array(z.string()).describe('A list of AI-powered suggestions for improving efficiency and production flow.'),
  reasoning: z.string().describe('The AI’s reasoning behind the suggestions, based on the provided data.'),
});
export type EfficiencyImprovementSuggestionsOutput = z.infer<typeof EfficiencyImprovementSuggestionsOutputSchema>;

export async function getEfficiencyImprovementSuggestions(
  input: EfficiencyImprovementSuggestionsInput
): Promise<EfficiencyImprovementSuggestionsOutput> {
  return efficiencyImprovementSuggestionsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'efficiencyImprovementSuggestionsPrompt',
  input: {schema: EfficiencyImprovementSuggestionsInputSchema},
  output: {schema: EfficiencyImprovementSuggestionsOutputSchema},
  prompt: `You are an AI assistant providing expert advice to factory supervisors on improving operator efficiency and optimizing production flow.

  Analyze the following real-time production data and provide actionable suggestions to the supervisor.

  Real-time Data: {{{realTimeData}}}

  Historical Data (if available): {{#if historicalData}}{{{historicalData}}}{{else}}Not available{{/if}}

  Based on this data, provide a list of suggestions for the supervisor, and explain your reasoning.
  Format the suggestions as a numbered list.
  The suggestions should be specific, measurable, achievable, relevant, and time-bound (SMART).
  Return the suggestions in the "suggestions" field and the reasoning in the "reasoning" field.
  Do not make assumptions about the data that are not explicitly provided.
  If there is no historical data, focus on the real-time data provided.
`,
});

const efficiencyImprovementSuggestionsFlow = ai.defineFlow(
  {
    name: 'efficiencyImprovementSuggestionsFlow',
    inputSchema: EfficiencyImprovementSuggestionsInputSchema,
    outputSchema: EfficiencyImprovementSuggestionsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
