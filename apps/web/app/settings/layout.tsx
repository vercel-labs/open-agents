"use client";

import { ArrowLeft, Key, Settings as SettingsIcon, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { cn } from "@/lib/utils";
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
];

function SettingsLayout({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname: string;
}) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar - hidden on mobile */}
      <aside className="hidden w-64 border-r border-border md:flex">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center gap-4 px-6 py-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-2">
            <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Settings
            </div>
            <ul className="space-y-1">
              {sidebarItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
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
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {/* Mobile top navigation */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 md:hidden">
          <Link
            href="/"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {sidebarItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
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
