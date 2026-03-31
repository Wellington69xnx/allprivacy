import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import type { StaticInfoContent } from '../lib/staticInfo';
import { CloseIcon } from './icons';
import { TelegramCTA } from './TelegramCTA';

interface StaticInfoModalProps {
  content: StaticInfoContent | null;
  onClose: () => void;
}

export function StaticInfoModal({ content, onClose }: StaticInfoModalProps) {
  useEffect(() => {
    if (!content) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [content, onClose]);

  return (
    <AnimatePresence>
      {content ? (
        <motion.div
          className="fixed inset-0 z-[70] overflow-hidden bg-black/80 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="flex min-h-full items-end justify-center overflow-hidden px-0 md:items-center md:p-6">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={content.title}
              className="relative h-[min(92dvh,900px)] w-screen max-w-full overflow-hidden rounded-t-[32px] border border-white/10 bg-[#09090c]/95 shadow-2xl md:h-auto md:max-h-[82vh] md:w-[min(1080px,94vw)] md:rounded-[32px]"
              initial={{ opacity: 0, y: 40, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.98 }}
              transition={{ type: 'spring', damping: 30, stiffness: 240 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white backdrop-blur-md"
              >
                <CloseIcon className="h-5 w-5" />
              </button>

              <div className="hide-scrollbar h-full overflow-y-auto">
                <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top,rgba(127,29,29,0.18),transparent_34%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.08),transparent_42%)] px-5 pb-8 pt-16 sm:px-8 sm:pb-10 sm:pt-20">
                  <h1 className="max-w-3xl font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                    {content.title}
                  </h1>
                  <p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-6 text-zinc-300 sm:text-base">
                    {content.description}
                  </p>
                </div>

                <div className="grid gap-4 px-5 py-5 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] sm:px-8 sm:py-8 md:pb-8 lg:grid-cols-3">
                  {content.sections.map((section) => (
                    <article
                      key={section.title}
                      className="rounded-[26px] border border-white/10 bg-black/20 p-5"
                    >
                      <h2 className="font-display text-xl font-semibold tracking-tight text-white">
                        {section.title}
                      </h2>
                      <p className="mt-3 whitespace-pre-line text-sm leading-6 text-zinc-300">
                        {section.body}
                      </p>
                    </article>
                  ))}
                </div>

                {content.ctaHref && content.ctaLabel ? (
                  <div className="hidden px-5 pb-5 sm:px-8 sm:pb-8 md:block">
                    <div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
                      <TelegramCTA
                        href={content.ctaHref}
                        label={content.ctaLabel}
                        className="w-full sm:w-auto"
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {content.ctaHref && content.ctaLabel ? (
                <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#09090c] via-[#09090c]/95 to-transparent px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-6 md:hidden">
                  <TelegramCTA
                    href={content.ctaHref}
                    label={content.ctaLabel}
                    className="min-h-12 w-full px-5 py-3 text-sm"
                  />
                </div>
              ) : null}
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
