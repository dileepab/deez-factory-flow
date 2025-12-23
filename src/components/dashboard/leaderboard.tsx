'use client';

import { useMemo } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2 } from 'lucide-react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { collection, query, where, orderBy, limit } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import type { ProductionLog, User } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface OperatorWithEfficiency extends User {
  efficiency: number;
}

export function Leaderboard() {
  const operatorsQuery = useMemoFirebase(
    () => query(collection(firestore, 'users'), where('role', '==', 'operator')),
    []
  );
  const { data: operators, isLoading: operatorsLoading } =
    useCollection<User>(operatorsQuery);

  const productionLogsQuery = useMemoFirebase(
    () => query(collection(firestore, 'production'), orderBy('date', 'desc')),
    []
  );
  const { data: productionLogs, isLoading: logsLoading } =
    useCollection<ProductionLog>(productionLogsQuery);

  const operatorPerformance = useMemo(() => {
    if (!operators || !productionLogs) return [];

    const performanceMap = new Map<string, { totalOutput: number; totalHours: number }>();

    productionLogs.forEach(log => {
      if (!performanceMap.has(log.operatorId)) {
        performanceMap.set(log.operatorId, { totalOutput: 0, totalHours: 0 });
      }
      const current = performanceMap.get(log.operatorId)!;
      current.totalOutput += log.output;
      current.totalHours += log.hoursWorked;
    });

    const leaderboardData: OperatorWithEfficiency[] = operators
      .map(op => {
        const performance = performanceMap.get(op.id);
        const efficiency = performance
          ? (performance.totalOutput / (performance.totalHours * 60)) * 100 // Assuming SMV of 1 minute for simplicity
          : 0;
        return { ...op, efficiency };
      })
      .sort((a, b) => b.efficiency - a.efficiency)
      .slice(0, 5);

    return leaderboardData;
  }, [operators, productionLogs]);

  const isLoading = operatorsLoading || logsLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operator Leaderboard</CardTitle>
        <CardDescription>
          Top performing operators this week.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operator</TableHead>
              <TableHead className="text-right">Efficiency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={2} className="text-center">
                  <div className="flex justify-center items-center">
                    <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                    Loading leaderboard...
                  </div>
                </TableCell>
              </TableRow>
            )}
            {operatorPerformance.map(op => (
              <TableRow key={op.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="hidden h-9 w-9 sm:flex">
                      <AvatarImage src={`/avatars/${op.id}.png`} alt="Avatar" />
                      <AvatarFallback>{op.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="grid gap-1">
                      <p className="text-sm font-medium leading-none">{op.name}</p>
                      <p className="text-sm text-muted-foreground">{op.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-lg">
                  {op.efficiency.toFixed(2)}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
