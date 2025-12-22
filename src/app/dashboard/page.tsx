'use client';

import { redirect } from 'next/navigation';
import type { UserRole } from '@/lib/types';
import { PageHeader } from '@/components/shared/page-header';
import { Leaderboard } from '@/components/dashboard/leaderboard';
import { AiSuggestions } from '@/components/dashboard/ai-suggestions';
import { StyleManagement } from '@/components/dashboard/style-management';
import { ProductionEntry } from '@/components/dashboard/production-entry';
import { OperatorDashboard } from '@/components/dashboard/operator-dashboard';
import { OperatorManagement } from '@/components/dashboard/operator-management';
import { useUser } from '@/firebase';

export default function DashboardPage() {
  const { user, isUserLoading } = useUser();
  
  if (isUserLoading) {
    return <div className="flex justify-center items-center h-40">Loading...</div>
  }
  
  if (!user) {
    redirect('/');
  }
  
  const role = user.uid as UserRole;

  const AdminView = () => (
    <>
      <PageHeader
        title="Admin Dashboard"
        description="Oversee factory operations and manage system settings."
      />
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-3 space-y-6">
          <OperatorManagement />
        </div>
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

  return (
    <div className="container mx-auto">
      {role === 'admin' && <AdminView />}
      {role === 'supervisor' && <SupervisorView />}
      {role === 'operator' && <OperatorDashboard />}
    </div>
  );
}
