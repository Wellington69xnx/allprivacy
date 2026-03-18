import { motion } from 'framer-motion';
import { groupProofItems } from '../data/models';
import { SectionHeader } from './SectionHeader';

export function TelegramProof() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="pt-14"
    >
      <SectionHeader
        eyebrow="Grupo por Dentro"
        title="Faixa horizontal para prints reais do grupo."
        description="Os prints ficam em formato vertical, como capturas do proprio aparelho, mas ainda deslizando na horizontal."
      />

      <div className="hide-scrollbar mt-6 overflow-x-auto pb-2">
        <div className="flex w-max gap-4 px-1">
          {groupProofItems.map((item, index) => (
            <motion.article
              key={item.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.45, delay: index * 0.08 }}
              className="w-[56vw] max-w-[280px] shrink-0 overflow-hidden rounded-[26px] md:w-[280px] lg:w-[320px]"
            >
              <div className="aspect-[9/16]">
                <img
                  src={item.image}
                  alt={item.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
