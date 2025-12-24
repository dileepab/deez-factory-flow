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
import { collection, query, where } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import type { AnyUser } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';

export function SupervisorManagement() {
  const supervisorsQuery = useMemoFirebase(
    () => query(collection(firestore, 'users'), where('role', '==', 'supervisor')),
    []
  );
  const { data: supervisors, isLoading: supervisorsLoading } =
    useCollection<AnyUser>(supervisorsQuery);

  return (
    <Card id="supervisors">
      <CardHeader>
        <CardTitle>Supervisor Management</CardTitle>
        <CardDescription>View and manage supervisors.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {supervisorsLoading && (
              <TableRow>
                <TableCell colSpan={3} className="text-center">
                  <div className="flex justify-center items-center">
                    <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                    Loading supervisors...
                  </div>
                </TableCell>
              </TableRow>
            )}
            {supervisors?.map(supervisor => (
              <TableRow key={supervisor.id}>
                <TableCell className="font-medium">{supervisor.name}</TableCell>
                <TableCell>{supervisor.email}</TableCell>
                <TableCell className="text-right">{supervisor.role}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
