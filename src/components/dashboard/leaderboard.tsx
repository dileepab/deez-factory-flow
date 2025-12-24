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
import { collection, query, where, orderBy } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import type { ProductionEntry, User, GarmentStyle } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface OperatorWithEfficiency extends User {
  efficiency: number;
}

// Helper function to calculate duration in minutes from a time range string
const getDurationInMinutes = (range: string): number => {
  if (!range) return 0;
  try {
    const [start, end] = range.split(' - ');
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const startDate = new Date(2000, 0, 1, startH, startM, 0);
    const endDate = new Date(2000, 0, 1, endH, endM, 0);
    const duration = (endDate.getTime() - startDate.getTime()) / (1000 * 60);
    return duration > 0 ? duration : 0;
  } catch (e) {
    return 0;
  }
};

export function Leaderboard() {
  const operatorsQuery = useMemoFirebase(
    () => query(collection(firestore, 'users'), where('role', '==', 'operator')),
    []
  );
  const { data: operators, isLoading: operatorsLoading } =
    useCollection<User>(operatorsQuery);

  const productionLogsQuery = useMemoFirebase(
    () => query(collection(firestore, 'production'), orderBy('timestamp', 'desc')),
    []
  );
  const { data: productionLogs, isLoading: logsLoading } =
    useCollection<ProductionEntry>(productionLogsQuery);

  const stylesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'styles') : null, []);
  const { data: styles, isLoading: stylesLoading } = useCollection<GarmentStyle>(stylesQuery);

  const operatorPerformance = useMemo(() => {
    if (!operators || !productionLogs || !styles) return [];

    // Performance map stores total earned minutes and a SET of unique worked time slots
    const performanceMap = new Map<string, { totalEarnedMinutes: number; workedSlots: Set<string> }>();

    // Process each production log to calculate earned minutes
    productionLogs.forEach(log => {
      const style = styles.find(s => s.id === log.styleId);
      if (!style) return;

      const operation = style.operations.find(op => op.id === log.operationId);
      if (!operation) return;

      const quantity = log.cumulativeQuantity;
      const smvInSeconds = typeof operation.time === 'string' ? parseFloat(operation.time) : operation.time;

      if (isNaN(quantity) || isNaN(smvInSeconds) || smvInSeconds <= 0) {
        return;
      }
      
      const earnedMinutes = quantity * (smvInSeconds / 60);

      // Initialize or update the operator's performance
      if (!performanceMap.has(log.operatorId)) {
        performanceMap.set(log.operatorId, { totalEarnedMinutes: 0, workedSlots: new Set() });
      }
      
      const currentPerformance = performanceMap.get(log.operatorId)!;
      currentPerformance.totalEarnedMinutes += earnedMinutes;
      // Add the time slot to the Set. Duplicates are automatically ignored.
      currentPerformance.workedSlots.add(log.hourlyRange);
    });

    // Map operators to their calculated efficiency
    const leaderboardData: OperatorWithEfficiency[] = operators
      .map(op => {
        const performance = performanceMap.get(op.id);
        let efficiency = 0;
        
        if (performance) {
          // Calculate total attended minutes by summing the duration of each UNIQUE time slot
          const totalAttendedMinutes = Array.from(performance.workedSlots).reduce((total, slot) => {
            return total + getDurationInMinutes(slot);
          }, 0);

          if (totalAttendedMinutes > 0) {
            efficiency = (performance.totalEarnedMinutes / totalAttendedMinutes) * 100;
          }
        }

        return { ...op, efficiency };
      })
      .sort((a, b) => b.efficiency - a.efficiency)
      .slice(0, 5); // Keep the top 5

    return leaderboardData;
  }, [operators, productionLogs, styles]);

  const isLoading = operatorsLoading || logsLoading || stylesLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operator Leaderboard</CardTitle>
        <CardDescription>
          Top 5 performing operators based on efficiency.
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
            {!isLoading && operatorPerformance.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-muted-foreground">
                  No production data available to calculate efficiency.
                </TableCell>
              </TableRow>
            )}
            {operatorPerformance.map(op => (
              <TableRow key={op.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="hidden h-9 w-9 sm:flex">
                      {/* Assuming avatar images are not set up yet, using fallback */}
                      <AvatarFallback>{op.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
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
