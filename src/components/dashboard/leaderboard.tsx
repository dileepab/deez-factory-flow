'use client';

import { useMemo } from 'react';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import { firestore } from '@/firebase/client';
import { collection, query, where } from 'firebase/firestore';
import type { User, OperatorWithEfficiency } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2 } from 'lucide-react';

export function OperatorLeaderboard() {
  // 1. Fetch all users who are operators. Memoize the query object.
  // The dependency array MUST include `firestore` to ensure the query is re-created
  // when the firestore object becomes available.
  const operatorsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'users'), where('role', '==', 'operator'));
  }, [firestore]);

  const { data: operators, isLoading: operatorsLoading } = useCollection<User>(operatorsQuery);

  // 2. Sort the operators by the pre-calculated efficiency. Use standard useMemo for this.
  const leaderboardData = useMemo(() => {
    if (!operators) {
      return [];
    }

    // Map operators and use the pre-calculated efficiency from their document
    const leaderboard: OperatorWithEfficiency[] = operators
      .map(op => ({
        ...op,
        // The 'efficiency' field is now directly available on the operator object
        efficiency: op.efficiency || 0,
      }))
      .sort((a, b) => b.efficiency - a.efficiency)
      .slice(0, 5); // Keep the top 5

    return leaderboard;
  }, [operators]);

  const isLoading = operatorsLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operator Leaderboard</CardTitle>
        <CardDescription>Top 5 operators by today's efficiency.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : leaderboardData.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">No operator data available for today.</div>
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
