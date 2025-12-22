'use client';

import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Factory,
  LayoutDashboard,
  Users,
  Scissors,
  ClipboardEdit,
  BrainCircuit,
  User,
} from "lucide-react";
import { UserNav } from "@/components/shared/user-nav";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { UserRole } from "@/lib/types";
import { useAuth } from "@/firebase";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    redirect("/");
  }

  const role = user.role as UserRole;
  const isAdmin = role === 'admin';
  const isSupervisor = role === 'supervisor';
  const isOperator = role === 'operator';

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 p-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Factory className="h-6 w-6" />
            </div>
            <span className="font-bold text-lg">FactoryFlow</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Dashboard">
                <Link href="/dashboard">
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {isAdmin && (
               <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Style Management">
                  <Link href="/dashboard#styles">
                    <Scissors />
                    <span>Style Management</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            
            {(isAdmin || isSupervisor) && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Production Entry">
                  <Link href="/dashboard#production">
                    <ClipboardEdit />
                    <span>Production Entry</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

             {(isAdmin || isSupervisor) && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Leaderboard">
                      <Link href="/dashboard#leaderboard">
                        <Users />
                        <span>Leaderboard</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="AI Suggestions">
                      <Link href="/dashboard#ai-suggestions">
                        <BrainCircuit />
                        <span>AI Suggestions</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
             )}

            {isOperator && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="My Earnings">
                  <Link href="/dashboard#earnings">
                    <User />
                    <span>My Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <UserNav />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-4 border-b bg-card px-4 lg:h-[60px] lg:px-6">
            <SidebarTrigger className="md:hidden" />
            <div className="w-full flex-1">
                {/* Search bar could go here */}
            </div>
        </header>
        <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
