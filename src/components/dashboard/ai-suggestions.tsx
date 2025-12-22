"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { BrainCircuit, Lightbulb, Loader2 } from "lucide-react";
import { getSuggestions } from "@/lib/actions";
import { OPERATORS } from "@/lib/data";
import type { EfficiencyImprovementSuggestionsOutput } from "@/ai/flows/efficiency-improvement-suggestions";

export function AiSuggestions() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EfficiencyImprovementSuggestionsOutput | null>(null);

  const handleGetSuggestions = async () => {
    setLoading(true);
    setResult(null);

    const productionData = `
      Today's operator performance snapshot:
      ${OPERATORS.map(op => `- ${op.name}: Efficiency ${op.efficiency}%, Production ${op.totalProduction} units, Rework ${op.rework} units.`).join("\n")}
      
      Focus on identifying patterns in low efficiency, high rework, or production bottlenecks.
    `;

    const suggestions = await getSuggestions(productionData);
    setResult(suggestions);
    setLoading(false);
  };

  return (
    <Card id="ai-suggestions">
      <CardHeader>
        <CardTitle>AI-Powered Suggestions</CardTitle>
        <CardDescription>
          Get actionable insights to improve factory floor efficiency based on today's data.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-[10rem] space-y-4">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-4 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p>Analyzing data and generating insights...</p>
          </div>
        )}
        {result && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2 flex items-center gap-2"><Lightbulb className="text-primary"/> Suggestions</h3>
              <ul className="list-disc space-y-2 pl-5 text-sm">
                {result.suggestions.map((suggestion, index) => (
                  <li key={index}>{suggestion}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Reasoning</h3>
              <p className="text-sm text-muted-foreground">{result.reasoning}</p>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button onClick={handleGetSuggestions} disabled={loading} className="w-full sm:w-auto">
          {loading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</>
          ) : (
            <><BrainCircuit className="mr-2 h-4 w-4" /> Get Suggestions</>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
