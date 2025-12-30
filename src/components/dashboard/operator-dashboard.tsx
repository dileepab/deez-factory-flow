'use client';

import { useAuth } from "@/auth-provider";
import { useDoc } from "@/firebase/firestore/use-doc";
import { doc } from "firebase/firestore";
import { firestore } from "@/firebase/client";
import { useMemoFirebase } from "@/firebase/use-memo-firebase";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { SalarySlip } from "@/components/dashboard/salary-slip";
import { Target, BarChart, Package, AlertTriangle, Loader2, ClipboardList } from "lucide-react";
import type { Operator } from "@/lib/types";
import { WORKING_DAYS_PER_MONTH } from "@/lib/constants";

export function OperatorDashboard() {
  const { user, loading: isUserLoading } = useAuth();

  // Memoized reference
  const operatorRef = useMemoFirebase(() => (user && firestore ? doc(firestore, "users", user.uid) : null), [user]);

  // Data fetching
  const { data: operator, isLoading: operatorLoading } = useDoc<Operator>(operatorRef);

  // --- Salary Slip Data ---
  // Get the current month in the format "YYYY-MM"
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Get stats from the pre-aggregated monthlyStats object
  const monthlyStats = operator?.monthlyStats?.[monthKey];
  const totalEarnedMinutes = monthlyStats?.totalEarnedMinutes || 0;
  
  // Calculate absent days based on worked days
  const daysWorked = monthlyStats?.daysWorked || 0;
  const daysAbsent = Math.max(0, WORKING_DAYS_PER_MONTH - daysWorked);

  const isLoading = isUserLoading || operatorLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-40">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!operator) {
    return <div>Operator data not found.</div>;
  }

  return (
    <>
      <PageHeader
        title={`Welcome, ${operator.name}!`}
        description="Here's a summary of your performance today."
      />
      <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-5">
        <StatCard title="Efficiency" value={`${operator.efficiency || 0}%`} icon={Target} description="Target: 85%" />
        <StatCard title="Earned Minutes (Today)" value={String(Math.round(operator.earnedMinutes || 0))} icon={BarChart} description="vs 480 available" />
        <StatCard title="Total Operations (Today)" value={`${operator.totalOperations || 0}`} icon={ClipboardList} description="Individual tasks completed" />
        <StatCard title="Equivalent Garments (Today)" value={`${(operator.equivalentGarments || 0).toFixed(2)}`} icon={Package} description="Full garments worth of work"/>
        <StatCard title="Rework (Today)" value={`${operator.rework || 0} pcs`} icon={AlertTriangle} />
      </div>
      <div className="mt-6">
        <SalarySlip 
          operator={operator} 
          totalEarnedMinutes={totalEarnedMinutes}
          daysAbsent={daysAbsent}
        />
      </div>
    </>
  );
}
