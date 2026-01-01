'use client';

import { useAuth } from "@/auth-provider";
import { useDoc } from "@/firebase/firestore/use-doc";
import { doc } from "firebase/firestore";
import { firestore } from "@/firebase/client";
import { useMemoFirebase } from "@/firebase/use-memo-firebase";
import { useConfiguration } from "@/firebase/firestore/use-configuration";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { SalarySlip } from "@/components/dashboard/salary-slip";
import { Target, BarChart, Package, AlertTriangle, Loader2, ClipboardList, Settings2 } from "lucide-react";
import type { Operator } from "@/lib/types";
import { getActualWorkingDays } from "@/lib/utils";

export function OperatorDashboard() {
  const { user, loading: isUserLoading } = useAuth();
  const { data: config, isLoading: isConfigLoading } = useConfiguration();

  // Memoized reference to the operator document
  const operatorRef = useMemoFirebase(() => (user && firestore ? doc(firestore, "users", user.uid) : null), [user]);

  // Fetch operator data
  const { data: operator, isLoading: isOperatorLoading } = useDoc<Operator>(operatorRef);

  // --- Salary Slip Data ---
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // Use 1-indexed month
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  const monthlyStats = operator?.monthlyStats?.[monthKey];
  const totalEarnedMinutes = monthlyStats?.totalEarnedMinutes || 0;
  const daysWorked = monthlyStats?.daysWorked || 0;

  // Calculate absent days using actual working days from config
  const actualWorkingDays = getActualWorkingDays(year, month, config?.holidays || []);
  const daysAbsent = Math.max(0, actualWorkingDays - daysWorked);

  const isLoading = isUserLoading || isOperatorLoading || isConfigLoading;

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

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-center">
         <Settings2 className="h-10 w-10 text-destructive mb-2" />
        <h3 className="text-lg font-semibold">Configuration Not Found</h3>
        <p className="text-sm text-muted-foreground">
          Please ask an administrator to set up the main configuration file in the database.
        </p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={`Welcome, ${operator.name}!`}
        description="Here's a summary of your performance today."
      />
      <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-5">
        <StatCard title="Efficiency" value={`${operator.efficiency || 0}%`} icon={Target} description="Target: 85%" />
        <StatCard title="Earned Minutes (Today)" value={String(Math.round(operator.earnedMinutes || 0))} icon={BarChart} description={`vs ${config.availableMinutesPerDay} available`} />
        <StatCard title="Total Operations (Today)" value={`${operator.totalOperations || 0}`} icon={ClipboardList} description="Individual tasks completed" />
        <StatCard title="Equivalent Garments (Today)" value={`${(operator.equivalentGarments || 0).toFixed(2)}`} icon={Package} description="Full garments worth of work"/>
        <StatCard title="Rework (Today)" value={`${operator.rework || 0} pcs`} icon={AlertTriangle} />
      </div>
      <div className="mt-6">
        <SalarySlip 
          operator={operator}
          totalEarnedMinutes={totalEarnedMinutes}
          daysAbsent={daysAbsent}
          config={config}
        />
      </div>
    </>
  );
}
