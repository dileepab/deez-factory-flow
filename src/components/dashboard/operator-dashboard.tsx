"use client";

import { useAuth } from "@/auth-provider";
import { useDoc } from "@/firebase/firestore/use-doc";
import { doc } from "firebase/firestore";
import { firestore } from "@/firebase/client";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { SalarySlip } from "@/components/dashboard/salary-slip";
import { Target, BarChart, Package, AlertTriangle, Loader2 } from "lucide-react";
import type { Operator } from "@/lib/types";
import { useMemo } from "react";

export function OperatorDashboard() {
  const { user, loading: isUserLoading } = useAuth();

  const operatorRef = useMemo(
    () => (user ? doc(firestore, "users", user.uid) : null),
    [user]
  );
  
  const { data: operator, isLoading: operatorLoading } = useDoc<Operator>(operatorRef);

  if (isUserLoading || operatorLoading) {
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
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Efficiency" value={`${operator.efficiency || 0}%`} icon={Target} description="Target: 85%" />
        <StatCard title="Earned Minutes" value={String(Math.round(operator.earnedMinutes || 0))} icon={BarChart} description="vs 480 available" />
        <StatCard title="Total Operations" value={`${operator.totalOperations || 0} pcs`} icon={Package} />
        <StatCard title="Rework" value={`${operator.rework || 0} pcs`} icon={AlertTriangle} />
      </div>
      <div className="mt-6">
        <SalarySlip operator={operator} />
      </div>
    </>
  );
}
