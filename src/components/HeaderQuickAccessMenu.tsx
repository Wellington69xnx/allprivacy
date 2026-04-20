import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { BellIcon, TelegramIcon } from './icons';

interface HeaderQuickAccessMenuProps {
  className?: string;
}

export function HeaderQuickAccessMenu({ className = '' }: HeaderQuickAccessMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      ref={rootRef}
      className={className}
    >
      <button
        type="button"
        aria-label="Abrir notificações"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="group relative inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-black/46 text-white/82 shadow-[0_18px_44px_-22px_rgba(0,0,0,0.92)] backdrop-blur-xl transition hover:bg-black/58 hover:text-white sm:h-[3.15rem] sm:w-[3.15rem]"
      >
        <span className="absolute right-[10px] top-[10px] h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]" />
        <BellIcon className="h-5 w-5 transition group-hover:scale-105 sm:h-[1.4rem] sm:w-[1.4rem]" />
      </button>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute right-0 mt-3 w-[min(88vw,22rem)] overflow-hidden rounded-[26px] border border-white/[0.05] bg-[linear-gradient(180deg,rgba(13,13,16,0.34),rgba(6,6,8,0.44))] p-3 shadow-[0_28px_80px_-28px_rgba(0,0,0,0.95)] backdrop-blur-2xl"
          >
            <div className="divide-y divide-white/[0.04]">
              <div className="px-1 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-white/45">
                      GrupoVIP
                    </p>
                    <p className="mt-1 text-sm font-medium text-white">
                      @allprivacy_site_bot
                    </p>
                  </div>
                  <a
                    href="https://t.me/allprivacy_site_bot"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition hover:border-white/20 hover:bg-white/[0.12]"
                  >
                    <TelegramIcon className="h-3.5 w-3.5" />
                    <span>Acessar</span>
                  </a>
                </div>
              </div>

              <div className="px-1 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-white/45">
                      XVideosRED Download
                    </p>
                    <p className="mt-1 text-sm font-medium text-white">
                      @xv_download_bot
                    </p>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/90">
                      Funcionando
                    </p>
                  </div>
                  <a
                    href="https://t.me/xv_download_bot"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition hover:border-white/20 hover:bg-white/[0.12]"
                  >
                    <TelegramIcon className="h-3.5 w-3.5" />
                    <span>Acessar</span>
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
