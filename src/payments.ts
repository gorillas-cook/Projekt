import type Stripe from 'stripe';
import type { Config } from './config.js';
import { HttpError } from './auth.js';

// Labels for comparing checkout flows in the Dashboard (fixed suffix of 8 random letters).
const ONE_TIME_FLOW_ID = 'marketplace_payment_qhzrtmwk';
const SUBSCRIPTION_FLOW_ID = 'marketplace_subscription_vbnelpsd';

export function platformFee(amount: number, feeBps: number): number {
  return Math.floor((amount * feeBps) / 10000);
}

/**
 * Stripe Tax: the platform is merchant of record for destination charges, so liability is the platform ('self').
 * Confirm with your tax advisor; marketplace-facilitator rules can change this.
 */
function automaticTax(config: Config) {
  return config.taxEnabled ? { enabled: true, liability: { type: 'self' as const } } : undefined;
}

export interface LineItemInput {
  price: Stripe.Price;
  quantity: number;
}

function itemsAmount(items: LineItemInput[]): number {
  return items.reduce((sum, { price, quantity }) => {
    if (price.type !== 'one_time' || price.unit_amount == null) {
      throw new HttpError(400, `Price ${price.id} must be a one-time price with a fixed unit_amount`);
    }
    if (!Number.isInteger(quantity) || quantity < 1) throw new HttpError(400, 'quantity must be a positive integer');
    return sum + price.unit_amount * quantity;
  }, 0);
}

/** One-time purchase from a seller: destination charge, platform keeps application_fee_amount. */
export function oneTimeCheckoutParams(args: {
  config: Config;
  buyerUserId: string;
  customerId?: string;
  sellerAccountId: string;
  items: LineItemInput[];
}): Stripe.Checkout.SessionCreateParams {
  const { config } = args;
  const amount = itemsAmount(args.items);
  // No payment_method_types: Stripe picks eligible payment methods dynamically from Dashboard settings.
  return {
    mode: 'payment',
    line_items: args.items.map(({ price, quantity }) => ({ price: price.id, quantity })),
    client_reference_id: args.buyerUserId,
    metadata: { seller_account_id: args.sellerAccountId },
    ...(args.customerId ? { customer: args.customerId } : { customer_creation: 'always' as const }),
    payment_intent_data: {
      application_fee_amount: platformFee(amount, config.platformFeeBps),
      transfer_data: { destination: args.sellerAccountId },
    },
    automatic_tax: automaticTax(config),
    integration_identifier: ONE_TIME_FLOW_ID,
    success_url: `${config.appUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appUrl}/`,
  };
}

/** Recurring subscription to a seller's plan: funds go to the seller, platform keeps application_fee_percent. */
export function subscriptionCheckoutParams(args: {
  config: Config;
  buyerUserId: string;
  customerId?: string;
  sellerAccountId: string;
  priceId: string;
}): Stripe.Checkout.SessionCreateParams {
  const { config } = args;
  return {
    mode: 'subscription',
    line_items: [{ price: args.priceId, quantity: 1 }],
    client_reference_id: args.buyerUserId,
    ...(args.customerId ? { customer: args.customerId } : {}),
    subscription_data: {
      application_fee_percent: config.platformFeeBps / 100,
      transfer_data: { destination: args.sellerAccountId },
    },
    automatic_tax: automaticTax(config),
    integration_identifier: SUBSCRIPTION_FLOW_ID,
    success_url: `${config.appUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appUrl}/`,
  };
}

/** Invoice sent to a buyer on behalf of a seller (Stripe-hosted invoice page handles payment). */
export function invoiceParams(args: {
  config: Config;
  customerId: string;
  sellerAccountId: string;
  items: LineItemInput[];
  daysUntilDue: number;
}): Stripe.InvoiceCreateParams {
  const amount = itemsAmount(args.items);
  return {
    customer: args.customerId,
    collection_method: 'send_invoice',
    days_until_due: args.daysUntilDue,
    // Items are attached explicitly after creation, not swept from pending invoice items.
    pending_invoice_items_behavior: 'exclude',
    application_fee_amount: platformFee(amount, args.config.platformFeeBps),
    transfer_data: { destination: args.sellerAccountId },
    automatic_tax: automaticTax(args.config),
  };
}
