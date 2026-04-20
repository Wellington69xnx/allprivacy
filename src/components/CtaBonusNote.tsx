interface CtaBonusNoteProps {
  className?: string;
  logoClassName?: string;
}

export function CtaBonusNote({
  className = '',
  logoClassName = '-translate-y-[0.04em] h-[2.28em] w-auto object-contain brightness-110',
}: CtaBonusNoteProps) {
  return (
    <span
      className={`inline-flex items-center justify-center gap-[0.44em] whitespace-nowrap text-center uppercase ${className}`.trim()}
    >
      <span>5 Créditos Grátis</span>
      <img
        src="/uploads/_legacy-root/xv.png"
        alt="XVideosRED"
        className={logoClassName}
        loading="lazy"
      />
    </span>
  );
}
