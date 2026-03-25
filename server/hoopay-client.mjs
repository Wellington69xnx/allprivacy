const hoopayDefaultBaseUrl = 'https://api.pay.hoopay.com.br';

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  return toText(value).replace(/\/+$/, '') || hoopayDefaultBaseUrl;
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

function normalizeAmount(value, fallback = 0.5) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

function getBasicAuthorizationValue(username, password) {
  const normalizedUsername = toText(username);
  const normalizedPassword = toText(password);

  if (!normalizedUsername || !normalizedPassword) {
    return '';
  }

  return `Basic ${Buffer.from(`${normalizedUsername}:${normalizedPassword}`, 'utf8').toString('base64')}`;
}

function getHoopayErrorMessage(data, response) {
  const firstErrorMessage = Array.isArray(data?.errors)
    ? data.errors.map((item) => toText(item?.message)).find(Boolean)
    : '';

  return (
    firstErrorMessage ||
    toText(data?.message) ||
    `Hooppay retornou HTTP ${response.status}.`
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
    return `Nao foi possivel resolver o dominio da Hooppay em ${baseUrl}.`;
  }

  if (['ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH'].includes(errorCode)) {
    return `Nao foi possivel conectar na Hooppay em ${baseUrl}. Verifique rede, firewall e credenciais.`;
  }

  return error instanceof Error ? error.message : 'Falha de rede ao chamar a Hooppay.';
}

async function hoopayRequest({
  baseUrl,
  pathName,
  method = 'GET',
  payload,
  authorization,
}) {
  const requestUrl = `${normalizeBaseUrl(baseUrl)}${pathName}`;

  try {
    const response = await fetch(requestUrl, {
      method,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(getHoopayErrorMessage(data, response));
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.message && !error.message.includes('Hooppay retornou')) {
      throw new Error(formatFetchError(error, normalizeBaseUrl(baseUrl)));
    }

    throw error;
  }
}

function normalizeCharge(charge) {
  if (!charge || typeof charge !== 'object') {
    return {};
  }

  return charge;
}

function normalizeHoopayPaymentResponse(payload) {
  const payment = payload?.payment && typeof payload.payment === 'object' ? payload.payment : {};
  const charges = Array.isArray(payment?.charges) ? payment.charges : [];
  const firstCharge = normalizeCharge(charges[0]);
  const customer = payload?.customer && typeof payload.customer === 'object' ? payload.customer : {};
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const amountValue = Number(
    firstCharge?.amount ??
      payload?.amount ??
      payment?.amount ??
      payload?.products?.[0]?.amount ??
      payload?.products?.[0]?.price ??
      0,
  );

  return {
    transactionId: toText(payload?.orderUUID ?? firstCharge?.uuid),
    chargeId: toText(firstCharge?.uuid),
    paymentCode: toText(firstCharge?.pixPayload),
    paymentCodeBase64: toText(firstCharge?.pixQrCode),
    paymentLink: toText(payload?.data?.url),
    dueAt: toText(firstCharge?.expireAt),
    status: toText(firstCharge?.status ?? payment?.status) || 'pending',
    amount: Number.isFinite(amountValue) ? amountValue : 0,
    customer: {
      name: toText(customer?.name),
      email: toText(customer?.email),
      phone: toText(customer?.phone?.numbersOnly ?? customer?.phone?.phoneNumber),
      document: toText(customer?.document?.number),
    },
    metadata: {
      src: toText(data?.src),
      callbackURL: toText(data?.callbackURL),
    },
    raw: payload,
  };
}

export function isHooppayPaidStatus(status) {
  const normalizedStatus = toText(status).toUpperCase();
  return ['PAID', 'APPROVED', 'COMPLETED', 'AUTHORIZED'].includes(normalizedStatus);
}

export function createHooppayClient({
  organizationId,
  basicUsername,
  basicPassword,
  bearerToken,
  baseUrl = hoopayDefaultBaseUrl,
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedOrganizationId = toText(organizationId);
  const basicAuthorization = getBasicAuthorizationValue(
    basicUsername || normalizedOrganizationId,
    basicPassword,
  );
  const normalizedBearerToken = toText(bearerToken);

  async function requestCharge(payload) {
    return hoopayRequest({
      baseUrl: normalizedBaseUrl,
      pathName: '/charge',
      method: 'POST',
      payload,
      authorization: basicAuthorization,
    });
  }

  async function requestConsult(orderUUID) {
    if (!normalizedBearerToken) {
      throw new Error(
        'Consulta manual da Hooppay precisa de HOOPAY_BEARER_TOKEN no .env.',
      );
    }

    return hoopayRequest({
      baseUrl: normalizedBaseUrl,
      pathName: `/pix/consult/${encodeURIComponent(orderUUID)}`,
      method: 'GET',
      authorization: `Bearer ${normalizedBearerToken}`,
    });
  }

  return {
    providerName: 'Hooppay',
    enabled: Boolean(basicAuthorization),
    minimumAmount: 0.5,
    async getCompanyProfile() {
      return {
        name: 'AllPrivacy',
        email: '',
        cpf: '',
        phone: '',
        raw: {
          organizationId: normalizedOrganizationId,
        },
      };
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
      const normalizedAmount = normalizeAmount(amount, 0.5);
      const metadataUrl =
        typeof metadata === 'object' && metadata !== null ? toText(metadata.url) : '';
      const payload = {
        customer: {
          email: toText(customer?.email) || 'pix@allprivacy.site',
          name: toText(customer?.name) || 'AllPrivacy',
          phone: normalizePhoneDigits(customer?.phone) || '11912345678',
          document: toText(customer?.cpf ?? customer?.document) || '11144477735',
        },
        products: [
          {
            title: toText(itemTitle) || 'PIX',
            price: normalizedAmount,
            quantity: 1,
          },
        ],
        payments: [
          {
            type: 'pix',
          },
        ],
        data: {
          ip: '127.0.0.1',
          callbackURL: toText(postbackUrl),
          src: toText(externalReference),
          ...(metadataUrl ? { url: metadataUrl } : {}),
        },
      };

      const response = await requestCharge(payload);
      return normalizeHoopayPaymentResponse(response);
    },
    async getTransactionStatus(orderUUID) {
      const normalizedOrderUUID = toText(orderUUID);

      if (!normalizedOrderUUID) {
        throw new Error('orderUUID ausente para consulta na Hooppay.');
      }

      const response = await requestConsult(normalizedOrderUUID);
      return normalizeHoopayPaymentResponse(response);
    },
  };
}
