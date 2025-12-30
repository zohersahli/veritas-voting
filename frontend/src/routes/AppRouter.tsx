import { Suspense, lazy, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { Header } from "@/components/Header";
import { NetworkBanner } from "@/components/NetworkBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer } from "@/components/Toast";
import { ListSkeleton } from "@/components/LoadingSkeleton";

type IdleCallbackDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type RequestIdleCallbackOptions = { timeout?: number };
type RequestIdleCallback = (callback: (deadline: IdleCallbackDeadline) => void, options?: RequestIdleCallbackOptions) => number;
type CancelIdleCallback = (handle: number) => void;

const Dashboard = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const CreateGroup = lazy(() => import("@/pages/CreateGroup").then((m) => ({ default: m.CreateGroup })));
const GroupDetails = lazy(() => import("@/pages/GroupDetails").then((m) => ({ default: m.GroupDetails })));
const CreatePoll = lazy(() => import("@/pages/CreatePoll").then((m) => ({ default: m.CreatePoll })));
const PollDetails = lazy(() => import("@/pages/PollDetails").then((m) => ({ default: m.PollDetails })));
const Delegation = lazy(() => import("@/pages/Delegation").then((m) => ({ default: m.Delegation })));
const Results = lazy(() => import("@/pages/Results").then((m) => ({ default: m.Results })));
const L1Results = lazy(() => import("@/pages/L1Results").then((m) => ({ default: m.L1Results })));
const MyGroups = lazy(() => import("@/pages/MyGroups").then((m) => ({ default: m.MyGroups })));
const MyPolls = lazy(() => import("@/pages/MyPolls").then((m) => ({ default: m.MyPolls })));
const Profile = lazy(() => import("@/pages/Profile").then((m) => ({ default: m.Profile })));
const NotFound = lazy(() => import("@/pages/NotFound").then((m) => ({ default: m.NotFound })));

function RouteFallback() {
  return (
    <div className="py-8">
      <ListSkeleton count={3} />
    </div>
  );
}

export function AppRouter() {
  useEffect(() => {
    const run = () => {
      void import("@/pages/MyGroups").catch(() => {});
      void import("@/pages/MyPolls").catch(() => {});
      void import("@/pages/Profile").catch(() => {});
    };

    if (typeof window === "undefined") return;

    const ric = (globalThis as unknown as { requestIdleCallback?: RequestIdleCallback }).requestIdleCallback;
    const cic = (globalThis as unknown as { cancelIdleCallback?: CancelIdleCallback }).cancelIdleCallback;

    if (ric) {
      const handle = ric(() => run(), { timeout: 1200 });
      return () => {
        if (cic) cic(handle);
      };
    }

    const t = globalThis.setTimeout(run, 500);
    return () => globalThis.clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <ErrorBoundary>
        <Header />
        <NetworkBanner />

        <main className="container py-8 mx-auto px-4 md:px-6 lg:px-8">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/groups/create" element={<CreateGroup />} />
              <Route path="/groups/:groupId" element={<GroupDetails />} />
              <Route path="/polls/create" element={<CreatePoll />} />
              <Route path="/polls/:pollId" element={<PollDetails />} />
              <Route path="/polls/:pollId/delegate" element={<Delegation />} />
              <Route path="/polls/:pollId/results" element={<Results />} />
              <Route path="/results/l1/:groupId/:pollId" element={<L1Results />} />
              <Route path="/my-groups" element={<MyGroups />} />
              <Route path="/my-polls" element={<MyPolls />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>

        <ToastContainer />
      </ErrorBoundary>
    </div>
  );
}
