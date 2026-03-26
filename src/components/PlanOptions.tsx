import { motion } from 'framer-motion';
import {
  formatPlanAmountBRL,
  type SubscriptionPlanLink,
} from '../lib/subscriptionPlans';
import { TelegramCTA } from './TelegramCTA';

interface PlanOptionsProps {
  plans: SubscriptionPlanLink[];
  className?: string;
  compact?: boolean;
}

export function PlanOptions({
  plans,
  className = '',
  compact = false,
}: PlanOptionsProps) {
  if (plans.length === 0) {
    return null;
  }

  return (
    <div
      className={`grid gap-3 ${compact ? '' : 'lg:grid-cols-2'} ${className}`.trim()}
    >
      {plans.map((plan, index) => (
        <motion.article
          key={plan.id}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.45, delay: index * 0.06, ease: 'easeOut' }}
          className={`rounded-[28px] border border-white/10 bg-gradient-to-br from-white/[0.08] via-white/[0.04] to-transparent ${
            compact ? 'p-4' : 'p-5 md:p-6'
          }`}
        >
          <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55">
            {plan.name}
          </span>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <h3
                className={`font-display font-semibold tracking-tight text-white ${
                  compact ? 'text-2xl' : 'text-3xl'
                }`}
              >
                {plan.durationLabel}
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                Acesso liberado via bot com entrega automatica no Telegram.
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                Valor
              </p>
              <p className="mt-2 font-display text-2xl font-semibold text-white">
                {formatPlanAmountBRL(plan.displayAmount)}
              </p>
            </div>
          </div>

          <TelegramCTA
            href={plan.href}
            label={`Liberar ${plan.durationLabel}`}
            className="mt-5 w-full"
          />
        </motion.article>
      ))}
    </div>
  );
}
