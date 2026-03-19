import { motion } from 'framer-motion';
import { scrollToTarget } from '../lib/scrollToTarget';
import type { ModelProfile } from '../types';
import { SectionHeader } from './SectionHeader';

interface ModelsStoriesProps {
  models: ModelProfile[];
  onSelect: (model: ModelProfile) => void;
  ctaTargetId?: string;
}

export function ModelsStories({
  models,
  onSelect,
  ctaTargetId = 'cta-final',
}: ModelsStoriesProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="pt-14"
    >
      <SectionHeader
        eyebrow="Modelos do Grupo"
        title="Perfis selecionados para abrir, explorar e seguir ate a entrada final."
        description="A faixa fica fixa na home, sem scroll lateral. As modelos aparecem em blocos limpos e o ultimo card leva direto para o CTA final."
      />

      {models.length === 0 ? (
        <div className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 text-sm text-zinc-300">
          Nenhuma modelo cadastrada ainda. Adicione modelos no painel admin para alimentar
          esta faixa.
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap justify-start gap-x-2 gap-y-4 sm:gap-x-3 sm:gap-y-5">
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

          <motion.button
            type="button"
            onClick={() => scrollToTarget(ctaTargetId)}
            whileTap={{ scale: 0.97 }}
            className="flex w-[72px] flex-col items-center text-center sm:w-[82px] md:w-[92px]"
          >
            <span className="mx-auto flex h-[64px] w-[64px] items-center justify-center rounded-full border border-dashed border-white/20 bg-white/[0.04] text-white/75 shadow-neon transition hover:bg-white/[0.06] sm:h-[74px] sm:w-[74px] md:h-[84px] md:w-[84px]">
              <span className="font-display text-2xl font-semibold sm:text-[1.7rem] md:text-[1.9rem]">
                +
              </span>
            </span>
            <span className="mt-2 block text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80 sm:mt-3 sm:text-xs sm:tracking-[0.18em]">
              Ver mais
            </span>
          </motion.button>
        </div>
      )}
    </motion.section>
  );
}
