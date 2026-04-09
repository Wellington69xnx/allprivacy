import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

const defaultBillingState = {
  customers: {},
  conversations: {},
  payments: {},
  subscriptions: {},
};

function normalizeCustomer(customer, chatIdKey) {
  if (!customer || typeof customer !== 'object') {
    return null;
  }

  const chatId = String(customer.chatId ?? chatIdKey ?? '');

  if (!chatId) {
    return null;
  }

  return {
    chatId,
    telegramUserId: Number(customer.telegramUserId || 0) || null,
    firstName: toText(customer.firstName),
    lastName: toText(customer.lastName),
    username: toText(customer.username),
    fullName: toText(customer.fullName),
    email: toText(customer.email),
    cpf: toText(customer.cpf),
    phone: toText(customer.phone),
    previewUsageDate: toText(customer.previewUsageDate),
    previewUsageCount: Math.max(0, Number(customer.previewUsageCount || 0)),
    previewUsageWindowStartedAt: toText(customer.previewUsageWindowStartedAt),
    previewRecentMediaKeys: Array.isArray(customer.previewRecentMediaKeys)
      ? customer.previewRecentMediaKeys.map((item) => toText(item)).filter(Boolean).slice(0, 24)
      : [],
    previewUpsellMessageId: Number(customer.previewUpsellMessageId || 0) || null,
    createdAt: toText(customer.createdAt) || new Date().toISOString(),
    updatedAt: toText(customer.updatedAt) || new Date().toISOString(),
  };
}

function normalizeConversation(conversation, chatIdKey) {
  if (!conversation || typeof conversation !== 'object') {
    return null;
  }

  const chatId = String(conversation.chatId ?? chatIdKey ?? '');
  const step = toText(conversation.step);

  if (!chatId || !step) {
    return null;
  }

  return {
    chatId,
    step,
    modelSlug: toText(conversation.modelSlug),
    modelName: toText(conversation.modelName),
    paymentId: toText(conversation.paymentId),
    createdAt: toText(conversation.createdAt) || new Date().toISOString(),
    updatedAt: toText(conversation.updatedAt) || new Date().toISOString(),
  };
}

function normalizePayment(payment, paymentIdKey) {
  if (!payment || typeof payment !== 'object') {
    return null;
  }

  const id = toText(payment.id) || toText(paymentIdKey);

  if (!id) {
    return null;
  }

  return {
    id,
    chatId: String(payment.chatId ?? ''),
    telegramUserId: Number(payment.telegramUserId || 0) || null,
    planId: toText(payment.planId),
    planName: toText(payment.planName),
    planDurationLabel: toText(payment.planDurationLabel),
    displayAmount: Number(payment.displayAmount || 0),
    modelSlug: toText(payment.modelSlug),
    modelName: toText(payment.modelName),
    externalReference: toText(payment.externalReference) || id,
    syncpayTransactionId: toText(payment.syncpayTransactionId),
    amount: Number(payment.amount || 0),
    currency: toText(payment.currency) || 'BRL',
    status: toText(payment.status) || 'draft',
    paymentCode: toText(payment.paymentCode),
    paymentCodeBase64: toText(payment.paymentCodeBase64),
    paymentLink: toText(payment.paymentLink),
    dueAt: toText(payment.dueAt),
    pixExpiresAt: toText(payment.pixExpiresAt),
    paidAt: toText(payment.paidAt),
    grantedAt: toText(payment.grantedAt),
    deliveredAt: toText(payment.deliveredAt),
    inviteLink: toText(payment.inviteLink),
    paymentMessageIds: Array.isArray(payment.paymentMessageIds)
      ? payment.paymentMessageIds
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item > 0)
      : [],
    syncpayPayload: payment.syncpayPayload && typeof payment.syncpayPayload === 'object'
      ? payment.syncpayPayload
      : null,
    createdAt: toText(payment.createdAt) || new Date().toISOString(),
    updatedAt: toText(payment.updatedAt) || new Date().toISOString(),
  };
}

function normalizeSubscription(subscription, subscriptionIdKey) {
  if (!subscription || typeof subscription !== 'object') {
    return null;
  }

  const id = toText(subscription.id) || toText(subscriptionIdKey);

  if (!id) {
    return null;
  }

  return {
    id,
    chatId: String(subscription.chatId ?? ''),
    telegramUserId: Number(subscription.telegramUserId || 0) || null,
    status: toText(subscription.status) || 'active',
    planId: toText(subscription.planId),
    planName: toText(subscription.planName),
    planDurationLabel: toText(subscription.planDurationLabel),
    displayAmount: Number(subscription.displayAmount || 0),
    modelSlug: toText(subscription.modelSlug),
    modelName: toText(subscription.modelName),
    lastPaymentId: toText(subscription.lastPaymentId),
    paymentIds: Array.isArray(subscription.paymentIds)
      ? subscription.paymentIds.map((item) => toText(item)).filter(Boolean)
      : [],
    startedAt: toText(subscription.startedAt) || new Date().toISOString(),
    expiresAt: toText(subscription.expiresAt),
    inviteLink: toText(subscription.inviteLink),
    inviteLinkCreatedAt: toText(subscription.inviteLinkCreatedAt),
    inviteLinkExpiresAt: toText(subscription.inviteLinkExpiresAt),
    removedAt: toText(subscription.removedAt),
    removedReason: toText(subscription.removedReason),
    createdAt: toText(subscription.createdAt) || new Date().toISOString(),
    updatedAt: toText(subscription.updatedAt) || new Date().toISOString(),
  };
}

function normalizeBillingState(state) {
  if (!state || typeof state !== 'object') {
    return cloneState(defaultBillingState);
  }

  const customers = {};
  const conversations = {};
  const payments = {};
  const subscriptions = {};

  for (const [chatId, customer] of Object.entries(state.customers ?? {})) {
    const normalized = normalizeCustomer(customer, chatId);

    if (normalized) {
      customers[normalized.chatId] = normalized;
    }
  }

  for (const [chatId, conversation] of Object.entries(state.conversations ?? {})) {
    const normalized = normalizeConversation(conversation, chatId);

    if (normalized) {
      conversations[normalized.chatId] = normalized;
    }
  }

  for (const [paymentId, payment] of Object.entries(state.payments ?? {})) {
    const normalized = normalizePayment(payment, paymentId);

    if (normalized) {
      payments[normalized.id] = normalized;
    }
  }

  for (const [subscriptionId, subscription] of Object.entries(state.subscriptions ?? {})) {
    const normalized = normalizeSubscription(subscription, subscriptionId);

    if (normalized) {
      subscriptions[normalized.id] = normalized;
    }
  }

  return {
    customers,
    conversations,
    payments,
    subscriptions,
  };
}

function createWriteQueue() {
  let queue = Promise.resolve();

  return function enqueue(task) {
    const runTask = async () => task();
    const result = queue.then(runTask, runTask);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export function createBillingStore(filePath) {
  const enqueue = createWriteQueue();

  async function ensureStorage() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(
        filePath,
        `${JSON.stringify(defaultBillingState, null, 2)}\n`,
        'utf8',
      );
    }
  }

  async function readState() {
    await ensureStorage();

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return normalizeBillingState(JSON.parse(raw));
    } catch {
      return cloneState(defaultBillingState);
    }
  }

  async function writeState(nextState) {
    const normalized = normalizeBillingState(nextState);
    await ensureStorage();
    await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
  }

  async function updateState(updater) {
    return enqueue(async () => {
      const currentState = await readState();
      const workingCopy = cloneState(currentState);
      const updatedState = (await updater(workingCopy)) ?? workingCopy;
      return writeState(updatedState);
    });
  }

  return {
    ensureStorage,
    readState,
    updateState,
    async getCustomer(chatId) {
      const state = await readState();
      return state.customers[String(chatId)] ?? null;
    },
    async upsertCustomer(chatId, payload) {
      const chatIdKey = String(chatId);
      let nextCustomer = null;

      await updateState((state) => {
        const previous = state.customers[chatIdKey] ?? null;
        nextCustomer = normalizeCustomer(
          {
            ...previous,
            ...payload,
            chatId: chatIdKey,
            createdAt: previous?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          chatIdKey,
        );

        state.customers[chatIdKey] = nextCustomer;
        return state;
      });

      return nextCustomer;
    },
    async getConversation(chatId) {
      const state = await readState();
      return state.conversations[String(chatId)] ?? null;
    },
    async setConversation(chatId, payload) {
      const chatIdKey = String(chatId);
      let nextConversation = null;

      await updateState((state) => {
        const previous = state.conversations[chatIdKey] ?? null;
        nextConversation = normalizeConversation(
          {
            ...previous,
            ...payload,
            chatId: chatIdKey,
            createdAt: previous?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          chatIdKey,
        );

        if (nextConversation) {
          state.conversations[chatIdKey] = nextConversation;
        } else {
          delete state.conversations[chatIdKey];
        }

        return state;
      });

      return nextConversation;
    },
    async clearConversation(chatId) {
      const chatIdKey = String(chatId);

      await updateState((state) => {
        delete state.conversations[chatIdKey];
        return state;
      });

      return null;
    },
    async createPayment(payload) {
      const paymentId = toText(payload?.id) || `payment-${randomUUID()}`;
      const payment = normalizePayment(
        {
          ...payload,
          id: paymentId,
          externalReference: toText(payload?.externalReference) || paymentId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        paymentId,
      );

      await updateState((state) => {
        state.payments[paymentId] = payment;
        return state;
      });

      return payment;
    },
    async updatePayment(paymentId, payload) {
      const paymentIdKey = String(paymentId);
      let nextPayment = null;

      await updateState((state) => {
        const previous = state.payments[paymentIdKey];

        if (!previous) {
          return state;
        }

        nextPayment = normalizePayment(
          {
            ...previous,
            ...payload,
            id: paymentIdKey,
            updatedAt: new Date().toISOString(),
          },
          paymentIdKey,
        );
        state.payments[paymentIdKey] = nextPayment;

        return state;
      });

      return nextPayment;
    },
    async updatePaymentIfStatus(paymentId, allowedStatuses, payload) {
      const paymentIdKey = String(paymentId);
      const normalizedAllowedStatuses = Array.isArray(allowedStatuses)
        ? allowedStatuses.map((status) => toText(status).toLowerCase()).filter(Boolean)
        : [];
      let nextPayment = null;
      let matched = false;

      await updateState((state) => {
        const previous = state.payments[paymentIdKey];

        if (!previous) {
          return state;
        }

        if (!normalizedAllowedStatuses.includes(toText(previous.status).toLowerCase())) {
          nextPayment = previous;
          return state;
        }

        matched = true;
        nextPayment = normalizePayment(
          {
            ...previous,
            ...payload,
            id: paymentIdKey,
            updatedAt: new Date().toISOString(),
          },
          paymentIdKey,
        );
        state.payments[paymentIdKey] = nextPayment;

        return state;
      });

      return {
        matched,
        payment: nextPayment,
      };
    },
    async getPayment(paymentId) {
      const state = await readState();
      return state.payments[String(paymentId)] ?? null;
    },
    async findPaymentByExternalReference(externalReference) {
      const normalizedReference = toText(externalReference);

      if (!normalizedReference) {
        return null;
      }

      const state = await readState();

      return (
        Object.values(state.payments).find(
          (payment) => payment.externalReference === normalizedReference,
        ) ?? null
      );
    },
    async findPaymentByTransactionId(transactionId) {
      const normalizedTransactionId = toText(transactionId);

      if (!normalizedTransactionId) {
        return null;
      }

      const state = await readState();

      return (
        Object.values(state.payments).find(
          (payment) => payment.syncpayTransactionId === normalizedTransactionId,
        ) ?? null
      );
    },
    async findPendingPayment(chatId, modelSlug, planId = '') {
      const chatIdKey = String(chatId);
      const normalizedModelSlug = toText(modelSlug);
      const normalizedPlanId = toText(planId);
      const state = await readState();
      const now = Date.now();

      return (
        Object.values(state.payments)
          .filter((payment) => payment.chatId === chatIdKey)
          .filter((payment) =>
            ['draft', 'pending', 'created', 'waiting_payment'].includes(payment.status),
          )
          .filter((payment) => {
            if (!normalizedModelSlug) {
              return true;
            }

            return payment.modelSlug === normalizedModelSlug;
          })
          .filter((payment) => {
            if (!normalizedPlanId) {
              return true;
            }

            return payment.planId === normalizedPlanId;
          })
          .filter((payment) => {
            if (!payment.dueAt) {
              return true;
            }

            const dueTimestamp = Date.parse(payment.dueAt);
            return Number.isFinite(dueTimestamp) ? dueTimestamp > now : true;
          })
          .filter((payment) => {
            if (!payment.pixExpiresAt) {
              return true;
            }

            const expiresTimestamp = Date.parse(payment.pixExpiresAt);
            return Number.isFinite(expiresTimestamp) ? expiresTimestamp > now : true;
          })
          .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ??
        null
      );
    },
    async listPendingPaymentsForChat(chatId, modelSlug = '', planId = '') {
      const chatIdKey = String(chatId);
      const normalizedModelSlug = toText(modelSlug);
      const normalizedPlanId = toText(planId);
      const state = await readState();
      const now = Date.now();

      return Object.values(state.payments)
        .filter((payment) => payment.chatId === chatIdKey)
        .filter((payment) =>
          ['draft', 'pending', 'created', 'waiting_payment'].includes(payment.status),
        )
        .filter((payment) => {
          if (!normalizedModelSlug) {
            return true;
          }

          return payment.modelSlug === normalizedModelSlug;
        })
        .filter((payment) => {
          if (!normalizedPlanId) {
            return true;
          }

          return payment.planId === normalizedPlanId;
        })
        .filter((payment) => {
          if (!payment.dueAt) {
            return true;
          }

          const dueTimestamp = Date.parse(payment.dueAt);
          return Number.isFinite(dueTimestamp) ? dueTimestamp > now : true;
        })
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    },
    async listPendingPayments() {
      const state = await readState();
      const now = Date.now();

      return Object.values(state.payments)
        .filter((payment) =>
          ['draft', 'pending', 'created', 'waiting_payment'].includes(payment.status),
        )
        .filter((payment) => Boolean(payment.syncpayTransactionId))
        .filter((payment) => {
          if (!payment.dueAt) {
            return true;
          }

          const dueTimestamp = Date.parse(payment.dueAt);
          return Number.isFinite(dueTimestamp) ? dueTimestamp > now : true;
        })
        .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
    },
    async getActiveSubscription(chatId) {
      const chatIdKey = String(chatId);
      const state = await readState();
      const now = Date.now();

      return (
        Object.values(state.subscriptions)
          .filter((subscription) => subscription.chatId === chatIdKey)
          .filter((subscription) => subscription.status === 'active')
          .filter((subscription) => {
            const expiresAt = Date.parse(subscription.expiresAt);
            return Number.isFinite(expiresAt) ? expiresAt > now : false;
          })
          .sort((left, right) => Date.parse(right.expiresAt) - Date.parse(left.expiresAt))[0] ??
        null
      );
    },
    async getActiveSubscriptionByTelegramUserId(telegramUserId) {
      const normalizedUserId = Number(telegramUserId || 0);

      if (!normalizedUserId) {
        return null;
      }

      const state = await readState();
      const now = Date.now();

      return (
        Object.values(state.subscriptions)
          .filter((subscription) => subscription.telegramUserId === normalizedUserId)
          .filter((subscription) => subscription.status === 'active')
          .filter((subscription) => {
            const expiresAt = Date.parse(subscription.expiresAt);
            return Number.isFinite(expiresAt) ? expiresAt > now : false;
          })
          .sort((left, right) => Date.parse(right.expiresAt) - Date.parse(left.expiresAt))[0] ??
        null
      );
    },
    async grantSubscription({
      chatId,
      telegramUserId,
      paymentId,
      planId,
      planName,
      planDurationLabel,
      displayAmount,
      modelSlug,
      modelName,
      durationMs,
      inviteLink,
      inviteLinkExpiresAt,
    }) {
      const chatIdKey = String(chatId);
      const duration = Number(durationMs || 0);
      let nextSubscription = null;

      await updateState((state) => {
        const existingActive = Object.values(state.subscriptions)
          .filter((subscription) => subscription.chatId === chatIdKey)
          .filter((subscription) => subscription.status === 'active')
          .sort((left, right) => Date.parse(right.expiresAt) - Date.parse(left.expiresAt))[0];
        const now = Date.now();
        const existingExpiry = existingActive ? Date.parse(existingActive.expiresAt) : NaN;
        const baseTimestamp = Number.isFinite(existingExpiry)
          ? Math.max(existingExpiry, now)
          : now;
        const nextExpiresAt = new Date(baseTimestamp + duration).toISOString();
        const subscriptionId = existingActive?.id || `subscription-${randomUUID()}`;
        const previousPaymentIds = existingActive?.paymentIds ?? [];

        nextSubscription = normalizeSubscription(
          {
            ...existingActive,
            id: subscriptionId,
            chatId: chatIdKey,
            telegramUserId,
            status: 'active',
            planId: toText(planId) || existingActive?.planId,
            planName: toText(planName) || existingActive?.planName,
            planDurationLabel: toText(planDurationLabel) || existingActive?.planDurationLabel,
            displayAmount: Number(displayAmount || existingActive?.displayAmount || 0),
            modelSlug: toText(modelSlug) || existingActive?.modelSlug,
            modelName: toText(modelName) || existingActive?.modelName,
            lastPaymentId: paymentId,
            paymentIds: Array.from(new Set([...previousPaymentIds, paymentId].filter(Boolean))),
            startedAt: existingActive?.startedAt || new Date(now).toISOString(),
            expiresAt: nextExpiresAt,
            inviteLink: toText(inviteLink) || existingActive?.inviteLink,
            inviteLinkCreatedAt: new Date(now).toISOString(),
            inviteLinkExpiresAt: toText(inviteLinkExpiresAt),
            removedAt: '',
            removedReason: '',
            createdAt: existingActive?.createdAt || new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
          },
          subscriptionId,
        );
        state.subscriptions[subscriptionId] = nextSubscription;

        return state;
      });

      return nextSubscription;
    },
    async updateSubscription(subscriptionId, payload) {
      const subscriptionIdKey = String(subscriptionId);
      let nextSubscription = null;

      await updateState((state) => {
        const previous = state.subscriptions[subscriptionIdKey];

        if (!previous) {
          return state;
        }

        nextSubscription = normalizeSubscription(
          {
            ...previous,
            ...payload,
            id: subscriptionIdKey,
            updatedAt: new Date().toISOString(),
          },
          subscriptionIdKey,
        );
        state.subscriptions[subscriptionIdKey] = nextSubscription;

        return state;
      });

      return nextSubscription;
    },
    async listExpiredSubscriptions(now = Date.now()) {
      const state = await readState();

      return Object.values(state.subscriptions)
        .filter((subscription) => subscription.status === 'active')
        .filter((subscription) => {
          const expiresAt = Date.parse(subscription.expiresAt);
          return Number.isFinite(expiresAt) ? expiresAt <= now : false;
        })
        .filter((subscription) => !subscription.removedAt)
        .sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt));
    },
  };
}
