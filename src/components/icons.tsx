import type { SVGProps } from 'react';

export function TelegramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M21.8 4.2L18.7 19c-.2 1.1-.8 1.3-1.6.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.8-7.9c.4-.4-.1-.6-.6-.3L6.6 12.8 2 11.4c-1-.3-1-1 .2-1.4L20 3.2c.9-.3 1.7.2 1.8 1Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6 9.5 12 15.5 18 9.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.5 6 8.5 12l6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="m9.5 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7.5 10V8.5a4.5 4.5 0 1 1 9 0V10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <rect
        x="5"
        y="10"
        width="14"
        height="10"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 13.5v2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M8 6.5v11l9-5.5-9-5.5Z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8.2 6.8A1.2 1.2 0 0 1 9.4 5.6h.2a1.2 1.2 0 0 1 1.2 1.2v10.4a1.2 1.2 0 0 1-1.2 1.2h-.2a1.2 1.2 0 0 1-1.2-1.2V6.8Zm5 0a1.2 1.2 0 0 1 1.2-1.2h.2a1.2 1.2 0 0 1 1.2 1.2v10.4a1.2 1.2 0 0 1-1.2 1.2h-.2a1.2 1.2 0 0 1-1.2-1.2V6.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="m6 6 12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function VolumeOnIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M5 14.5v-5h3.3l4.2-3.4c.4-.3 1 .1 1 .6v10.6c0 .5-.6.9-1 .6l-4.2-3.4H5Z"
        fill="currentColor"
      />
      <path
        d="M16 9.2a4.7 4.7 0 0 1 0 5.6M18.4 7a8 8 0 0 1 0 10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VolumeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M5 14.5v-5h3.3l4.2-3.4c.4-.3 1 .1 1 .6v10.6c0 .5-.6.9-1 .6l-4.2-3.4H5Z"
        fill="currentColor"
      />
      <path
        d="m16.5 9.2 4.3 5.6M20.8 9.2l-4.3 5.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ExpandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 4.8H4.8V8M16 4.8h3.2V8M8 19.2H4.8V16M19.2 16v3.2H16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 9 4.8 4.8M15 9l4.2-4.2M9 15l-4.2 4.2M15 15l4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BookmarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 4.8h10a1.2 1.2 0 0 1 1.2 1.2v13.5c0 .7-.8 1.1-1.4.7L12 16.9l-4.8 3.3c-.6.4-1.4 0-1.4-.7V6A1.2 1.2 0 0 1 7 4.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 9.2h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function VerifiedBadgeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 2.8 14.3 4l2.6-.2 1.4 2.2 2.2 1.4-.2 2.6L21.2 12l-1.1 2.3.2 2.6-2.2 1.4-1.4 2.2-2.6-.2L12 21.2l-2.3-1.1-2.6.2-1.4-2.2-2.2-1.4.2-2.6L2.8 12 4 9.7l-.2-2.6L6 5.7l1.4-2.2 2.6.2L12 2.8Z"
        fill="currentColor"
      />
      <path
        d="m8.8 12.2 2.1 2.1 4.3-4.7"
        stroke="white"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HeartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 20.3 4.9 13.6a4.7 4.7 0 0 1-.4-6.7 4.7 4.7 0 0 1 6.6-.4l.9.8.9-.8a4.7 4.7 0 0 1 6.6.4 4.7 4.7 0 0 1-.4 6.7L12 20.3Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function StarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="m12 3.8 2.55 5.17 5.7.83-4.12 4.02.97 5.67L12 16.8 6.9 19.5l.98-5.67L3.75 9.8l5.7-.83L12 3.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function BellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 4.2a4.8 4.8 0 0 0-4.8 4.8v2.1c0 .8-.2 1.6-.6 2.2l-1.2 2a1 1 0 0 0 .86 1.5h11.6a1 1 0 0 0 .86-1.5l-1.2-2a4.2 4.2 0 0 1-.6-2.2V9A4.8 4.8 0 0 0 12 4.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9.8 18.2a2.5 2.5 0 0 0 4.4 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
