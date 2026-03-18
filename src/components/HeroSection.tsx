import { motion } from 'framer-motion';
import { heroBackdrop } from '../data/models';
import { ChevronDownIcon } from './icons';
import { TelegramCTA } from './TelegramCTA';

interface HeroSectionProps {
  ctaHref: string;
}

export function HeroSection({ ctaHref }: HeroSectionProps) {
  const scrollToPreviews = () => {
    document.getElementById('previas')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative h-[100dvh] overflow-hidden">
      <div className="absolute inset-0">
        <img
          src={heroBackdrop}
          alt=""
          className="h-full w-full object-cover opacity-45 brightness-[0.62]"
        />
        <div className="absolute inset-0 bg-black/68" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(127,29,29,0.36),transparent_28%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.14),transparent_34%)]" />
      </div>

      <div className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="inline-flex items-center rounded-full border border-white/10 bg-black/30 px-4 py-2 backdrop-blur-md">
            <span className="font-display text-sm font-semibold uppercase tracking-[0.28em] text-white/90">
              AllPrivacy
            </span>
          </div>
        </div>
      </div>

      <div className="relative mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center px-5 pb-32 pt-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="space-y-4"
        >
          <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-white sm:text-5xl">
            AllPrivacy VIP +18 no Telegram.
          </h1>
          <p className="mx-auto max-w-xl text-sm leading-6 text-zinc-300 sm:text-base">
            Entrada discreta, visual reservado e acesso imediato.
          </p>
        </motion.div>
      </div>

      <div className="absolute inset-x-0 bottom-20 flex flex-col items-center justify-center gap-3 px-4">
        <TelegramCTA
          href={ctaHref}
          label="Entrar no Grupo VIP"
          className="w-full max-w-sm sm:w-auto sm:min-w-[320px]"
        />
        <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-white/55">
          Entrada imediata
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-5 flex justify-center">
        <motion.button
          type="button"
          onClick={scrollToPreviews}
          className="flex flex-col items-center gap-1 text-white/65"
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.26em]">
            Ver mais
          </span>
          <ChevronDownIcon className="h-6 w-6" />
        </motion.button>
      </div>
    </section>
  );
}
