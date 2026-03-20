interface BrandMarkProps {
  href?: string;
  className?: string;
}

export function BrandMark({ href, className = '' }: BrandMarkProps) {
  const content = (
    <span
      className={`inline-flex items-baseline font-display text-[1.26rem] font-semibold leading-none tracking-[0.16em] text-white/90 sm:text-[1.32rem] ${className}`}
    >
      <span>AllPrivacy</span>
      <span className="ml-[0.08rem] -translate-y-[0.08em] text-[0.7em] tracking-[0.08em] text-white/65">
        .site
      </span>
    </span>
  );

  if (href) {
    return (
      <a href={href} className="transition hover:text-white">
        {content}
      </a>
    );
  }

  return content;
}
