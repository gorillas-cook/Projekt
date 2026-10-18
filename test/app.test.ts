import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type Stripe from 'stripe';
import { createApp } from '../src/app.js';
import { InMemoryStore } from '../src/store.js';
import { signedPayload, testConfig, testStripe } from './helpers.js';

const config = testConfig();
let stripe: Stripe;
let store: InMemoryStore;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  stripe = testStripe(config);
  store = new InMemoryStore();
  app = createApp({ config, stripe, store });
});

const checkoutEvent = (type: string, paymentStatus: string, id = 'evt_1') => ({
  id,
  object: 'event',
  type,
  data: {
    object: {
      id: 'cs_1',
      object: 'checkout.session',
      mode: 'payment',
      payment_status: paymentStatus,
      customer: 'cus_1',
      client_reference_id: 'buyer-1',
      metadata: { seller_account_id: 'acct_seller' },
    },
  },
});

function postWebhook(payload: object, secret = config.webhookSecret, path = '/webhooks/stripe') {
  const { body, signature } = signedPayload(stripe, payload, secret);
  return request(app).post(path).set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(body);
}

describe('POST /webhooks/stripe', () => {
  it('rejects an invalid signature', async () => {
    const res = await postWebhook(checkoutEvent('checkout.session.completed', 'paid'), 'whsec_wrong');
    expect(res.status).toBe(400);
    expect(store.orders.size).toBe(0);
  });

  it('fulfills a paid checkout and remembers the customer', async () => {
    const res = await postWebhook(checkoutEvent('checkout.session.completed', 'paid'));
    expect(res.status).toBe(200);
    expect(store.orders.get('cs_1')).toEqual({ checkoutSessionId: 'cs_1', sellerAccountId: 'acct_seller', status: 'paid' });
    expect(await store.getCustomerId('buyer-1')).toBe('cus_1');
  });

  it('does not fulfill an unpaid (delayed) checkout until async_payment_succeeded', async () => {
    await postWebhook(checkoutEvent('checkout.session.completed', 'unpaid', 'evt_a'));
    expect(store.orders.size).toBe(0);
    await postWebhook(checkoutEvent('checkout.session.async_payment_succeeded', 'paid', 'evt_b'));
    expect(store.orders.get('cs_1')?.status).toBe('paid');
  });

  it('ignores a redelivered event', async () => {
    await postWebhook(checkoutEvent('checkout.session.completed', 'paid'));
    store.orders.clear();
    await postWebhook(checkoutEvent('checkout.session.completed', 'paid'));
    expect(store.orders.size).toBe(0);
  });
});

describe('POST /webhooks/stripe-v2', () => {
  it('rejects a thin event signed with the snapshot secret', async () => {
    const res = await postWebhook({ id: 'evt_v2', object: 'v2.core.event', type: 'v2.core.account.updated' }, config.webhookSecret, '/webhooks/stripe-v2');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/checkout', () => {
  beforeEach(async () => {
    await store.saveSeller({ userId: 'seller-1', stripeAccountId: 'acct_seller', transfersActive: true });
  });

  const stubAccount = (status: string) =>
    vi.spyOn(stripe.v2.core.accounts, 'retrieve').mockResolvedValue({
      id: 'acct_seller',
      configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status } } } } },
    } as unknown as Stripe.Response<Stripe.V2.Core.Account>);

  const stubPrice = (sellerUserId: string) =>
    vi.spyOn(stripe.prices, 'retrieve').mockResolvedValue({
      id: 'price_1',
      type: 'one_time',
      unit_amount: 2000,
      active: true,
      metadata: { seller_user_id: sellerUserId },
    } as unknown as Stripe.Response<Stripe.Price>);

  const checkout = () =>
    request(app)
      .post('/api/checkout')
      .set('X-Demo-User-Id', 'buyer-1')
      .send({ sellerUserId: 'seller-1', items: [{ priceId: 'price_1', quantity: 1 }] });

  it('creates a destination-charge session for a ready seller', async () => {
    stubAccount('active');
    stubPrice('seller-1');
    const create = vi
      .spyOn(stripe.checkout.sessions, 'create')
      .mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_1' } as Stripe.Response<Stripe.Checkout.Session>);

    const res = await checkout();
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('checkout.stripe.com');
    expect(create.mock.calls[0][0]?.payment_intent_data?.transfer_data?.destination).toBe('acct_seller');
  });

  it('refuses sellers whose transfers capability is not active', async () => {
    stubAccount('pending');
    const res = await checkout();
    expect(res.status).toBe(409);
  });

  it("refuses another seller's price", async () => {
    stubAccount('active');
    stubPrice('seller-2');
    const res = await checkout();
    expect(res.status).toBe(400);
  });
});

describe('auth placeholder', () => {
  it('refuses all authenticated routes in production until real auth is wired in', async () => {
    const prodApp = createApp({ config: { ...config, isProduction: true }, stripe, store });
    const res = await request(prodApp).get('/api/connect/status').set('X-Demo-User-Id', 'seller-1');
    expect(res.status).toBe(501);
  });
});
