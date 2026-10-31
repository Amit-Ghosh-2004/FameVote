import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Tags, Users2, Trophy, CreditCard, UserCog, Inbox, Settings, ScrollText, LogOut } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { ThemeToggle } from '../lib/theme';

const ORDER = { moderator: 1, admin: 2, superadmin: 3 };
const NAV = [['/admin', LayoutDashboard, 'Overview', 1, true], ['/admin/categories', Tags, 'Categories', 1], ['/admin/celebrities', Users2, 'Celebrities', 1], ['/admin/campaigns', Trophy, 'Campaigns', 1], ['/admin/payments', CreditCard, 'Payments', 2], ['/admin/users', UserCog, 'Users', 1], ['/admin/nominations', Inbox, 'Nominations', 1], ['/admin/settings', Settings, 'Settings', 2], ['/admin/audit', ScrollText, 'Audit log', 2]];

export default function AdminShell() {
  const { admin, adminLogout } = useAuth(); const nav = useNavigate();
  const items = NAV.filter(([, , , min]) => ORDER[admin.role] >= min);
  return (
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[230px_1fr]">
      <aside className="border-b border-line bg-surface text-ink lg:sticky lg:border-b-0 lg:border-r lg:top-0 lg:h-screen">
        <div className="flex items-center justify-between px-4 py-3 lg:block"><div><p className="text-lg font-bold text-ink">FameVote</p><p className="text-[11px] text-ink/60">{admin.name} · {admin.role}</p></div>
          <ThemeToggle className="lg:mt-3" />
          <button className="rounded-lg p-2 hover:bg-ink/10 lg:flex lg:w-full lg:items-center lg:gap-2 lg:text-sm" onClick={async () => { await adminLogout(); nav('/admin/login'); }}><LogOut className="h-4 w-4" /><span className="hidden lg:inline">Sign out</span></button></div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible" aria-label="Admin">
          {items.map(([to, Icon, label, , end]) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium ${isActive ? 'bg-ink text-paper' : 'text-ink/75 hover:bg-ink/10'}`}><Icon className="h-4 w-4" />{label}</NavLink>)}
        </nav>
      </aside>
      <main className="min-w-0 p-4 sm:p-6"><Outlet /></main>
    </div>
  );
}
