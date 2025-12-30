import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { WalletConnectButton } from "./WalletConnectButton";
import { cn } from "@/lib/utils";
import { Vote, Menu, X } from "lucide-react";

const prefetchers: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/Dashboard"),
  "/my-groups": () => import("@/pages/MyGroups"),
  "/my-polls": () => import("@/pages/MyPolls"),
  "/profile": () => import("@/pages/Profile"),
};

export function Header() {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navLinks = useMemo(
    () => [
      { name: "Dashboard", path: "/" },
      { name: "My Groups", path: "/my-groups" },
      { name: "My Polls", path: "/my-polls" },
      { name: "Profile", path: "/profile" },
    ],
    []
  );

  const isActive = (path: string) => {
    if (path === "/" && location.pathname !== "/") return false;
    return location.pathname.startsWith(path);
  };

  const prefetchRoute = (path: string) => {
    if (location.pathname.startsWith(path)) return;
    const fn = prefetchers[path];
    if (!fn) return;
    void fn().catch(() => {});
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2 font-bold text-xl tracking-tighter">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-lg">
              <Vote className="h-5 w-5" />
            </div>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500">
              VERITAS
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                onMouseEnter={() => prefetchRoute(link.path)}
                onFocus={() => prefetchRoute(link.path)}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-primary",
                  isActive(link.path) ? "text-primary" : "text-muted-foreground"
                )}
              >
                {link.name}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <WalletConnectButton />

          <button
            type="button"
            className="md:hidden p-2"
            onClick={() => setIsMobileMenuOpen((v) => !v)}
            aria-label="Toggle mobile menu"
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="md:hidden border-t p-4 space-y-4 bg-background animate-accordion-down">
          <nav className="flex flex-col gap-4">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                onMouseEnter={() => prefetchRoute(link.path)}
                onFocus={() => prefetchRoute(link.path)}
                onClick={() => setIsMobileMenuOpen(false)}
                className={cn(
                  "text-sm font-medium transition-colors p-2 rounded-md hover:bg-muted",
                  isActive(link.path) ? "bg-muted text-primary" : "text-muted-foreground"
                )}
              >
                {link.name}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
