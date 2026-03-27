interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function SectionHeader({ eyebrow, title, description }: SectionHeaderProps) {
  const shouldCenterEyebrow = eyebrow === 'AllPrivacy.site';
  const eyebrowBadge = (
    <span className="inline-flex rounded-full border border-white/10 bg-white/[0.012] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-white/[0.18]">
      {eyebrow}
    </span>
  );

  return (
    <div className={shouldCenterEyebrow ? 'w-full' : 'mx-auto max-w-xl text-center md:mx-0 md:text-left'}>
      <div className={shouldCenterEyebrow ? 'flex justify-center' : ''}>
        {eyebrowBadge}
      </div>
      <div className={shouldCenterEyebrow ? 'mx-auto mt-4 max-w-xl text-center md:mx-0 md:text-left' : ''}>
        <h2 className={shouldCenterEyebrow ? 'font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl' : 'mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl'}>
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-zinc-300 sm:mt-3 sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
