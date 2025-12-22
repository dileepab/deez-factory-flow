import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@/lib/types";
import { OPERATORS } from "@/lib/data";
import { PageHeader } from "@/components/shared/page-header";
import { Leaderboard } from "@/components/dashboard/leaderboard";
import { AiSuggestions } from "@/components/dashboard/ai-suggestions";
import { StyleManagement } from "@/components/dashboard/style-management";
import { ProductionEntry } from "@/components/dashboard/production-entry";
import { SalarySlip } from "@/components/dashboard/salary-slip";
import { StatCard } from "@/components/dashboard/stat-card";
import { Target, BarChart, Package, AlertTriangle } from "lucide-react";

export default function DashboardPage() {
  const cookieStore = cookies();
  const role = cookieStore.get("user-role")?.value as UserRole | undefined;

  if (!role) {
    redirect("/");
  }

  const AdminView = () => (
    <>
      <PageHeader
        title="Admin Dashboard"
        description="Oversee factory operations and manage system settings."
      />
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
            <StyleManagement />
        </div>
        <div className="space-y-6">
            <Leaderboard />
        </div>
         <div className="md:col-span-2 lg:col-span-3">
             <AiSuggestions />
        </div>
      </div>
    </>
  );

  const SupervisorView = () => (
     <>
      <PageHeader
        title="Supervisor Dashboard"
        description="Manage production entry and monitor team performance."
      />
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <ProductionEntry />
          <div className="pt-6">
            <AiSuggestions />
          </div>
        </div>
        <div className="space-y-6">
          <Leaderboard />
        </div>
      </div>
    </>
  );

  const OperatorView = () => {
    const operator = OPERATORS[0]; // In a real app, you'd fetch the specific operator
    return (
     <>
      <PageHeader
        title={`Welcome, ${operator.name}!`}
        description="Here's a summary of your performance today."
      />
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
         <StatCard title="Efficiency" value={`${operator.efficiency}%`} icon={Target} description="Target: 85%" />
         <StatCard title="Earned Minutes" value={String(operator.earnedMinutes)} icon={BarChart} description="vs 480 available" />
         <StatCard title="Total Production" value={`${operator.totalProduction} pcs`} icon={Package} />
         <StatCard title="Rework" value={`${operator.rework} pcs`} icon={AlertTriangle} />
      </div>
      <div className="mt-6">
        <SalarySlip operator={operator} />
      </div>
    </>
    );
  };

  return (
    <div className="container mx-auto">
        {role === "admin" && <AdminView />}
        {role === "supervisor" && <SupervisorView />}
        {role === "operator" && <OperatorView />}
    </div>
  );
}
