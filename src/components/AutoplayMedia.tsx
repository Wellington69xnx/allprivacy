import { useEffect, useRef, useState } from 'react';
import {
  claimMediaAudioFocus,
  registerMediaAudioFocus,
  releaseMediaAudioFocus,
} from '../lib/mediaAudioFocus';
import { rememberMediaPlaybackTime } from '../lib/mediaPlaybackMemory';
import { hasWarmVideo, primeWarmVideo, rememberWarmVideo } from '../lib/mediaWarmCache';
import type { MediaType } from '../types';
import { VolumeOffIcon, VolumeOnIcon } from './icons';

interface AutoplayMediaProps {
  type: MediaType;
  src?: string;
  poster?: string;
  alt: string;
  className?: string;
  playMode?: 'viewport' | 'hover';
  preloadStrategy?: 'none' | 'metadata' | 'auto';
  fitMode?: 'cover' | 'contain';
  showVolumeToggle?: boolean;
  showLoadingSkeleton?: boolean;
  forceActivateVideo?: boolean;
}

export function AutoplayMedia({
  type,
  src,
  poster,
  alt,
  className = '',
  playMode = 'viewport',
  preloadStrategy,
  fitMode = 'cover',
  showVolumeToggle = false,
  showLoadingSkeleton = false,
  forceActivateVideo = false,
}: AutoplayMediaProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioFocusIdRef = useRef(`media-audio-${Math.random().toString(36).slice(2)}`);
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isReady, setIsReady] = useState(type !== 'video');
  const [isMuted, setIsMuted] = useState(true);
  const [hasActivatedVideo, setHasActivatedVideo] = useState(type !== 'video');
  const [prefersDesktopHoverPlayback, setPrefersDesktopHoverPlayback] = useState(false);
  const [isPlaybackVisible, setIsPlaybackVisible] = useState(type !== 'video');

  const revealPlaybackOnRenderedFrame = () => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    const reveal = () => {
      window.requestAnimationFrame(() => {
        setIsPlaybackVisible(true);
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

  const isWarmVideo = type === 'video' && Boolean(src) && hasWarmVideo(src);
  const shouldRenderVideo =
    type === 'video' && Boolean(src) && (hasActivatedVideo || isWarmVideo || forceActivateVideo);
  const resolvedPreload =
    shouldRenderVideo
      ? forceActivateVideo
        ? 'auto'
        : preloadStrategy ?? (isWarmVideo ? 'auto' : 'metadata')
      : 'none';
  const effectivePlayMode =
    type === 'video' && prefersDesktopHoverPlayback && playMode === 'viewport' ? 'hover' : playMode;
  const hasDedicatedPoster = Boolean(poster && poster !== src);
  const isContained = fitMode === 'contain';
  const mediaFillClassName = isContained
    ? 'absolute inset-0 block h-full w-full object-contain object-center'
    : 'absolute left-1/2 top-1/2 block h-full w-full min-h-full min-w-full -translate-x-1/2 -translate-y-1/2 object-cover object-center';

  useEffect(() => {
    setIsReady(type !== 'video');
    setHasActivatedVideo(type !== 'video');
    setIsPlaybackVisible(type !== 'video');
  }, [poster, src, type]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    const syncPreference = () => {
      setPrefersDesktopHoverPlayback(mediaQuery.matches);
    };

    syncPreference();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncPreference);
      return () => {
        mediaQuery.removeEventListener('change', syncPreference);
      };
    }

    mediaQuery.addListener(syncPreference);
    return () => {
      mediaQuery.removeListener(syncPreference);
    };
  }, []);

  useEffect(() => {
    if (type !== 'video' || !src || hasActivatedVideo || !wrapperRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting || entry.intersectionRatio > 0) {
          setHasActivatedVideo(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '320px 220px',
        threshold: 0.01,
      },
    );

    observer.observe(wrapperRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasActivatedVideo, src, type]);

  useEffect(() => {
    if (effectivePlayMode !== 'viewport' || type !== 'video' || !src || !wrapperRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting && entry.intersectionRatio >= 0.45);
      },
      {
        threshold: [0.2, 0.45, 0.75],
      },
    );

    observer.observe(wrapperRef.current);

    return () => {
      observer.disconnect();
    };
  }, [effectivePlayMode, src, type]);

  useEffect(() => {
    if (type !== 'video') {
      return;
    }

    if (forceActivateVideo || isWarmVideo || isHovered || isPinned || isVisible) {
      setHasActivatedVideo(true);
    }
  }, [forceActivateVideo, isHovered, isPinned, isVisible, isWarmVideo, src, type]);

  useEffect(() => {
    if (type !== 'video' || !src || !videoRef.current || !shouldRenderVideo) {
      return;
    }

    if (isWarmVideo) {
      primeWarmVideo(src);
    }

    if (resolvedPreload !== 'none') {
      videoRef.current.load();
    }
  }, [isWarmVideo, resolvedPreload, shouldRenderVideo, src, type]);

  useEffect(() => {
    if (type !== 'video' || !src || !videoRef.current || !shouldRenderVideo) {
      return;
    }

    const shouldPlay =
      effectivePlayMode === 'hover'
        ? isHovered || (playMode === 'hover' && isPinned)
        : isVisible;

    if (shouldPlay && isReady) {
      const playPromise = videoRef.current.play();
      if (playPromise) {
        playPromise.catch(() => {
          setIsPlaybackVisible(false);
        });
      }
      return;
    }

    videoRef.current.pause();
  }, [
    effectivePlayMode,
    isHovered,
    isPinned,
    isReady,
    isVisible,
    playMode,
    shouldRenderVideo,
    src,
    type,
  ]);

  useEffect(() => {
    if (type !== 'video' || !videoRef.current || !shouldRenderVideo) {
      return;
    }

    videoRef.current.muted = isMuted;
  }, [isMuted, shouldRenderVideo, type]);

  useEffect(() => {
    if (effectivePlayMode === 'hover') {
      setIsVisible(false);
    }
  }, [effectivePlayMode]);

  useEffect(() => {
    if (type !== 'video') {
      return;
    }

    return registerMediaAudioFocus(audioFocusIdRef.current, () => {
      setIsMuted(true);
    });
  }, [type]);

  const supportsHoverPlayback = effectivePlayMode === 'hover' && type === 'video' && Boolean(src);
  const allowsPinnedPlayback = playMode === 'hover' && type === 'video' && Boolean(src);
  const shouldShowVolumeToggle = showVolumeToggle && shouldRenderVideo;
  const shouldRevealVideo = !hasDedicatedPoster || isPlaybackVisible;
  return (
    <div
      ref={wrapperRef}
      className={`relative h-full w-full overflow-hidden rounded-[inherit] bg-black ${className}`}
      onClickCapture={() => {
        if (type === 'video' && src && videoRef.current) {
          rememberMediaPlaybackTime(src, videoRef.current.currentTime);
        }
      }}
      onMouseEnter={supportsHoverPlayback ? () => setIsHovered(true) : undefined}
      onMouseLeave={supportsHoverPlayback ? () => setIsHovered(false) : undefined}
      onFocus={allowsPinnedPlayback ? () => setIsHovered(true) : undefined}
      onBlur={allowsPinnedPlayback ? () => setIsHovered(false) : undefined}
      onClick={allowsPinnedPlayback ? () => setIsPinned((current) => !current) : undefined}
      onKeyDown={
        allowsPinnedPlayback
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setIsPinned((current) => !current);
              }
            }
          : undefined
      }
      tabIndex={allowsPinnedPlayback ? 0 : undefined}
      role={allowsPinnedPlayback ? 'button' : undefined}
      aria-label={allowsPinnedPlayback ? `Reproduzir previa de ${alt}` : undefined}
    >
      {showLoadingSkeleton && shouldRenderVideo && !isReady ? (
        <div className="pointer-events-none absolute inset-0 z-[1] skeleton-shimmer">
          <div className="absolute inset-x-4 bottom-4 space-y-2">
            <div className="h-3 w-2/3 rounded-full bg-white/10" />
            <div className="h-3 w-1/2 rounded-full bg-white/10" />
          </div>
        </div>
      ) : null}

      {type === 'video' && src ? (
        <>
          {isContained ? (
            hasDedicatedPoster ? (
              <img
                src={poster}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full scale-110 object-cover object-center opacity-35 blur-2xl"
                loading={resolvedPreload === 'auto' ? 'eager' : 'lazy'}
              />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(244,63,94,0.18),transparent_35%),linear-gradient(180deg,rgba(10,10,12,0.96),rgba(4,4,6,1))]" />
            )
          ) : null}

          {hasDedicatedPoster ? (
            <img
              src={poster}
              alt=""
              aria-hidden="true"
              className={`${mediaFillClassName} ${
                shouldRevealVideo ? 'opacity-0' : 'opacity-100'
              }`}
              loading={resolvedPreload === 'auto' ? 'eager' : 'lazy'}
            />
          ) : null}

          {shouldRenderVideo ? (
            <video
              ref={videoRef}
              src={src}
              poster={hasDedicatedPoster ? poster : undefined}
              className={`${mediaFillClassName} ${
                shouldRevealVideo ? 'opacity-100' : 'opacity-0'
              }`}
              muted={isMuted}
              loop
              playsInline
              preload={resolvedPreload}
              onPlay={() => rememberWarmVideo(src)}
              onLoadedData={() => setIsReady(true)}
              onCanPlay={() => setIsReady(true)}
              onPlaying={revealPlaybackOnRenderedFrame}
              onTimeUpdate={() => {
                if (src && videoRef.current) {
                  rememberMediaPlaybackTime(src, videoRef.current.currentTime);
                }
              }}
            />
          ) : null}

          {!hasDedicatedPoster && (shouldRenderVideo ? !isReady : true) ? (
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(9,9,11,1),rgba(18,18,22,1),rgba(88,28,135,0.16))]" />
          ) : null}

          {shouldShowVolumeToggle ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsMuted((current) => {
                  const nextMuted = !current;

                  if (nextMuted) {
                    releaseMediaAudioFocus(audioFocusIdRef.current);
                  } else {
                    claimMediaAudioFocus(audioFocusIdRef.current);
                  }

                  return nextMuted;
                });
              }}
              className="absolute bottom-3 right-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/80 backdrop-blur-md transition hover:bg-black/65 hover:text-white"
              aria-label={isMuted ? `Ativar audio de ${alt}` : `Desativar audio de ${alt}`}
            >
              {isMuted ? (
                <VolumeOffIcon className="h-4 w-4" />
              ) : (
                <VolumeOnIcon className="h-4 w-4" />
              )}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <img
            src={poster}
            alt={alt}
            className={mediaFillClassName}
            loading={resolvedPreload === 'auto' ? 'eager' : 'lazy'}
            onLoad={() => setIsReady(true)}
          />
        </>
      )}
    </div>
  );
}
