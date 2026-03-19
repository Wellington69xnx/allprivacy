import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import type { ModelProfile } from '../types';
import { AutoplayMedia } from './AutoplayMedia';
import { CloseIcon } from './icons';
import { TelegramCTA } from './TelegramCTA';

interface ModelModalProps {
  model: ModelProfile | null;
  onClose: () => void;
  ctaHref: string;
}

export function ModelModal({ model, onClose, ctaHref }: ModelModalProps) {
  useEffect(() => {
    if (!model) {
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
  }, [model, onClose]);

  return (
    <AnimatePresence>
      {model ? (
        <motion.div
          key={model.id}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="flex min-h-full items-end justify-center md:items-center md:p-6">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`Conteudo de ${model.name}`}
              className="relative h-[min(92dvh,900px)] w-full overflow-hidden rounded-t-[32px] border border-white/10 bg-[#09090c]/95 shadow-2xl md:h-[min(82vh,780px)] md:w-[min(1180px,95vw)] md:rounded-[32px]"
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
                <div className="relative h-[260px] overflow-hidden border-b border-white/10 md:h-[300px] lg:h-[340px]">
                  <img
                    src={model.coverImage}
                    alt={model.name}
                    className="h-full w-full object-cover object-center md:object-[center_22%]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#09090c] via-black/20 to-black/10" />

                  <div className="absolute inset-x-5 bottom-5 md:inset-x-8 md:bottom-8">
                    <div className="max-w-3xl">
                      <h3 className="font-display text-3xl font-semibold text-white md:text-5xl">
                        {model.name}
                      </h3>
                      {model.handle ? (
                        <p className="mt-2 text-sm text-zinc-200 md:text-base">{model.handle}</p>
                      ) : null}
                      {model.tagline ? (
                        <p className="mt-4 max-w-[42ch] text-sm leading-6 text-zinc-200/90 md:text-base">
                          {model.tagline}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="p-5 md:p-8">
                  {model.gallery.length === 0 ? (
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-300">
                      Essa modelo ainda nao tem previas cadastradas no painel admin.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                      {model.gallery.map((item) => (
                        <article
                          key={item.id}
                          className="overflow-hidden rounded-[24px] bg-black"
                        >
                          <div className="aspect-[4/5] bg-zinc-950">
                            <AutoplayMedia
                              type={item.type}
                              src={item.src}
                              poster={item.thumbnail}
                              alt={item.title}
                              className="h-full w-full"
                            />
                          </div>
                        </article>
                      ))}
                    </div>
                  )}

                  <div className="mt-6 rounded-[28px] border border-white/10 bg-gradient-to-r from-white/[0.08] to-white/[0.03] p-4 md:p-5">
                    <p className="text-sm leading-6 text-zinc-300">
                      Essa aba ja mostra previas liberadas. O CTA final continua aqui so
                      para conduzir a pessoa ao grupo completo sem quebrar a experiencia.
                    </p>
                    <TelegramCTA
                      href={ctaHref}
                      label={`Entrar para ver mais de ${model.name.split(' ')[0]}`}
                      className="mt-4 w-full sm:w-auto"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
