import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type TouchEventHandler } from 'react';
import { createPortal } from 'react-dom';
import {
  claimMediaAudioFocus,
  registerMediaAudioFocus,
  releaseMediaAudioFocus,
} from '../lib/mediaAudioFocus';
import {
  getRememberedMediaPlaybackTime,
  rememberMediaPlaybackTime,
} from '../lib/mediaPlaybackMemory';
import type { MediaPreviewDialogSelection } from '../types';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, VolumeOffIcon, VolumeOnIcon } from './icons';

interface MediaPreviewDialogProps {
  selection: MediaPreviewDialogSelection | null;
  onClose: () => void;
  canNavigate?: boolean;
  onNavigate?: (direction: 'previous' | 'next') => void;
}

export function MediaPreviewDialog({
  selection,
  onClose,
  canNavigate = false,
  onNavigate,
}: MediaPreviewDialogProps) {
  const item = selection?.item ?? null;
  const handoffPoster = selection?.handoffPoster || '';
  const initialPlaybackTime = selection?.initialPlaybackTime ?? 0;
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioFocusIdRef = useRef(`media-dialog-audio-${Math.random().toString(36).slice(2)}`);
  const loadingStartedAtRef = useRef(0);
  const loadingTimeoutRef = useRef<number | null>(null);
  const initialSeekFallbackRef = useRef<number | null>(null);
  const isAwaitingInitialSeekRef = useRef(false);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [isPlaybackVisible, setIsPlaybackVisible] = useState(false);
  const canNavigateMedia = Boolean(item && canNavigate && onNavigate);

  useEffect(() => {
    if (!item) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }

      if (event.key === 'ArrowLeft' && canNavigateMedia) {
        event.preventDefault();
        onNavigate?.('previous');
      }

      if (event.key === 'ArrowRight' && canNavigateMedia) {
        event.preventDefault();
        onNavigate?.('next');
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [canNavigateMedia, item, onClose, onNavigate]);

  useEffect(() => {
    setIsMuted(true);
  }, [item?.id]);

  useEffect(() => {
    if (!item) {
      setShowLoading(false);
      setIsPlaybackVisible(false);
      return;
    }

    loadingStartedAtRef.current = Date.now();
    setShowLoading(true);
    setIsPlaybackVisible(item.type !== 'video');
    isAwaitingInitialSeekRef.current = false;
    if (initialSeekFallbackRef.current !== null) {
      window.clearTimeout(initialSeekFallbackRef.current);
      initialSeekFallbackRef.current = null;
    }
  }, [item?.id]);

  useEffect(() => {
    if (!item || item.type !== 'video') {
      return;
    }

    return registerMediaAudioFocus(audioFocusIdRef.current, () => {
      setIsMuted(true);
    });
  }, [item]);

  useEffect(() => {
    return () => {
      releaseMediaAudioFocus(audioFocusIdRef.current);
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
      }
      if (initialSeekFallbackRef.current !== null) {
        window.clearTimeout(initialSeekFallbackRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!item || item.type !== 'video' || !videoRef.current) {
      return;
    }

    videoRef.current.muted = isMuted;
  }, [isMuted, item]);

  const handleToggleVolume = () => {
    setIsMuted((current) => {
      const nextMuted = !current;

      if (nextMuted) {
        releaseMediaAudioFocus(audioFocusIdRef.current);
      } else {
        claimMediaAudioFocus(audioFocusIdRef.current);
      }

      return nextMuted;
    });
  };

  const handleNavigate = (direction: 'previous' | 'next') => {
    if (!canNavigateMedia) {
      return;
    }

    onNavigate?.(direction);
  };

  const handleSwipeStart: TouchEventHandler<HTMLDivElement> = (event) => {
    if (!canNavigateMedia || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  };

  const handleSwipeEnd: TouchEventHandler<HTMLDivElement> = (event) => {
    if (!canNavigateMedia || !swipeStartRef.current || event.changedTouches.length === 0) {
      swipeStartRef.current = null;
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - swipeStartRef.current.x;
    const deltaY = touch.clientY - swipeStartRef.current.y;
    swipeStartRef.current = null;

    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return;
    }

    handleNavigate(deltaX < 0 ? 'next' : 'previous');
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

  const revealPlaybackOnRenderedFrame = () => {
    const video = videoRef.current;

    if (!video) {
      setIsPlaybackVisible(true);
      completeLoading();
      return;
    }

    const reveal = () => {
      window.requestAnimationFrame(() => {
        setIsPlaybackVisible(true);
        completeLoading();
      });
    };

    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => {
        reveal();
      });
      return;
    }

    reveal();
  };

  const attemptPlaybackStart = () => {
    const video = videoRef.current;

    if (!video || isAwaitingInitialSeekRef.current) {
      return;
    }

    const playPromise = video.play();
    if (playPromise) {
      playPromise.catch(() => {
        // Ignora bloqueios/interrupcoes de autoplay aqui.
      });
    }
  };

  const dialog = (
    <AnimatePresence>
      {item ? (
        <motion.div
          className="fixed inset-0 z-[80] overflow-hidden bg-black/80 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="flex min-h-full items-center justify-center overflow-hidden p-4 md:p-6">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={item.owner}
              className="relative w-full max-w-[min(92vw,540px)] overflow-hidden rounded-[30px] border border-white/10 bg-[#09090c]/95 shadow-2xl md:max-w-[min(78vw,720px)]"
              initial={{ opacity: 0, y: 36, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.985 }}
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

              <div className="relative overflow-hidden border-b border-white/10">
                <img
                  src={item.ownerCoverImage}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover object-center"
                  loading="eager"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,6,8,0.15),rgba(6,6,8,0.72),rgba(6,6,8,0.95))]" />
                <div className="relative flex items-end gap-3 px-5 pb-4 pt-14 sm:px-6 sm:pt-16">
                  <img
                    src={item.ownerProfileImage}
                    alt={item.owner}
                    className="h-14 w-14 shrink-0 rounded-full border border-white/15 object-cover object-center shadow-[0_18px_40px_rgba(0,0,0,0.3)] sm:h-16 sm:w-16"
                    loading="eager"
                  />
                  <div className="min-w-0">
                    <h2 className="max-w-3xl truncate pr-10 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                      {item.owner}
                    </h2>
                    <p className="mt-1 text-sm text-white/65 sm:text-[15px]">
                      {item.ownerHandle}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-3 sm:p-4">
                <div
                  className="relative touch-pan-y overflow-hidden rounded-[24px] border border-white/10 bg-black"
                  onTouchStart={handleSwipeStart}
                  onTouchEnd={handleSwipeEnd}
                >
                  {showLoading && item.type !== 'video' ? (
                    <div className="absolute inset-0 z-20 skeleton-shimmer bg-black/20">
                      <div className="absolute inset-x-6 bottom-6 flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.16em] text-white/35">
                        <span>AllPrivacy.site</span>
                        <span>Carregando</span>
                      </div>
                    </div>
                  ) : null}
                  {item.type === 'video' && item.src ? (
                    <>
                      {handoffPoster || item.thumbnail ? (
                        <img
                          src={handoffPoster || item.thumbnail}
                          alt=""
                          aria-hidden="true"
                          className={`absolute inset-0 z-10 h-full w-full object-contain transition-opacity duration-300 ${
                            isPlaybackVisible ? 'opacity-0' : 'opacity-100'
                          }`}
                          loading="eager"
                        />
                      ) : null}
                      <div
                        className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center transition-opacity duration-300 ${
                          isPlaybackVisible ? 'opacity-0' : 'opacity-100'
                        }`}
                        aria-hidden="true"
                      >
                        <div className="rounded-full bg-black/35 p-3 backdrop-blur-sm">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/85" />
                        </div>
                      </div>
                      <video
                        ref={videoRef}
                        src={item.src}
                        poster={handoffPoster || item.thumbnail}
                        className={`max-h-[74dvh] w-full object-contain transition-opacity duration-300 ${
                          isPlaybackVisible ? 'opacity-100' : 'opacity-0'
                        }`}
                        autoPlay
                        loop
                        muted={isMuted}
                        playsInline
                        preload="auto"
                        onLoadedData={() => {
                          if (!(handoffPoster || item.thumbnail)) {
                            revealPlaybackOnRenderedFrame();
                          }
                        }}
                        onCanPlay={() => {
                          attemptPlaybackStart();
                          if (!(handoffPoster || item.thumbnail)) {
                            revealPlaybackOnRenderedFrame();
                          }
                        }}
                        onPlaying={revealPlaybackOnRenderedFrame}
                        onLoadedMetadata={() => {
                          if (!item.src || !videoRef.current) {
                            return;
                          }

                          const rememberedTime =
                            Number.isFinite(initialPlaybackTime) && initialPlaybackTime > 0
                              ? initialPlaybackTime
                              : getRememberedMediaPlaybackTime(item.src);
                          if (!Number.isFinite(rememberedTime) || rememberedTime <= 0) {
                            attemptPlaybackStart();
                            return;
                          }

                          const safeDuration = Number.isFinite(videoRef.current.duration)
                            ? videoRef.current.duration
                            : rememberedTime;
                          const nextTime = Math.min(
                            Math.max(0, rememberedTime),
                            Math.max(0, safeDuration - 0.15),
                          );

                          try {
                            isAwaitingInitialSeekRef.current = true;
                            videoRef.current.currentTime = nextTime;
                            if (initialSeekFallbackRef.current !== null) {
                              window.clearTimeout(initialSeekFallbackRef.current);
                            }
                            initialSeekFallbackRef.current = window.setTimeout(() => {
                              if (!isAwaitingInitialSeekRef.current) {
                                return;
                              }

                              isAwaitingInitialSeekRef.current = false;
                              attemptPlaybackStart();
                            }, 180);
                          } catch {
                            isAwaitingInitialSeekRef.current = false;
                            attemptPlaybackStart();
                          }
                        }}
                        onSeeked={() => {
                          if (!isAwaitingInitialSeekRef.current) {
                            return;
                          }

                          if (initialSeekFallbackRef.current !== null) {
                            window.clearTimeout(initialSeekFallbackRef.current);
                            initialSeekFallbackRef.current = null;
                          }
                          isAwaitingInitialSeekRef.current = false;
                          attemptPlaybackStart();
                        }}
                        onTimeUpdate={() => {
                          if (item.src && videoRef.current) {
                            rememberMediaPlaybackTime(item.src, videoRef.current.currentTime);
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleToggleVolume}
                        className="absolute bottom-4 right-4 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/80 backdrop-blur-md transition hover:bg-black/65 hover:text-white"
                        aria-label={isMuted ? 'Ativar audio' : 'Desativar audio'}
                      >
                        {isMuted ? (
                          <VolumeOffIcon className="h-4 w-4" />
                        ) : (
                          <VolumeOnIcon className="h-4 w-4" />
                        )}
                      </button>
                    </>
                  ) : (
                    <img
                      src={item.src || item.thumbnail}
                      alt={item.owner}
                      className="max-h-[74dvh] w-full object-contain"
                      loading="eager"
                      onLoad={completeLoading}
                    />
                  )}
                  {canNavigateMedia ? (
                    <>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleNavigate('previous');
                        }}
                        className="absolute left-3 top-1/2 z-40 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/48 text-white/85 shadow-[0_18px_44px_rgba(0,0,0,0.42)] backdrop-blur-md transition hover:bg-black/75 hover:text-white sm:left-4 sm:h-12 sm:w-12"
                        aria-label="Midia anterior"
                      >
                        <ChevronLeftIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleNavigate('next');
                        }}
                        className="absolute right-3 top-1/2 z-40 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/48 text-white/85 shadow-[0_18px_44px_rgba(0,0,0,0.42)] backdrop-blur-md transition hover:bg-black/75 hover:text-white sm:right-4 sm:h-12 sm:w-12"
                        aria-label="Proxima midia"
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
