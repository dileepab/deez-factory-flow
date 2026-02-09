'use client';

import { useAuth } from "@/auth-provider";
import { useDoc } from "@/firebase/firestore/use-doc";
import { doc, collection, query, where } from "firebase/firestore";
import { firestore } from "@/firebase/client";
import { useCollection } from "@/firebase/firestore/use-collection";
import { useMemo } from "react";
import type { Operator, DailyPlan, GarmentStyle, ProductionEntry } from "@/lib/types";
import { useMemoFirebase } from "@/firebase/use-memo-firebase";
import { useConfiguration } from "@/firebase/firestore/use-configuration";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { SalarySlip } from "@/components/dashboard/salary-slip";
import { Target, BarChart, Package, AlertTriangle, Loader2, ClipboardList, Settings2 } from "lucide-react";
import { format } from "date-fns";
import { getActualWorkingDays } from "@/lib/utils";
import { DailyTimeline } from "./daily-timeline";

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
  const monthlyEquivalentGarments = monthlyStats?.equivalentGarments || 0;

  // Calculate absent days using actual working days from config
  const actualWorkingDays = getActualWorkingDays(year, month, config?.holidays || []);
  const daysAbsent = Math.max(0, actualWorkingDays - daysWorked);

  // --- Daily Schedule (New Feature) ---
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const planRef = useMemoFirebase(() => user ? doc(firestore, 'daily_plans', todayStr) : null, [user, todayStr]);
  const { data: dailyPlan } = useDoc<DailyPlan>(planRef);

  // Fetch Styles needed for the timeline
  const styleRef = useMemoFirebase(() => dailyPlan?.styleId ? doc(firestore, 'styles', dailyPlan.styleId) : null, [dailyPlan?.styleId]);
  const { data: selectedStyle } = useDoc<GarmentStyle>(styleRef);

  const nextStyleRef = useMemoFirebase(() => dailyPlan?.nextStyleId ? doc(firestore, 'styles', dailyPlan.nextStyleId) : null, [dailyPlan?.nextStyleId]);
  const { data: selectedNextStyle } = useDoc<GarmentStyle>(nextStyleRef);

  const mySchedule = dailyPlan?.schedules?.[user?.uid || ''];
  const hasSchedule = !!mySchedule;

  // --- Fetch Logs for Completion Tracking ---
  const logsQuery = useMemoFirebase(() =>
    (firestore && user?.uid)
      ? query(collection(firestore, 'production_logs'), where('operatorId', '==', user.uid))
      : null,
    [user]);

  const { data: allLogs } = useCollection<ProductionEntry>(logsQuery);

  const todayLogs = useMemo(() => {
    if (!allLogs) return [] as ProductionEntry[];
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return allLogs.filter(log => {
      // Handle diverse date formats safely
      const d = (log as any).date ? new Date((log as any).date) : (log.timestamp?.toDate ? log.timestamp.toDate() : new Date((log as any).timestamp?.seconds * 1000 || Date.now()));
      return format(d, 'yyyy-MM-dd') === todayStr;
    });
  }, [allLogs]);

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
        <StatCard
          title="Efficiency"
          value={`${operator.efficiency || 0}%`}
          icon={Target}
          description={`Month Avg: ${monthlyStats?.monthlyEfficiency || 0}%`}
        />
        <StatCard
          title="Earned Minutes"
          value={String(Math.round(operator.earnedMinutes || 0))}
          icon={BarChart}
          description={`Month Total: ${Math.round(totalEarnedMinutes)}`}
        />
        <StatCard
          title="Equivalent Garments"
          value={`${(operator.equivalentGarments || 0).toFixed(1)}`}
          icon={Package}
          description={`Month Total: ${Math.round(monthlyEquivalentGarments)}`}
        />
        <StatCard
          title="Total Operations"
          value={`${operator.totalOperations || 0}`}
          icon={ClipboardList}
          description="Completed Today"
        />
        <StatCard
          title="Rework Details"
          value={`${operator.rework || 0} pcs`}
          icon={AlertTriangle}
          description="Defects Today"
        />
      </div>

      {hasSchedule && selectedStyle && operator && (
        <div className="mt-8">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            Today's Schedule
            <div className="text-xs font-normal px-2 py-0.5 bg-green-100 text-green-800 rounded-full border border-green-200">
              Live Plan
            </div>
          </h3>
          <DailyTimeline
            assignedOperators={[operator]}
            assignments={dailyPlan!.assignments}
            selectedStyle={selectedStyle}
            selectedNextStyle={selectedNextStyle || undefined}
            flowMetrics={{}}
            availableMinutes={config?.availableMinutesPerDay || 480}
            schedule={{ [operator.id]: mySchedule }}
            productionLogs={todayLogs}
          />
        </div>
      )}

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
