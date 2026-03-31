import { motion } from 'framer-motion';
import { scrollToTarget } from '../lib/scrollToTarget';
import type { ModelProfile } from '../types';
import { SectionHeader } from './SectionHeader';

interface ModelsStoriesProps {
  models: ModelProfile[];
  onSelect: (model: ModelProfile) => void;
  ctaTargetId?: string;
}

interface GhostStoryCard {
  id: string;
  image: string;
  label: string;
  accentFrom: string;
  accentTo: string;
}

const ghostLabels = [
  'Amanda Lima',
  'Bianca Prado',
  'Camila Gomes',
  'Isa Valverde',
  'All Pacino',
  'Julia Paes',
  'Cuckold Howwife',
  'Julia Boqueteira',
  'Larissa Anal',
  'Manuela',
  'Marina',
  'Natalia',
  'Paola',
  'Rafaela Mamadora',
  'Sabrina Putinha',
  'Val Vagabunda',
];

function collectGhostImages(models: ModelProfile[]) {
  return models
    .flatMap((model) => [
      model.profileImage,
      model.coverImage,
      ...model.gallery
        .filter((item) => item.type === 'image')
        .map((item) => item.thumbnail || ''),
    ])
    .filter(Boolean)
    .filter((image, index, images) => images.indexOf(image) === index);
}

function buildGhostStoryCards(models: ModelProfile[]) {
  const imagePool = collectGhostImages(models);

  if (imagePool.length === 0 || models.length === 0) {
    return [] as GhostStoryCard[];
  }

  const ghostCount = Math.max(8, Math.min(16, models.length * 2));

  return Array.from({ length: ghostCount }, (_, index) => {
    const image = imagePool[index % imagePool.length];
    const accentSource = models[index % models.length];

    return {
      id: `ghost-story-${index}-${image}`,
      image,
      label: ghostLabels[index % ghostLabels.length],
      accentFrom: accentSource.accentFrom,
      accentTo: accentSource.accentTo,
    };
  });
}

export function ModelsStories({
  models,
  onSelect,
  ctaTargetId = 'cta-final',
}: ModelsStoriesProps) {
  const ghostCards = buildGhostStoryCards(models);

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="pt-14 sm:pt-16"
    >
      <SectionHeader
        eyebrow="AllPrivacy.site"
        title={'TOP Conteúdos'}
        description=""
      />

      {models.length === 0 ? (
        <div className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 text-sm text-zinc-300">
          Nenhuma modelo cadastrada ainda.
        </div>
      ) : (
        <div className="relative mt-6">
          <div
            className={`flex flex-wrap justify-start gap-x-2 gap-y-4 sm:gap-x-3 sm:gap-y-5 ${
              ghostCards.length > 0
                ? 'max-h-[412px] overflow-hidden sm:max-h-[436px] md:max-h-[456px]'
                : ''
            }`}
          >
            {models.map((model, index) => (
              <motion.button
                key={model.id}
                type="button"
                onClick={() => onSelect(model)}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.35, delay: index * 0.05 }}
                whileTap={{ scale: 0.96 }}
                className="flex w-[72px] flex-col items-center text-center sm:w-[82px] md:w-[92px]"
              >
                <span
                  className="mx-auto flex h-[64px] w-[64px] items-center justify-center rounded-full p-[3px] shadow-glow sm:h-[74px] sm:w-[74px] md:h-[84px] md:w-[84px]"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${model.accentFrom}, ${model.accentTo})`,
                  }}
                >
                  <span className="block h-full w-full overflow-hidden rounded-full border border-black/25 bg-black">
                    <img
                      src={model.profileImage}
                      alt={model.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </span>
                </span>
                <span className="mt-2 block truncate text-center text-[11px] font-semibold text-white sm:mt-3 sm:text-xs">
                  {model.name}
                </span>
              </motion.button>
            ))}

            {ghostCards.map((card, index) => (
              <motion.button
                key={card.id}
                type="button"
                onClick={() => scrollToTarget(ctaTargetId)}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.35, delay: Math.min(0.45, index * 0.02) }}
                whileTap={{ scale: 0.96 }}
                className={`relative flex w-[72px] flex-col items-center text-center opacity-75 blur-[1.8px] saturate-75 sm:w-[82px] md:w-[92px] ${
                  index >= Math.max(0, ghostCards.length - 4)
                    ? 'opacity-45'
                    : index >= Math.max(0, ghostCards.length - 8)
                      ? 'opacity-60'
                      : ''
                }`}
              >
                <span
                  className={`pointer-events-none absolute inset-x-1 bottom-0 h-12 rounded-[18px] blur-md ${
                    index >= Math.max(0, ghostCards.length - 4)
                      ? 'bg-gradient-to-b from-transparent via-black/40 to-black/85'
                      : index >= Math.max(0, ghostCards.length - 8)
                        ? 'bg-gradient-to-b from-transparent via-black/28 to-black/65'
                        : 'bg-gradient-to-b from-transparent via-black/16 to-black/42'
                  }`}
                />
                <span
                  className="mx-auto flex h-[64px] w-[64px] items-center justify-center rounded-full p-[3px] opacity-80 blur-[0.6px] sm:h-[74px] sm:w-[74px] md:h-[84px] md:w-[84px]"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${card.accentFrom}, ${card.accentTo})`,
                  }}
                >
                  <span className="relative block h-full w-full overflow-hidden rounded-full border border-white/10 bg-black/50 md:bg-black/28">
                    <img
                      src={card.image}
                      alt={card.label}
                      className="h-full w-full scale-125 object-cover blur-[10px] saturate-150"
                      loading="lazy"
                    />
                    <span
                      className={`absolute inset-0 ${
                        index >= Math.max(0, ghostCards.length - 4)
                          ? 'bg-black/58 md:bg-black/42'
                          : index >= Math.max(0, ghostCards.length - 8)
                            ? 'bg-black/42 md:bg-black/28'
                            : 'bg-black/24 md:bg-black/14'
                      }`}
                    />
                  </span>
                </span>
                <span className="mt-2 block truncate text-center text-[11px] font-semibold text-white/35 blur-[0.8px] sm:mt-3 sm:text-xs md:text-white/45">
                  {card.label}
                </span>
              </motion.button>
            ))}
          </div>

          {ghostCards.length > 0 ? (
            <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center pb-4 sm:pb-2">
              <motion.button
                type="button"
                onClick={() => scrollToTarget(ctaTargetId)}
                whileTap={{ scale: 0.97 }}
                className="min-h-11 rounded-full border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white shadow-[0_14px_36px_rgba(0,0,0,0.45)] backdrop-blur-md transition hover:bg-white/[0.1]"
              >
                {'Ver mais \u2193'}
              </motion.button>
            </div>
          ) : null}
        </div>
      )}
    </motion.section>
  );
}
