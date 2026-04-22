const syncPayDefaultBaseUrl = 'https://api.syncpay.pro';

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  return toText(value).replace(/\/+$/, '') || syncPayDefaultBaseUrl;
}

function normalizePhoneDigits(value) {
  let digits = toText(value).replace(/\D+/g, '');

  if (digits.length >= 12 && digits.startsWith('55')) {
    digits = digits.slice(2);
  }

  if (digits.length > 11) {
    digits = digits.slice(-11);
  }

  return digits;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => {
      if (entryValue === null || entryValue === undefined) {
        return false;
      }

      if (typeof entryValue === 'string') {
        return entryValue.trim().length > 0;
      }

      if (typeof entryValue === 'object') {
        return Object.keys(entryValue).length > 0;
      }

      return true;
    }),
  );
}

function isLikelyBase64(value) {
  const normalized = toText(value);

  if (!normalized || normalized.length % 4 !== 0) {
    return false;
  }

  return /^[A-Za-z0-9+/=]+$/.test(normalized);
}

function getBasicAuthorizationValue(apiKey, apiKeyBase64) {
  const normalizedBase64 = toText(apiKeyBase64);

  if (normalizedBase64) {
    return `Basic ${normalizedBase64}`;
  }

  const normalizedApiKey = toText(apiKey);

  if (!normalizedApiKey) {
    return '';
  }

  if (isLikelyBase64(normalizedApiKey)) {
    return `Basic ${normalizedApiKey}`;
  }

  return `Basic ${Buffer.from(normalizedApiKey, 'utf8').toString('base64')}`;
}

function getSyncPayErrorMessage(data, response) {
  return (
    toText(data?.error) ||
    toText(data?.message) ||
    toText(data?.details) ||
    `Syncpay retornou HTTP ${response.status}.`
  );
}

function formatFetchError(error, baseUrl) {
  const errorCode =
    toText(error?.cause?.code) ||
    toText(error?.code) ||
    (Array.isArray(error?.cause?.errors)
      ? error.cause.errors.map((item) => toText(item?.code)).filter(Boolean)[0]
      : '');

  if (errorCode === 'ENOTFOUND') {
    return `Nao foi possivel resolver o dominio da Syncpay em ${baseUrl}. Ajuste SYNC_PAY_BASE_URL para o host correto liberado pela Syncpay.`;
  }

  if (['ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH'].includes(errorCode)) {
    return `Nao foi possivel conectar na Syncpay em ${baseUrl}. Verifique IP liberado, firewall e host configurado em SYNC_PAY_BASE_URL.`;
  }

  return error instanceof Error ? error.message : 'Falha de rede ao chamar a Syncpay.';
}

async function syncPayRequest({
  baseUrl,
  pathName,
  payload,
  method = 'POST',
  authorization,
}) {
  const requestUrl = `${normalizeBaseUrl(baseUrl)}${pathName}`;

  try {
    const response = await fetch(requestUrl, {
      method,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(getSyncPayErrorMessage(data, response));
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.message && !error.message.includes('Syncpay retornou')) {
      throw new Error(formatFetchError(error, normalizeBaseUrl(baseUrl)));
    }

    throw error;
  }
}

function firstTextCandidate(candidates) {
  return candidates.map((candidate) => toText(candidate)).find(Boolean) || '';
}

function isPixCopyPastePayload(value) {
  const normalized = toText(value);
  return normalized.startsWith('000201') && normalized.toLowerCase().includes('br.gov.bcb.pix');
}

function firstPixCopyPasteCandidate(candidates) {
  const textCandidates = candidates.map((candidate) => toText(candidate)).filter(Boolean);
  return textCandidates.find(isPixCopyPastePayload) || '';
}

function normalizeSyncPayPaymentResponse(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const charge = data?.payment?.charges?.[0] || data?.charges?.[0] || {};
  const pix = data?.pix && typeof data.pix === 'object' ? data.pix : {};
  const amountValue = Number(data?.amount ?? data?.valor ?? data?.valor_bruto ?? 0);

  return {
    transactionId: toText(
      data?.identifier ??
        data?.reference_id ??
        data?.idTransaction ??
        data?.idtransaction ??
        data?.id_transaction ??
        data?.id,
    ),
    paymentCode: firstPixCopyPasteCandidate([
      data?.pix_code,
      data?.paymentCode,
      data?.paymentcode,
      data?.pixCopiaECola,
      data?.pixCopyPaste,
      data?.copyPaste,
      data?.copy_paste,
      data?.brCode,
      data?.brcode,
      data?.emv,
      data?.qrCode,
      data?.qrcode,
      data?.qr_code,
      pix?.copyPaste,
      pix?.copy_paste,
      pix?.code,
      pix?.payload,
      pix?.qrCode,
      pix?.qrcode,
      charge?.pixPayload,
      charge?.pix_payload,
    ]),
    paymentCodeBase64: firstTextCandidate([
      data?.paymentCodeBase64,
      data?.qrcodeBase64,
      data?.qrCodeBase64,
      data?.qr_code_base64,
      pix?.qrcodeBase64,
      pix?.qrCodeBase64,
      charge?.pixQrCode,
      charge?.pix_qr_code,
    ]),
    paymentLink: toText(data?.paymentLink ?? data?.link),
    dueAt: toText(data?.dateDue ?? data?.date_due ?? data?.dueDate ?? data?.data_registro),
    status:
      toText(data?.status_transaction ?? data?.status ?? data?.situacao ?? data?.state) ||
      'pending',
    amount: Number.isFinite(amountValue) ? amountValue : 0,
    raw: payload,
  };
}

function normalizeCompanyProfile(payload) {
  const company =
    payload?.dados_seller?.empresa && typeof payload.dados_seller.empresa === 'object'
      ? payload.dados_seller.empresa
      : payload?.data && typeof payload.data === 'object'
        ? payload.data
        : {};

  return {
    name: toText(company?.nome ?? company?.name),
    email: toText(company?.email),
    cpf: toText(company?.cpf_cnpj ?? company?.cpf ?? company?.document),
    phone: toText(company?.telefone ?? company?.phone),
    raw: payload,
  };
}

export function isSyncPayPaidStatus(status) {
  const normalizedStatus = toText(status).toUpperCase();
  return ['PAID_OUT', 'PAID', 'APPROVED', 'COMPLETED', 'PAID_IN', 'COMPLETE'].includes(
    normalizedStatus,
  );
}

export function createSyncPayClient({
  apiKey,
  apiKeyBase64,
  clientId,
  clientSecret,
  baseUrl = syncPayDefaultBaseUrl,
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const basicAuthorization = getBasicAuthorizationValue(apiKey, apiKeyBase64);
  const normalizedClientId = toText(clientId);
  const normalizedClientSecret = toText(clientSecret);
  const usesPartnerApi = Boolean(normalizedClientId && normalizedClientSecret);
  let bearerToken = '';
  let bearerExpiresAt = 0;
  let pendingTokenPromise = null;

  async function getAuthorizationHeader() {
    if (normalizedClientId && normalizedClientSecret) {
      const now = Date.now();

      if (bearerToken && bearerExpiresAt > now + 10_000) {
        return `Bearer ${bearerToken}`;
      }

      if (!pendingTokenPromise) {
        pendingTokenPromise = syncPayRequest({
          baseUrl: normalizedBaseUrl,
          pathName: '/api/partner/v1/auth-token',
          payload: {
            client_id: normalizedClientId,
            client_secret: normalizedClientSecret,
          },
          method: 'POST',
          authorization: '',
        })
          .then((data) => {
            bearerToken = toText(data?.access_token);

            const expiresInSeconds = Number(data?.expires_in || 3600);
            bearerExpiresAt = Date.now() + Math.max(60, expiresInSeconds) * 1000;

            if (!bearerToken) {
              throw new Error('Syncpay nao retornou access_token no auth-token.');
            }

            return `Bearer ${bearerToken}`;
          })
          .finally(() => {
            pendingTokenPromise = null;
          });
      }

      return pendingTokenPromise;
    }

    if (basicAuthorization) {
      return basicAuthorization;
    }

    throw new Error(
      'Syncpay nao configurada. Defina SYNC_PAY_CLIENT_ID + SYNC_PAY_CLIENT_SECRET ou SYNC_PAY_API_KEY.',
    );
  }

  async function request(pathName, payload, method = 'POST') {
    const authorization = await getAuthorizationHeader();

    return syncPayRequest({
      baseUrl: normalizedBaseUrl,
      pathName,
      payload,
      method,
      authorization,
    });
  }

  return {
    enabled: Boolean((normalizedClientId && normalizedClientSecret) || basicAuthorization),
    async getCompanyProfile() {
      const response = await request(
        usesPartnerApi ? '/api/partner/v1/profile' : '/s1/getCompany/',
        null,
        'GET',
      );
      return normalizeCompanyProfile(response);
    },
    async createPixPayment({
      amount,
      customer,
      externalReference,
      postbackUrl,
      metadata,
      itemTitle,
      itemDescription,
    }) {
      const normalizedAmount = Number(amount);
      const normalizedClient = compactObject({
        name: toText(customer?.name),
        cpf: toText(customer?.cpf),
        email: toText(customer?.email),
        phone: normalizePhoneDigits(customer?.phone),
      });

      const payload = usesPartnerApi
        ? compactObject({
            amount: normalizedAmount,
            description: toText(itemDescription) || toText(itemTitle) || 'Acesso VIP Telegram',
            metadata:
              typeof metadata === 'object' && metadata !== null
                ? compactObject({
                    ...metadata,
                    external_reference: toText(externalReference),
                  })
                : compactObject({
                    external_reference: toText(externalReference),
                    metadata: toText(metadata),
                  }),
          })
        : compactObject({
            ip: '127.0.0.1',
            pix: {},
            items: [
              {
                title: toText(itemTitle) || 'Acesso VIP Telegram',
                description: toText(itemDescription),
                quantity: 1,
                unitPrice: normalizedAmount,
                tangible: false,
              },
            ],
            amount: normalizedAmount,
            customer: compactObject({
              cpf: toText(customer?.cpf),
              name: toText(customer?.name),
              email: toText(customer?.email),
              phone: normalizePhoneDigits(customer?.phone),
              externaRef: toText(externalReference),
            }),
            metadata:
              typeof metadata === 'object' && metadata !== null
                ? metadata
                : {
                    reference: toText(externalReference),
                    metadata: toText(metadata),
                  },
            traceable: true,
            postbackUrl: toText(postbackUrl),
          });

      const response = await request(
        usesPartnerApi ? '/api/partner/v1/cash-in' : '/v1/gateway/api',
        payload,
        'POST',
      );
      return normalizeSyncPayPaymentResponse(response);
    },
    async getTransactionStatus(transactionId) {
      const normalizedTransactionId = toText(transactionId);

      if (!normalizedTransactionId) {
        throw new Error('idTransaction ausente para consulta na Syncpay.');
      }

      const response = await request(
        usesPartnerApi
          ? `/api/partner/v1/transaction/${encodeURIComponent(normalizedTransactionId)}`
          : `/s1/getTransaction/api/getTransactionStatus.php?id_transaction=${encodeURIComponent(
              normalizedTransactionId,
            )}`,
        null,
        'GET',
      );

      return normalizeSyncPayPaymentResponse(response);
    },
  };
}
