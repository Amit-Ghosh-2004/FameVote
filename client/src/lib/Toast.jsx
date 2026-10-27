import { createContext, useCallback, useContext, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const Ctx = createContext(() => {});
export const useToast = () => useContext(Ctx);

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info };
const TONE = { success: 'text-mint', error: 'text-brand', info: 'text-ink/70' };

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const dismiss = (id) => setItems((s) => s.filter((t) => t.id !== id));
  const push = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((s) => [...s.slice(-2), { id, message, type }]);
    setTimeout(() => dismiss(id), 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+12px)]" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => {
            const Icon = ICON[t.type] || Info;
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: -16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-line bg-sand px-4 py-3.5 text-[15px] text-ink shadow-lift">
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${TONE[t.type]}`} aria-hidden />
                <span className="flex-1">{t.message}</span>
                <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink/60 hover:text-ink"><X className="h-4 w-4" /></button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
