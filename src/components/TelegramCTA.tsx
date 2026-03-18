import { motion } from 'framer-motion';
import { TelegramIcon } from './icons';

interface TelegramCTAProps {
  href: string;
  label: string;
  className?: string;
  pulse?: boolean;
}

export function TelegramCTA({
  href,
  label,
  className = '',
  pulse = false,
}: TelegramCTAProps) {
  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex min-h-14 items-center justify-center gap-3 rounded-full border border-white/10 bg-gradient-to-r from-rose-600 via-rose-500 to-violet-600 px-6 py-4 text-center font-display text-base font-semibold text-white shadow-glow transition-transform duration-300 hover:scale-[1.01] active:scale-[0.99] ${className}`}
      animate={
        pulse
          ? {
              scale: [1, 1.025, 1],
              boxShadow: [
                '0 0 0 rgba(239,68,68,0)',
                '0 0 34px rgba(239,68,68,0.28)',
                '0 0 0 rgba(139,92,246,0)',
              ],
            }
          : undefined
      }
      transition={
        pulse
          ? {
              duration: 2.6,
              repeat: Number.POSITIVE_INFINITY,
              ease: 'easeInOut',
            }
          : undefined
      }
    >
      <TelegramIcon className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </motion.a>
  );
}
