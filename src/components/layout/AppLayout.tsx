import { useState } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { AppPage } from "../../types/navigation";

type AppLayoutProps = {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  children: React.ReactNode;
};

export default function AppLayout({
  activePage,
  onNavigate,
  children,
}: AppLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#181114] text-white lg:flex">
      <Sidebar
        isOpen={isSidebarOpen}
        isCollapsed={isSidebarCollapsed}
        activePage={activePage}
        onClose={() => setIsSidebarOpen(false)}
        onToggleCollapse={() => setIsSidebarCollapsed((value) => !value)}
        onNavigate={onNavigate}
      />

      <div className="flex-1 min-w-0">
        <TopBar onOpenSidebar={() => setIsSidebarOpen(true)} />

        <main className="min-h-[calc(100vh-4rem)]">
          {children}
        </main>
      </div>
    </div>
  );
}