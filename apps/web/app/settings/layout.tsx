"use client";

import {
  ArrowLeft,
  Key,
  Link2,
  Menu,
  Settings as SettingsIcon,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AccountsSectionSkeleton } from "./accounts-section";
import { PreferencesSectionSkeleton } from "./preferences-section";
import { ProfileSectionSkeleton } from "./profile-section";
import { TokensSectionSkeleton } from "./tokens-section";

const sidebarItems = [
  {
    id: "profile",
    label: "Profile",
    href: "/settings/profile",
    icon: User,
  },
  {
    id: "preferences",
    label: "Preferences",
    href: "/settings/preferences",
    icon: SettingsIcon,
  },
  {
    id: "tokens",
    label: "Connected Clients",
    href: "/settings/tokens",
    icon: Key,
  },
  {
    id: "accounts",
    label: "Connected Accounts",
    href: "/settings/accounts",
    icon: Link2,
  },
];

function SettingsLayout({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname: string;
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const activeItem = sidebarItems.find((item) => item.href === pathname);

  const navItems = (
    <ul className="space-y-1">
      {sidebarItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              onClick={() => setMobileSidebarOpen(false)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-4 py-2 text-left text-sm transition-colors",
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 border-r border-border md:flex">
        <div className="flex h-full w-full flex-col">
          <div className="flex items-center gap-4 px-6 py-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </div>
          <nav className="flex-1 px-2 py-2">
            <div className="mb-2 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Settings
            </div>
            {navItems}
          </nav>
        </div>
      </aside>

      {/* Mobile sidebar Sheet */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="flex w-64 flex-col p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Settings navigation</SheetTitle>
          </SheetHeader>
          <div className="flex items-center gap-4 px-6 py-4">
            <Link
              href="/"
              onClick={() => setMobileSidebarOpen(false)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </div>
          <nav className="flex-1 px-2 py-2">
            <div className="mb-2 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Settings
            </div>
            {navItems}
          </nav>
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Menu className="h-4 w-4" />
          </button>
          <span className="flex-1 truncate text-sm font-medium">
            {activeItem?.label ?? "Settings"}
          </span>
        </div>
        <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 md:px-6 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const activeItem = sidebarItems.find((item) => item.href === pathname);
  const fallbackTitle = activeItem?.label ?? "Profile";
  const fallbackContent =
    activeItem?.id === "preferences" ? (
      <PreferencesSectionSkeleton />
    ) : activeItem?.id === "tokens" ? (
      <TokensSectionSkeleton />
    ) : activeItem?.id === "accounts" ? (
      <AccountsSectionSkeleton />
    ) : (
      <ProfileSectionSkeleton />
    );

  return (
    <AuthGuard
      loadingFallback={
        <SettingsLayout pathname={pathname}>
          <h1 className="text-2xl font-semibold">{fallbackTitle}</h1>
          {fallbackContent}
        </SettingsLayout>
      }
    >
      <SettingsLayout pathname={pathname}>{children}</SettingsLayout>
    </AuthGuard>
  );
}
