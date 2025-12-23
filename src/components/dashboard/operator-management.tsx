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
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { collection, query, where } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import type { User } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { promoteToSupervisor } from '@/lib/actions';

export function OperatorManagement() {
  const operatorsQuery = useMemoFirebase(
    () => query(collection(firestore, 'users'), where('role', '==', 'operator')),
    []
  );
  const { data: operators, isLoading: operatorsLoading } =
    useCollection<User>(operatorsQuery);

  const handlePromote = async (userId: string) => {
    try {
      await promoteToSupervisor(userId);
      // Optionally, you can add a toast notification here to show success
    } catch (error) {
      console.error('Error promoting user:', error);
      // Optionally, you can add a toast notification here to show the error
    }
  };

  return (
    <Card id="operators">
      <CardHeader>
        <CardTitle>Operator Management</CardTitle>
        <CardDescription>View and manage operators.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {operatorsLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center">
                  <div className="flex justify-center items-center">
                    <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                    Loading operators...
                  </div>
                </TableCell>
              </TableRow>
            )}
            {operators?.map(operator => (
              <TableRow key={operator.id}>
                <TableCell className="font-medium">{operator.name}</TableCell>
                <TableCell>{operator.email}</TableCell>
                <TableCell>{operator.role}</TableCell>
                <TableCell className="text-right">
                  <Button onClick={() => handlePromote(operator.id)} size="sm">
                    Promote to Supervisor
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
