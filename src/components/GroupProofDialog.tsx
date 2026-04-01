import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GroupProofItem } from '../types';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons';

interface GroupProofDialogProps {
  items: GroupProofItem[];
  selectedIndex: number | null;
  onClose: () => void;
  onSelect: (index: number) => void;
}

export function GroupProofDialog({
  items,
  selectedIndex,
  onClose,
  onSelect,
}: GroupProofDialogProps) {
  const touchStartXRef = useRef<number | null>(null);
  const loadingStartedAtRef = useRef(0);
  const loadingTimeoutRef = useRef<number | null>(null);
  const [showLoading, setShowLoading] = useState(false);
  const selectedItem =
    selectedIndex !== null && selectedIndex >= 0 && selectedIndex < items.length
      ? items[selectedIndex]
      : null;

  useEffect(() => {
    if (!selectedItem) {
      setShowLoading(false);
      return;
    }

    loadingStartedAtRef.current = Date.now();
    setShowLoading(true);
  }, [selectedItem?.id]);

  useEffect(() => {
    if (!selectedItem) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key === 'ArrowLeft') {
        onSelect((selectedIndex! - 1 + items.length) % items.length);
        return;
      }

      if (event.key === 'ArrowRight') {
        onSelect((selectedIndex! + 1) % items.length);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [items.length, onClose, onSelect, selectedIndex, selectedItem]);

  const goPrevious = () => {
    if (selectedIndex === null || items.length === 0) {
      return;
    }

    onSelect((selectedIndex - 1 + items.length) % items.length);
  };

  const goNext = () => {
    if (selectedIndex === null || items.length === 0) {
      return;
    }

    onSelect((selectedIndex + 1) % items.length);
  };

  const completeLoading = () => {
    const elapsed = Date.now() - loadingStartedAtRef.current;
    const remaining = Math.max(0, 280 - elapsed);

    if (loadingTimeoutRef.current !== null) {
      window.clearTimeout(loadingTimeoutRef.current);
    }

    loadingTimeoutRef.current = window.setTimeout(() => {
      setShowLoading(false);
      loadingTimeoutRef.current = null;
    }, remaining);
  };

  const dialog = (
    <AnimatePresence>
      {selectedItem ? (
        <motion.div
          className="fixed inset-0 z-[75] overflow-hidden bg-black/80 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="flex min-h-full items-end justify-center overflow-hidden px-0 md:items-center md:p-6">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={selectedItem.title || 'Print do grupo'}
              className="relative h-[min(92dvh,900px)] w-screen max-w-full overflow-hidden rounded-t-[32px] border border-white/10 bg-[#09090c]/95 shadow-2xl md:h-auto md:max-h-[86vh] md:w-[min(980px,92vw)] md:rounded-[32px]"
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

              <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top,rgba(127,29,29,0.18),transparent_34%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.08),transparent_42%)] px-5 pb-4 pt-14 sm:px-6 sm:pt-16">
                <p className="pr-10 font-display text-[1.02rem] font-semibold tracking-[0.12em] text-white/72 sm:text-[1.16rem]">
                  AllPrivacy<span className="text-white/45">.site</span>
                </p>
              </div>

              <div className="relative p-3 sm:p-4">
                <div
                  className="relative overflow-hidden rounded-[24px] border border-white/10 bg-black"
                  onTouchStart={(event) => {
                    touchStartXRef.current = event.changedTouches[0]?.clientX ?? null;
                  }}
                  onTouchEnd={(event) => {
                    const startX = touchStartXRef.current;
                    const endX = event.changedTouches[0]?.clientX ?? null;

                    if (startX === null || endX === null) {
                      return;
                    }

                    const deltaX = endX - startX;
                    if (Math.abs(deltaX) < 48) {
                      return;
                    }

                    if (deltaX > 0) {
                      goPrevious();
                    } else {
                      goNext();
                    }
                  }}
                >
                  {showLoading ? (
                    <div className="absolute inset-0 z-10 skeleton-shimmer bg-white/[0.06]">
                      <div className="absolute inset-x-6 bottom-6 flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.16em] text-white/35">
                        <span>AllPrivacy.site</span>
                        <span>Carregando</span>
                      </div>
                    </div>
                  ) : null}
                  <img
                    src={selectedItem.image}
                    alt={selectedItem.title}
                    className="max-h-[74dvh] w-full object-contain"
                    loading="eager"
                    onLoad={completeLoading}
                  />

                  {items.length > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          goPrevious();
                        }}
                        className="absolute left-3 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/85 backdrop-blur-md transition hover:bg-black/70"
                        aria-label="Ver print anterior"
                      >
                        <ChevronLeftIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          goNext();
                        }}
                        className="absolute right-3 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/85 backdrop-blur-md transition hover:bg-black/70"
                        aria-label="Ver proximo print"
                      >
                        <ChevronRightIcon className="h-5 w-5" />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') {
    return dialog;
  }

  return createPortal(dialog, document.body);
}
