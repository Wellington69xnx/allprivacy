import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
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
import type { PreviewCard } from '../types';
import { CloseIcon, VolumeOffIcon, VolumeOnIcon } from './icons';

interface MediaPreviewDialogProps {
  item: PreviewCard | null;
  onClose: () => void;
}

export function MediaPreviewDialog({ item, onClose }: MediaPreviewDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioFocusIdRef = useRef(`media-dialog-audio-${Math.random().toString(36).slice(2)}`);
  const loadingStartedAtRef = useRef(0);
  const loadingTimeoutRef = useRef<number | null>(null);
  const initialSeekFallbackRef = useRef<number | null>(null);
  const isAwaitingInitialSeekRef = useRef(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [isPlaybackVisible, setIsPlaybackVisible] = useState(false);

  useEffect(() => {
    if (!item) {
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
  }, [item, onClose]);

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
                <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-black">
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
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
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
                        poster={item.thumbnail}
                        className={`max-h-[74dvh] w-full object-contain transition-opacity duration-300 ${
                          isPlaybackVisible ? 'opacity-100' : 'opacity-0'
                        }`}
                        autoPlay
                        loop
                        muted={isMuted}
                        playsInline
                        preload="auto"
                        onLoadedData={() => {
                          if (!item.thumbnail) {
                            revealPlaybackOnRenderedFrame();
                          }
                        }}
                        onCanPlay={() => {
                          attemptPlaybackStart();
                          if (!item.thumbnail) {
                            revealPlaybackOnRenderedFrame();
                          }
                        }}
                        onPlaying={revealPlaybackOnRenderedFrame}
                        onLoadedMetadata={() => {
                          if (!item.src || !videoRef.current) {
                            return;
                          }

                          const rememberedTime = getRememberedMediaPlaybackTime(item.src);
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
