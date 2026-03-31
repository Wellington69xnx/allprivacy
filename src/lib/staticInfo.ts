export type StaticInfoKey = 'about' | 'support';

export interface StaticInfoSection {
  title: string;
  body: string;
}

export interface StaticInfoContent {
  contentType?: StaticInfoKey;
  title: string;
  description: string;
  sections: StaticInfoSection[];
  ctaLabel?: string;
  ctaHref?: string;
}

export const STATIC_INFO_CONTENT: Record<StaticInfoKey, StaticInfoContent> = {
  about: {
    contentType: 'about',
    title: 'Sobre',
    description: 'O AllPrivacy.site re\u00fane tudo em um s\u00f3 lugar.',
    sections: [
      {
        title: '100% Atualizado',
        body: 'Nosso grupo \u00e9 atualizado diariamente com conte\u00fados exclusivos.',
      },
      {
        title: 'Bot integrado',
        body: 'O bot cuida de todo o acesso ao grupo, desde o pagamento at\u00e9 o gerenciamento.',
      },
      {
        title: 'Tudo em um s\u00f3 lugar',
        body: 'S\u00e3o v\u00e1rios conte\u00fados exclusivos reunidos em um s\u00f3 lugar. Todo o conte\u00fado \u00e9 separado por t\u00f3picos para melhor organiza\u00e7\u00e3o.',
      },
    ],
  },
  support: {
    contentType: 'support',
    title: 'Suporte',
    description:
      'Se voc\u00ea tiver qualquer problema com pagamento, acesso ou libera\u00e7\u00e3o do grupo, entre em contato com o suporte.',
    ctaLabel: 'Falar com Suporte',
    ctaHref: 'https://t.me/suporte_allprivacy',
    sections: [
      {
        title: 'Pagamento',
        body: 'Escolha seu plano, pague o pix e tenha acesso imediato. O pagamento \u00e9 detectado automaticamente e o acesso liberado instantaneamente. \nCada Pix gerado tem validade de 10 minutos.',
      },
      {
        title: 'Meu Acesso',
        body: 'Gerencie seu acesso pelo bot. Voc\u00ea pode acompanhar e gerenciar a validade do seu acesso pelo menu "Meu Acesso" no bot AllPrivacy.',
      },
      {
        title: 'Acesso ao Grupo',
        body: 'Voc\u00ea ter\u00e1 acesso liberado ao grupo at\u00e9 o prazo do plano escolhido. Antes da data de expira\u00e7\u00e3o, o bot ir\u00e1 avisar antecipadamente que seu acesso ao grupo est\u00e1 chegando ao fim.',
      },
    ],
  },
};
