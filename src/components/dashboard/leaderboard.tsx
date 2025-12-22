"use client";

import { OPERATORS } from "@/lib/data";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Crown, ArrowUp, ArrowDown } from "lucide-react";

export function Leaderboard() {
  const sortedOperators = [...OPERATORS].sort((a, b) => b.efficiency - a.efficiency);
  const topOperators = sortedOperators.slice(0, 5);

  const getTrophyColor = (index: number) => {
    if (index === 0) return "text-yellow-500";
    if (index === 1) return "text-gray-400";
    if (index === 2) return "text-yellow-700";
    return "text-muted-foreground";
  };

  return (
    <Card id="leaderboard">
      <CardHeader>
        <CardTitle>Top 5 Operators</CardTitle>
        <CardDescription>By current day efficiency</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-4">
          {topOperators.map((operator, index) => (
            <li key={operator.id} className="flex items-center gap-4">
              <div className="flex w-8 items-center justify-center">
                 <Crown className={`h-6 w-6 ${getTrophyColor(index)}`} />
              </div>
              <Avatar className="h-10 w-10">
                <AvatarImage src={operator.avatarUrl} alt={operator.name} data-ai-hint="person face" />
                <AvatarFallback>
                  {operator.name.split(" ").map((n) => n[0]).join("")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium">{operator.name}</p>
                <p className="text-sm text-muted-foreground">
                  Earned Minutes: {operator.earnedMinutes}
                </p>
              </div>
              <div className="flex items-center text-lg font-bold text-primary">
                 {operator.efficiency > 90 ? <ArrowUp className="h-5 w-5 text-green-500" /> : <ArrowDown className="h-5 w-5 text-red-500" />}
                <span>{operator.efficiency}%</span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
