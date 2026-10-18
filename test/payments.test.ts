import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { invoiceParams, oneTimeCheckoutParams, platformFee, subscriptionCheckoutParams } from '../src/payments.js';
import { sellerAccountParams } from '../src/connect.js';
import { testConfig } from './helpers.js';

const price = (overrides: Partial<Stripe.Price> = {}) =>
  ({ id: 'price_1', type: 'one_time', unit_amount: 2500, active: true, metadata: {}, ...overrides }) as Stripe.Price;

describe('platformFee', () => {
  it('rounds down basis points', () => {
    expect(platformFee(2500, 1000)).toBe(250);
    expect(platformFee(999, 333)).toBe(33);
  });
});

describe('oneTimeCheckoutParams', () => {
  it('builds a destination charge with the platform fee and dynamic payment methods', () => {
    const params = oneTimeCheckoutParams({
      config: testConfig(),
      buyerUserId: 'buyer-1',
      sellerAccountId: 'acct_seller',
      items: [{ price: price(), quantity: 2 }],
    });
    expect(params.mode).toBe('payment');
    expect(params).not.toHaveProperty('payment_method_types');
    expect(params.payment_intent_data).toEqual({
      application_fee_amount: 500,
      transfer_data: { destination: 'acct_seller' },
    });
    expect(params.metadata).toEqual({ seller_account_id: 'acct_seller' });
    expect(params.client_reference_id).toBe('buyer-1');
    expect(params.integration_identifier).toMatch(/_[a-z]{8}$/);
    expect(params.automatic_tax).toBeUndefined();
  });

  it('enables Stripe Tax with platform liability only when configured', () => {
    const params = oneTimeCheckoutParams({
      config: testConfig({ taxEnabled: true }),
      buyerUserId: 'b',
      sellerAccountId: 'acct_seller',
      items: [{ price: price(), quantity: 1 }],
    });
    expect(params.automatic_tax).toEqual({ enabled: true, liability: { type: 'self' } });
  });

  it('rejects prices without a fixed amount', () => {
    expect(() =>
      oneTimeCheckoutParams({
        config: testConfig(),
        buyerUserId: 'b',
        sellerAccountId: 'acct_seller',
        items: [{ price: price({ unit_amount: null }), quantity: 1 }],
      }),
    ).toThrow(/fixed unit_amount/);
  });
});

describe('subscriptionCheckoutParams', () => {
  it('routes recurring funds to the seller and keeps a percentage fee', () => {
    const params = subscriptionCheckoutParams({
      config: testConfig({ platformFeeBps: 1250 }),
      buyerUserId: 'b',
      customerId: 'cus_1',
      sellerAccountId: 'acct_seller',
      priceId: 'price_sub',
    });
    expect(params.mode).toBe('subscription');
    expect(params.customer).toBe('cus_1');
    expect(params).not.toHaveProperty('payment_method_types');
    expect(params.subscription_data).toEqual({
      application_fee_percent: 12.5,
      transfer_data: { destination: 'acct_seller' },
    });
  });
});

describe('invoiceParams', () => {
  it('sends an invoice on behalf of the seller', () => {
    const params = invoiceParams({
      config: testConfig(),
      customerId: 'cus_1',
      sellerAccountId: 'acct_seller',
      items: [{ price: price({ unit_amount: 10000 }), quantity: 1 }],
      daysUntilDue: 14,
    });
    expect(params).toMatchObject({
      customer: 'cus_1',
      collection_method: 'send_invoice',
      application_fee_amount: 1000,
      transfer_data: { destination: 'acct_seller' },
    });
  });
});

describe('sellerAccountParams', () => {
  it('creates a v2 recipient account with platform-owned fees and losses', () => {
    const params = sellerAccountParams({ email: 's@example.com', displayName: 'Shop', country: 'DE' });
    expect(params.dashboard).toBe('express');
    expect(params.identity?.country).toBe('de');
    expect(params.defaults?.responsibilities).toEqual({ fees_collector: 'application', losses_collector: 'application' });
    expect(params.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.requested).toBe(true);
    expect(params.configuration).not.toHaveProperty('merchant');
  });
});
