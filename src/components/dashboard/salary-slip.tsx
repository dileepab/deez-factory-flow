'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { MINUTE_VALUE_LKR } from '@/lib/constants';
import { calculateMonthlySalary } from '@/lib/utils';
import type { Operator } from '@/lib/types';

export function SalarySlip({ operator, totalEarnedMinutes, daysAbsent }: { operator: Operator, totalEarnedMinutes: number, daysAbsent: number }) {
  const [currentDate, setCurrentDate] = useState("");

  useEffect(() => {
    setCurrentDate(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
  }, []);

  // Calculate salary using the new centralized function
  const { finalSalary, basePay, attendanceBonus } = calculateMonthlySalary(totalEarnedMinutes, daysAbsent);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(amount);
  };

  return (
    <Card id="earnings" className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Monthly Salary Estimate</CardTitle>
        <CardDescription>Estimate based on performance up to {currentDate}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Base Pay (from minutes worked)</span>
          <span>{formatCurrency(basePay)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Attendance Bonus ({daysAbsent} {daysAbsent === 1 ? 'day' : 'days'} absent)</span>
          <span className={attendanceBonus > 0 ? "text-green-500 font-semibold" : ""}>{formatCurrency(attendanceBonus)}</span>
        </div>
        <Separator />
        <div className="flex justify-between items-center text-lg font-bold">
          <span>Total Estimated Salary</span>
          <span className="text-primary">{formatCurrency(finalSalary)}</span>
        </div>
      </CardContent>
       <CardFooter>
        <p className="text-xs text-muted-foreground">This is an estimate. Final salary may vary based on deductions and final attendance.</p>
      </CardFooter>
    </Card>
  );
}
