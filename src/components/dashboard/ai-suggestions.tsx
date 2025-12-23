'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lightbulb, Zap } from "lucide-react";

const suggestions = [
  {
    id: 1,
    text: "Operator #12, Jane Doe, is 15% below her average efficiency this week.",
    action: "Consider a check-in or additional training.",
  },
  {
    id: 2,
    text: "The Juki DDL-8700 machine has a 10% higher fault rate on Style B.",
    action: "Schedule a maintenance check for the machine.",
  },
  {
    id: 3,
    text: "Overall production is down 5% on Tuesdays compared to other weekdays.",
    action: "Investigate potential causes for the mid-week slump.",
  },
];

export function AiSuggestions() {
  return (
    <Card id="suggestions" className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center">
          <Lightbulb className="mr-2" />
          AI-Powered Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-4">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="flex items-start">
              <div className="flex-shrink-0">
                <Zap className="h-5 w-5 text-yellow-400" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {suggestion.text}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {suggestion.action}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
