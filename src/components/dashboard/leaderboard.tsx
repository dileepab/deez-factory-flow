'use client';

import { useMemo, useState } from 'react';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { firestore } from '@/firebase/client';
import { collection, query, where, Timestamp } from 'firebase/firestore';
import type { Operator, ProductionEntry, OperatorWithEfficiency } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Helper to calculate aggregate efficiency from a list of production entries
const calculateAggregateEfficiency = (productions: ProductionEntry[]): number => {
  if (productions.length === 0) {
    return 0;
  }

  const totalEarnedMinutes = productions.reduce((acc, p) => acc + p.earnedMinutes, 0);
  const totalWorkedMinutes = productions.reduce((acc, p) => acc + p.workedMinutes, 0);

  if (totalWorkedMinutes === 0) {
    return 0;
  }

  return (totalEarnedMinutes / totalWorkedMinutes) * 100;
};

export function OperatorLeaderboard() {
  const [view, setView] = useState<'today' | 'monthly'>('today');

  // 1. Fetch all operators
  const operatorsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'users'), where('role', '==', 'operator'));
  }, [firestore]);

  const { data: operators, isLoading: operatorsLoading } = useCollection<Operator>(operatorsQuery);

  // 2. Fetch all production data from the last 30 days
  const productionsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return query(
      collection(firestore, 'production'),
      where('timestamp', '>=', Timestamp.fromDate(thirtyDaysAgo))
    );
  }, [firestore]);

  const { data: productions, isLoading: productionsLoading } = useCollection<ProductionEntry>(productionsQuery);

  const leaderboardData = useMemo(() => {
    if (!operators || !productions) {
      return [];
    }

    // Determine the date range based on the current view
    const now = new Date();
    const startOfPeriod = new Date();
    if (view === 'today') {
      startOfPeriod.setHours(0, 0, 0, 0);
    } else { // monthly
      startOfPeriod.setDate(now.getDate() - 30);
    }

    const endOfPeriod = now;

    // Filter productions for the selected period
    const relevantProductions = productions.filter(p => {
      const pDate = p.timestamp.toDate();
      return pDate >= startOfPeriod && pDate <= endOfPeriod;
    });

    // 3. Calculate efficiency for each operator for the selected period
    const leaderboard: OperatorWithEfficiency[] = operators
      .map(op => {
        const operatorProductions = relevantProductions.filter(p => p.operatorId === op.id);
        const efficiency = calculateAggregateEfficiency(operatorProductions);
        
        return {
          ...op,
          efficiency,
        };
      })
      .sort((a, b) => b.efficiency - a.efficiency)
      .slice(0, 5);

    return leaderboard;
  }, [operators, productions, view]);

  const isLoading = operatorsLoading || productionsLoading;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Operator Leaderboard</CardTitle>
          <CardDescription>
            {view === 'today' 
              ? "Top 5 operators by today's average efficiency."
              : "Top 5 operators by 30-day average efficiency."
            }
          </CardDescription>
        </div>
        <Tabs value={view} onValueChange={(value) => setView(value as 'today' | 'monthly')} >
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : leaderboardData.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">No operator data available for this period.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operator</TableHead>
                <TableHead className="text-right">Efficiency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboardData.map((op) => (
                <TableRow key={op.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        {op.photoURL && <AvatarImage src={op.photoURL} alt={op.name ?? 'Operator'} />}
                        <AvatarFallback>{op.name?.substring(0, 2).toUpperCase() ?? '??'}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{op.name ?? 'Unnamed Operator'}</p>
                        <p className="text-sm text-muted-foreground">{op.email ?? 'No email provided'}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-lg">{op.efficiency.toFixed(2)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}