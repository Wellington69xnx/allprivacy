import type { Ref } from 'react';
import { CtaBonusNote } from './CtaBonusNote';
import { TelegramCTA } from './TelegramCTA';

const perks = [
  'Privacy',
  'OnlyFans',
  'XvideosRED',
  'CloseFans',
  'Cuckold',
  'TelegramVIP',
  'Anal',
  'Amador',
  'Em Público',
  'Novinha +18',
  'Vazados',
  'Corno/HotWife',
  'Câmera Escondida',
  'Gozada na Boca',
  'GangBang',
  'Agressivo',
];

interface FinalGroupCtaCardProps {
  ctaHref: string;
  buttonRef?: Ref<HTMLDivElement>;
}

export function FinalGroupCtaCard({ ctaHref, buttonRef }: FinalGroupCtaCardProps) {
  return (
    <div className="overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-white/[0.08] via-white/[0.04] to-transparent p-6 shadow-neon">
      <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        {'Entrar no grupo VIP'}
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
        {
          'Entre no nosso grupo VIP agora mesmo e tenha acesso imediato e completo a todo o conteúdo.'
        }
      </p>

      <div className="mt-5 flex flex-wrap gap-1.5 sm:gap-2">
        {perks.map((perk) => (
          <span
            key={perk}
            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-white/75 sm:px-3 sm:py-2 sm:text-xs"
          >
            {perk}
          </span>
        ))}
      </div>

      <div
        ref={buttonRef}
        className="mt-6 grid w-full gap-2 sm:mx-auto sm:inline-grid sm:w-auto"
      >
        <TelegramCTA
          href={ctaHref}
          label="Entrar no Grupo"
          className="w-full sm:min-w-[360px] sm:w-auto sm:text-[1.08rem]"
        />
        <CtaBonusNote
          className="text-[11px] font-medium tracking-[0.18em] text-white/45"
          logoClassName="-translate-y-[0.06em] h-[2.36em] w-auto object-contain brightness-110"
        />
      </div>
    </div>
  );
}
