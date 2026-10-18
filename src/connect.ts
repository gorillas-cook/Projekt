import type Stripe from 'stripe';

export interface NewSellerInput {
  email: string;
  displayName: string;
  /** ISO 3166-1 alpha-2 country of the seller, e.g. "de". */
  country: string;
}

/**
 * Marketplace seller = Accounts v2 recipient: the platform is merchant of record
 * (destination charges), so no merchant configuration / card_payments is requested.
 */
export function sellerAccountParams(input: NewSellerInput): Stripe.V2.Core.AccountCreateParams {
  return {
    contact_email: input.email,
    display_name: input.displayName,
    identity: { country: input.country.toLowerCase() },
    dashboard: 'express',
    defaults: {
      responsibilities: {
        fees_collector: 'application',
        losses_collector: 'application',
      },
    },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: { stripe_transfers: { requested: true } },
        },
      },
    },
    include: ['configuration.recipient', 'requirements'],
  };
}

export async function retrieveSellerAccount(stripe: Stripe, accountId: string) {
  return stripe.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.recipient', 'requirements'],
  });
}

/** v2 readiness check. Do not use the deprecated v1 charges_enabled / payouts_enabled fields. */
export function canReceiveTransfers(account: Stripe.V2.Core.Account): boolean {
  return account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === 'active';
}

/** Embedded components for the seller dashboard. notification_banner keeps accounts healthy as requirements change. */
export function sellerAccountSessionParams(accountId: string): Stripe.AccountSessionCreateParams {
  return {
    account: accountId,
    components: {
      account_onboarding: { enabled: true },
      notification_banner: { enabled: true },
      account_management: { enabled: true },
      payments: { enabled: true },
      payouts: { enabled: true },
    },
  };
}
