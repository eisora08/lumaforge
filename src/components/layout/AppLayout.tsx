import { useState } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { SearchProvider } from "../../context/SearchContext";
import { LibraryGamesProvider } from "../../context/LibraryGamesContext";
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
    <div className="relative h-screen overflow-hidden bg-(--color-bg) text-(--color-text)">
      <div className="lf-backdrop" />

      <LibraryGamesProvider>
        <div className="relative z-10 flex h-screen w-full">
          <Sidebar
            isOpen={isSidebarOpen}
            isCollapsed={isSidebarCollapsed}
            activePage={activePage}
            onClose={() => setIsSidebarOpen(false)}
            onToggleCollapse={() => setIsSidebarCollapsed((value) => !value)}
            onNavigate={onNavigate}
          />

          <div className="flex min-w-0 flex-1 flex-col lf-page">
            <SearchProvider>
              <TopBar
                onOpenSidebar={() => setIsSidebarOpen(true)}
                activePage={activePage}
                onNavigate={onNavigate}
              />

              <main className="min-h-0 flex-1 overflow-y-auto">
                {children}
              </main>
            </SearchProvider>
          </div>
        </div>
      </LibraryGamesProvider>
    </div>
  );
}