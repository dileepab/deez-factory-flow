'use client';

import { useState } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2, Eye } from 'lucide-react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useConfiguration } from '@/firebase/firestore/use-configuration';
import { collection, query, where } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import type { AnyUser, Operator, Configuration } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { SalarySlip } from '@/components/dashboard/salary-slip';
import { calculateMonthlySalary } from '@/lib/utils';

export function OperatorManagement() {
  const { data: config } = useConfiguration();
  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(null);
  const [isSalaryDialogOpen, setIsSalaryDialogOpen] = useState(false);

  const operatorsQuery = useMemoFirebase(
    () => query(collection(firestore, 'users'), where('role', '==', 'operator')),
    []
  );
  const { data: operators, isLoading: operatorsLoading } =
    useCollection<AnyUser>(operatorsQuery);

  const handleViewSalary = (operator: AnyUser) => {
    setSelectedOperator(operator as Operator);
    setIsSalaryDialogOpen(true);
  };

  const getOperatorSalary = (operator: AnyUser) => {
    if (!config) return 0;

    // Calculate based on monthly stats if available, otherwise 0
    // We are looking at the current month's accumulated stats. 
    // Ideally 'monthlyStats' key would be 'YYYY-MM'. For now, assuming direct properties or single month stats logic
    // Based on User type, stats are on root or in monthlyStats. Let's use root properties as fallback or sum

    const totalEarnedMinutes = operator.monthlyStats?.[new Date().toISOString().slice(0, 7)]?.totalEarnedMinutes || operator.earnedMinutes || 0;
    // Assuming 0 days absent for simple estimation in the table, or we need an 'absent' field 
    const daysAbsent = 0;

    const { finalSalary } = calculateMonthlySalary(
      totalEarnedMinutes,
      daysAbsent,
      config.minuteValueLKR,
      config.attendanceBonusLKR
    );
    return finalSalary;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(amount);
  };

  return (
    <>
      <Card id="operators">
        <CardHeader>
          <CardTitle>Operator Management</CardTitle>
          <CardDescription>View and manage operators.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Est. Salary</TableHead>
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
                  <TableCell>{config ? formatCurrency(getOperatorSalary(operator)) : '-'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleViewSalary(operator)} title="View Salary Slip">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isSalaryDialogOpen} onOpenChange={setIsSalaryDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Salary Details: {selectedOperator?.name}</DialogTitle>
          </DialogHeader>
          {selectedOperator && config && (
            <SalarySlip
              operator={selectedOperator}
              // Using same logic as table for consistency, or refined if data available
              totalEarnedMinutes={selectedOperator.monthlyStats?.[new Date().toISOString().slice(0, 7)]?.totalEarnedMinutes || selectedOperator.earnedMinutes || 0}
              daysAbsent={0} // Placeholder until attendance modules is linked
              config={config}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
