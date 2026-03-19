import { useEffect, useRef, useState } from 'react';
import type { MediaType } from '../types';

interface AutoplayMediaProps {
  type: MediaType;
  src?: string;
  poster?: string;
  alt: string;
  className?: string;
  playMode?: 'viewport' | 'hover';
  preloadStrategy?: 'none' | 'metadata' | 'auto';
  fitMode?: 'cover' | 'contain';
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
}: AutoplayMediaProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isReady, setIsReady] = useState(type !== 'video');

  const resolvedPreload =
    preloadStrategy ?? (playMode === 'hover' ? 'metadata' : 'metadata');
  const hasDedicatedPoster = Boolean(poster && poster !== src);
  const isContained = fitMode === 'contain';
  const mediaFillClassName = isContained
    ? 'absolute inset-0 block h-full w-full object-contain object-center'
    : 'absolute left-1/2 top-1/2 block h-full w-full min-h-full min-w-full -translate-x-1/2 -translate-y-1/2 object-cover object-center';

  useEffect(() => {
    setIsReady(type !== 'video');
  }, [poster, src, type]);

  useEffect(() => {
    if (playMode !== 'viewport' || type !== 'video' || !src || !wrapperRef.current) {
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
  }, [playMode, src, type]);

  useEffect(() => {
    if (type !== 'video' || !src || !videoRef.current) {
      return;
    }

    if (resolvedPreload !== 'none') {
      videoRef.current.load();
    }
  }, [resolvedPreload, src, type]);

  useEffect(() => {
    if (type !== 'video' || !src || !videoRef.current) {
      return;
    }

    const shouldPlay = playMode === 'hover' ? isHovered || isPinned : isVisible;

    if (shouldPlay && isReady) {
      const playPromise = videoRef.current.play();
      if (playPromise) {
        playPromise.catch(() => {});
      }
      return;
    }

    videoRef.current.pause();
  }, [isHovered, isPinned, isReady, isVisible, playMode, src, type]);

  useEffect(() => {
    if (playMode === 'hover') {
      setIsVisible(false);
    }
  }, [playMode]);

  const isInteractive = playMode === 'hover' && type === 'video' && Boolean(src);

  return (
    <div
      ref={wrapperRef}
      className={`relative h-full w-full overflow-hidden rounded-[inherit] bg-black ${className}`}
      onMouseEnter={isInteractive ? () => setIsHovered(true) : undefined}
      onMouseLeave={isInteractive ? () => setIsHovered(false) : undefined}
      onFocus={isInteractive ? () => setIsHovered(true) : undefined}
      onBlur={isInteractive ? () => setIsHovered(false) : undefined}
      onClick={isInteractive ? () => setIsPinned((current) => !current) : undefined}
      onKeyDown={
        isInteractive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setIsPinned((current) => !current);
              }
            }
          : undefined
      }
      tabIndex={isInteractive ? 0 : undefined}
      role={isInteractive ? 'button' : undefined}
      aria-label={isInteractive ? `Reproduzir previa de ${alt}` : undefined}
    >
      {type === 'video' && src ? (
        <>
          {isContained ? (
            hasDedicatedPoster ? (
              <img
                src={poster}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full scale-110 object-cover object-center opacity-35 blur-2xl"
                loading="lazy"
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
              className={`${mediaFillClassName} transition-opacity duration-300 ${
                isReady ? 'opacity-0' : 'opacity-100'
              }`}
              loading={resolvedPreload === 'auto' ? 'eager' : 'lazy'}
            />
          ) : null}

          <video
            ref={videoRef}
            src={src}
            poster={hasDedicatedPoster ? poster : undefined}
            className={`${mediaFillClassName} transition-opacity duration-300 ${
              isReady || !hasDedicatedPoster ? 'opacity-100' : 'opacity-0'
            }`}
            muted
            loop
            playsInline
            preload={resolvedPreload}
            onLoadedData={() => setIsReady(true)}
            onCanPlay={() => setIsReady(true)}
          />

          {!hasDedicatedPoster && !isReady ? (
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(9,9,11,1),rgba(18,18,22,1),rgba(88,28,135,0.16))]" />
          ) : null}
        </>
      ) : (
        <img
          src={poster}
          alt={alt}
          className={mediaFillClassName}
          loading={resolvedPreload === 'auto' ? 'eager' : 'lazy'}
          onLoad={() => setIsReady(true)}
        />
      )}
    </div>
  );
}
