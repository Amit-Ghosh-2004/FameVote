import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { Skeleton } from './ui';

const Loading = () => <div className="container-x py-10"><Skeleton className="h-40" /></div>;

export function RequireUser({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  return user ? children : <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
}

export function RequireAdmin({ children, minRole }) {
  const { admin, adminChecked, checkAdmin, loading } = useAuth();
  const order = { moderator: 1, admin: 2, superadmin: 3 };
  useEffect(() => { checkAdmin(); }, [checkAdmin]);
  if (loading || !adminChecked) return <Loading />;
  if (!admin) return <Navigate to="/admin/login" replace />;
  if (minRole && order[admin.role] < order[minRole]) return <div className="p-8 text-center text-sm text-ink/70">Your role ({admin.role}) does not have access to this area.</div>;
  return children;
}
