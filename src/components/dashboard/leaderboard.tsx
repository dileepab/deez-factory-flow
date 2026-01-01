'use client';

import { useMemo, useState } from 'react';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { firestore } from '@/firebase/client';
import { collection, query, where } from 'firebase/firestore';
import type { Operator, OperatorWithEfficiency } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { cn } from '@/lib/utils';

interface OperatorLeaderboardProps {
  limit?: number;
  minimal?: boolean;
  className?: string;
}

export function OperatorLeaderboard({ limit, minimal, className }: OperatorLeaderboardProps) {
  const [view, setView] = useState<'today' | 'monthly'>('today');

  // 1. Fetch all operators
  const operatorsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'users'), where('role', '==', 'operator'));
  }, [firestore]);

  const { data: operators, isLoading: operatorsLoading } = useCollection<Operator>(operatorsQuery);

  const leaderboardData = useMemo(() => {
    if (!operators) {
      return [];
    }

    const leaderboard: OperatorWithEfficiency[] = operators
      .map(op => {
        let efficiency = 0;
        if (view === 'today') {
          const dailyEfficiency = op.efficiency;
          efficiency = typeof dailyEfficiency === 'number' && isFinite(dailyEfficiency) ? dailyEfficiency : 0;
        } else { // monthly
          const now = new Date();
          const year = now.getFullYear();
          const month = (now.getMonth() + 1).toString().padStart(2, '0');
          const monthKey = `${year}-${month}`;
          const monthlyEfficiency = op.monthlyStats?.[monthKey]?.monthlyEfficiency;
          efficiency = typeof monthlyEfficiency === 'number' && isFinite(monthlyEfficiency) ? monthlyEfficiency : 0;
        }

        return {
          ...op,
          efficiency,
        };
      })
      .sort((a, b) => b.efficiency - a.efficiency)
      .slice(0, limit || 5);

    return leaderboard;
  }, [operators, view, limit]);

  const isLoading = operatorsLoading;

  if (minimal) {
    return (
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center items-center h-20">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        ) : leaderboardData.length === 0 ? (
          <div className="text-sm text-muted-foreground">No data available.</div>
        ) : (
          leaderboardData.map((op, index) => (
            <div key={op.id} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted-foreground w-4">{index + 1}.</span>
                <Avatar className="h-8 w-8">
                  {op.photoURL && <AvatarImage src={op.photoURL} alt={op.name ?? 'Operator'} />}
                  <AvatarFallback className="text-xs">{op.name?.substring(0, 2).toUpperCase() ?? '??'}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium truncate max-w-[120px]">{op.name ?? 'Unnamed'}</span>
              </div>
              <span className="font-bold text-sm">{op.efficiency.toFixed(0)}%</span>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <Card className={cn(className)}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Operator Leaderboard</CardTitle>
          <CardDescription>
            {view === 'today'
              ? "Top 5 operators by today's average efficiency."
              : "Top 5 operators by this month's average efficiency."
            }
          </CardDescription>
        </div>
        <Tabs value={view} onValueChange={(value) => setView(value as 'today' | 'monthly')} >
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="monthly">This Month</TabsTrigger>
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
