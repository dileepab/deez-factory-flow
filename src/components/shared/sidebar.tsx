import { SidebarNav } from "./sidebar-nav";

export function Sidebar() {
  return (
    <div className="hidden border-r bg-muted/40 md:block">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
          {/* Add your logo here */}
          <h1 className="text-lg font-semibold">Acme Inc.</h1>
        </div>
        <div className="flex-1">
          <SidebarNav />
        </div>
      </div>
    </div>
  );
}
