import { useEffect, useRef, useState } from 'react';
import type { MediaType } from '../types';

interface AutoplayMediaProps {
  type: MediaType;
  src?: string;
  poster: string;
  alt: string;
  className?: string;
}

export function AutoplayMedia({
  type,
  src,
  poster,
  alt,
  className = '',
}: AutoplayMediaProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (type !== 'video' || !src || !wrapperRef.current) {
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
  }, [src, type]);

  useEffect(() => {
    if (type !== 'video' || !src || !videoRef.current) {
      return;
    }

    if (isVisible) {
      const playPromise = videoRef.current.play();
      if (playPromise) {
        playPromise.catch(() => {});
      }
      return;
    }

    videoRef.current.pause();
  }, [isVisible, src, type]);

  return (
    <div ref={wrapperRef} className={className}>
      {type === 'video' && src ? (
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          className="h-full w-full object-cover"
          muted
          loop
          playsInline
          preload="none"
        />
      ) : (
        <img src={poster} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      )}
    </div>
  );
}
