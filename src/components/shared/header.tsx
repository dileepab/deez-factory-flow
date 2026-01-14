'use client';

import { SidebarTrigger } from "@/components/ui/sidebar";
import { UserNav } from "@/components/dashboard/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";

export function Header() {
  return (
    <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
      <SidebarTrigger className="shrink-0 md:hidden" />
      <div className="w-full flex-1" />
      <ThemeToggle />
      <UserNav />
    </header>
  );
}
