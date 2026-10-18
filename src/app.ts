import express, { type NextFunction, type Request, type Response } from 'express';
import Stripe from 'stripe';
import type { Config } from './config.js';
import type { Store } from './store.js';
import { HttpError, currentUserId } from './auth.js';
import {
  canReceiveTransfers,
  retrieveSellerAccount,
  sellerAccountParams,
  sellerAccountSessionParams,
} from './connect.js';
import { invoiceParams, oneTimeCheckoutParams, subscriptionCheckoutParams, type LineItemInput } from './payments.js';
import { handleEventNotification, handleStripeEvent } from './webhooks.js';

export interface AppDeps {
  config: Config;
  stripe: Stripe;
  store: Store;
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

export function createApp({ config, stripe, store }: AppDeps) {
  const app = express();

  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' https://*.stripe.com",
        "frame-src https://*.stripe.com",
        "connect-src 'self' https://*.stripe.com",
        "img-src 'self' data: https://*.stripe.com",
        "style-src 'self' 'unsafe-inline'",
      ].join('; '),
    );
    next();
  });

  // Webhooks need the raw body for signature verification, so they are registered before express.json().
  app.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    route(async (req, res) => {
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(req.body, req.header('stripe-signature') ?? '', config.webhookSecret);
      } catch {
        return res.status(400).send('Invalid signature');
      }
      await handleStripeEvent(event, store);
      res.json({ received: true });
    }),
  );

  app.post(
    '/webhooks/stripe-v2',
    express.raw({ type: 'application/json' }),
    route(async (req, res) => {
      let notification: Stripe.V2.Core.EventNotification;
      try {
        notification = stripe.parseEventNotification(req.body, req.header('stripe-signature') ?? '', config.webhookSecretV2);
      } catch {
        return res.status(400).send('Invalid signature');
      }
      await handleEventNotification(notification, store);
      res.json({ received: true });
    }),
  );

  app.use(express.json());
  app.use(express.static('public'));

  app.get('/api/config', (_req, res) => {
    res.json({ publishableKey: config.stripePublishableKey });
  });

  // --- Connect: seller onboarding ---

  app.post(
    '/api/connect/accounts',
    route(async (req, res) => {
      const userId = currentUserId(req, config);
      const existing = await store.getSeller(userId);
      if (existing) return res.json({ accountId: existing.stripeAccountId });

      const { email, displayName, country } = req.body ?? {};
      if (typeof email !== 'string' || typeof displayName !== 'string' || typeof country !== 'string') {
        throw new HttpError(400, 'email, displayName and country are required');
      }
      const account = await stripe.v2.core.accounts.create(
        sellerAccountParams({ email, displayName, country }),
        { idempotencyKey: `seller-account-${userId}` },
      );
      await store.saveSeller({ userId, stripeAccountId: account.id, transfersActive: canReceiveTransfers(account) });
      res.status(201).json({ accountId: account.id });
    }),
  );

  app.post(
    '/api/connect/account-session',
    route(async (req, res) => {
      const seller = await requireSeller(currentUserId(req, config));
      const session = await stripe.accountSessions.create(sellerAccountSessionParams(seller.stripeAccountId));
      res.json({ clientSecret: session.client_secret });
    }),
  );

  app.get(
    '/api/connect/status',
    route(async (req, res) => {
      const seller = await requireSeller(currentUserId(req, config));
      const account = await retrieveSellerAccount(stripe, seller.stripeAccountId);
      res.json({ accountId: account.id, transfersActive: canReceiveTransfers(account) });
    }),
  );

  // --- Payments: one-time purchase from a seller ---

  app.post(
    '/api/checkout',
    route(async (req, res) => {
      const buyerUserId = currentUserId(req, config);
      const { sellerUserId, items } = req.body ?? {};
      const seller = await requireReadySeller(sellerUserId);
      const lineItems = await sellerLineItems(items, seller.userId);
      const session = await stripe.checkout.sessions.create(
        oneTimeCheckoutParams({
          config,
          buyerUserId,
          customerId: await store.getCustomerId(buyerUserId),
          sellerAccountId: seller.stripeAccountId,
          items: lineItems,
        }),
      );
      res.json({ url: session.url });
    }),
  );

  // --- Billing: subscription to a seller's plan ---

  app.post(
    '/api/subscriptions/checkout',
    route(async (req, res) => {
      const buyerUserId = currentUserId(req, config);
      const { sellerUserId, priceId } = req.body ?? {};
      const seller = await requireReadySeller(sellerUserId);
      const price = await sellerPrice(priceId, seller.userId);
      if (price.type !== 'recurring') throw new HttpError(400, 'priceId must be a recurring price');

      const session = await stripe.checkout.sessions.create(
        subscriptionCheckoutParams({
          config,
          buyerUserId,
          customerId: await store.getCustomerId(buyerUserId),
          sellerAccountId: seller.stripeAccountId,
          priceId: price.id,
        }),
      );
      res.json({ url: session.url });
    }),
  );

  // Customer Portal: buyers manage their own subscriptions and payment methods.
  app.post(
    '/api/billing/portal',
    route(async (req, res) => {
      const customerId = await store.getCustomerId(currentUserId(req, config));
      if (!customerId) throw new HttpError(404, 'No Stripe customer for this user yet');
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: config.appUrl });
      res.json({ url: session.url });
    }),
  );

  // --- Invoicing: a seller bills a known buyer ---

  app.post(
    '/api/invoices',
    route(async (req, res) => {
      const seller = await requireReadySeller(currentUserId(req, config));
      const { buyerUserId, items, daysUntilDue = 14 } = req.body ?? {};
      const customerId = typeof buyerUserId === 'string' ? await store.getCustomerId(buyerUserId) : undefined;
      if (!customerId) throw new HttpError(404, 'Buyer has no Stripe customer yet');
      const lineItems = await sellerLineItems(items, seller.userId);
      const invoice = await stripe.invoices.create(
        invoiceParams({
          config,
          customerId,
          sellerAccountId: seller.stripeAccountId,
          items: lineItems,
          daysUntilDue: Number(daysUntilDue),
        }),
      );
      for (const { price, quantity } of lineItems) {
        await stripe.invoiceItems.create({ customer: customerId, invoice: invoice.id, pricing: { price: price.id }, quantity });
      }
      await stripe.invoices.finalizeInvoice(invoice.id);
      const sent = await stripe.invoices.sendInvoice(invoice.id);
      res.status(201).json({ invoiceId: sent.id, hostedInvoiceUrl: sent.hosted_invoice_url });
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof Stripe.errors.StripeError) {
      console.error('Stripe error', err.type, err.code, err.requestId);
      return res.status(502).json({ error: err.message, code: err.code });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  async function requireSeller(userId: string) {
    const seller = await store.getSeller(userId);
    if (!seller) throw new HttpError(404, 'Seller has no Stripe account yet');
    return seller;
  }

  /** Re-checks the live v2 capability before any charge that transfers funds to the seller. */
  async function requireReadySeller(sellerUserId: unknown) {
    if (typeof sellerUserId !== 'string') throw new HttpError(400, 'sellerUserId is required');
    const seller = await requireSeller(sellerUserId);
    const account = await retrieveSellerAccount(stripe, seller.stripeAccountId);
    if (!canReceiveTransfers(account)) throw new HttpError(409, 'Seller has not finished onboarding');
    return seller;
  }

  /**
   * Prices live on the platform account. Convention: each seller's prices carry
   * metadata.seller_user_id so a buyer cannot pay seller A for seller B's product.
   */
  async function sellerPrice(priceId: unknown, sellerUserId: string) {
    if (typeof priceId !== 'string') throw new HttpError(400, 'priceId is required');
    const price = await stripe.prices.retrieve(priceId);
    if (!price.active || price.metadata.seller_user_id !== sellerUserId) {
      throw new HttpError(400, `Price ${priceId} is not an active price of this seller`);
    }
    return price;
  }

  async function sellerLineItems(items: unknown, sellerUserId: string): Promise<LineItemInput[]> {
    if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'items are required');
    return Promise.all(
      items.map(async (item: { priceId?: unknown; quantity?: unknown }) => ({
        price: await sellerPrice(item.priceId, sellerUserId),
        quantity: Number(item.quantity ?? 1),
      })),
    );
  }

  return app;
}
