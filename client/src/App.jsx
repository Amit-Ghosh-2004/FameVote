import { lazy, Suspense } from 'react';
import { Route, Routes, Navigate, Link } from 'react-router-dom';
import Layout from './components/Layout';
import { RequireUser, RequireAdmin } from './components/Guards';
import { Skeleton } from './components/ui';

const Home = lazy(() => import('./pages/Home'));
const Rankings = lazy(() => import('./pages/Rankings'));
const Vote = lazy(() => import('./pages/Vote'));
const Celebrity = lazy(() => import('./pages/Celebrity'));
const Winners = lazy(() => import('./pages/Winners'));
const Nominate = lazy(() => import('./pages/Nominate'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ReceiptPage = lazy(() => import('./pages/Receipt'));
const { HowItWorks, Integrity, VerifyReceipt } = {
  HowItWorks: lazy(() => import('./pages/Static').then((m) => ({ default: m.HowItWorks }))),
  Integrity: lazy(() => import('./pages/Static').then((m) => ({ default: m.Integrity }))),
  VerifyReceipt: lazy(() => import('./pages/Static').then((m) => ({ default: m.VerifyReceipt }))),
};
const Auth = {
  Login: lazy(() => import('./pages/Auth').then((m) => ({ default: m.Login }))),
  Register: lazy(() => import('./pages/Auth').then((m) => ({ default: m.Register }))),
  Forgot: lazy(() => import('./pages/Auth').then((m) => ({ default: m.Forgot }))),
  Reset: lazy(() => import('./pages/Auth').then((m) => ({ default: m.Reset }))),
};
const AdminShell = lazy(() => import('./admin/AdminShell'));
const AdminLogin = lazy(() => import('./admin/AdminLogin'));
const A = Object.fromEntries(['Overview', 'Categories', 'Celebrities', 'Campaigns', 'Payments', 'Users', 'Nominations', 'Settings', 'Audit'].map((n) => [n, lazy(() => import('./admin/pages').then((m) => ({ default: m[n] })))]));

const Fallback = () => <div className="container-x py-10"><Skeleton className="h-48" /></div>;
const NotFound = () => (
  <div className="container-x py-20 text-center">
    <h1 className="text-4xl font-bold">404</h1>
    <p className="mt-2 text-ink/70">That page does not exist.</p>
    <Link to="/" className="btn-primary mt-5">Back to home</Link>
  </div>
);

export default function App() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="rankings" element={<Rankings />} />
          <Route path="vote" element={<Vote />} />
          <Route path="celebrity/:slug" element={<Celebrity />} />
          <Route path="winners" element={<Winners />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="voting-integrity" element={<Integrity />} />
          <Route path="verify-receipt" element={<VerifyReceipt />} />
          <Route path="nominate" element={<RequireUser><Nominate /></RequireUser>} />
          <Route path="login" element={<Auth.Login />} />
          <Route path="register" element={<Auth.Register />} />
          <Route path="forgot-password" element={<Auth.Forgot />} />
          <Route path="reset-password" element={<Auth.Reset />} />
          <Route path="dashboard/receipts/:id" element={<RequireUser><ReceiptPage /></RequireUser>} />
          <Route path="dashboard/:tab?" element={<RequireUser><Dashboard /></RequireUser>} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="admin/login" element={<AdminLogin />} />
        <Route path="admin" element={<RequireAdmin><AdminShell /></RequireAdmin>}>
          <Route index element={<A.Overview />} />
          <Route path="categories" element={<RequireAdmin minRole="moderator"><A.Categories /></RequireAdmin>} />
          <Route path="celebrities" element={<A.Celebrities />} />
          <Route path="campaigns" element={<A.Campaigns />} />
          <Route path="payments" element={<RequireAdmin minRole="admin"><A.Payments /></RequireAdmin>} />
          <Route path="users" element={<A.Users />} />
          <Route path="nominations" element={<A.Nominations />} />
          <Route path="settings" element={<RequireAdmin minRole="admin"><A.Settings /></RequireAdmin>} />
          <Route path="audit" element={<RequireAdmin minRole="admin"><A.Audit /></RequireAdmin>} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
