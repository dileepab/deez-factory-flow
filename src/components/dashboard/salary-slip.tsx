"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ATTENDANCE_BONUS_LKR } from "@/lib/constants";
import { calculateDailyEarnings } from "@/lib/calculations";
import type { Operator } from "@/lib/types";

export function SalarySlip({ operator }: { operator: Operator }) {
  const earnings = calculateDailyEarnings(operator.earnedMinutes, true, ATTENDANCE_BONUS_LKR);
  const [currentDate, setCurrentDate] = useState("");

  useEffect(() => {
    setCurrentDate(new Date().toLocaleDateString());
  }, []);
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(amount);
  };

  return (
    <Card id="earnings" className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Today's Estimated Earnings</CardTitle>
        <CardDescription>Based on your performance on {currentDate}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Guaranteed Base Pay</span>
          <span>{formatCurrency(earnings.basePay)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Incentive Pay (up to 100% eff.)</span>
          <span>{formatCurrency(earnings.incentivePay)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Efficiency Bonus (over 100% eff.)</span>
          <span className="text-green-500 font-semibold">{formatCurrency(earnings.bonusPay)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Attendance Bonus</span>
          <span>{formatCurrency(earnings.attendanceBonus)}</span>
        </div>
        <Separator />
        <div className="flex justify-between items-center text-lg font-bold">
          <span>Total Estimated Earnings</span>
          <span className="text-primary">{formatCurrency(earnings.total)}</span>
        </div>
      </CardContent>
       <CardFooter>
        <p className="text-xs text-muted-foreground">This is an estimate. Final salary may vary based on deductions and other adjustments.</p>
      </CardFooter>
    </Card>
  );
}
