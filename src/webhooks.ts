import type Stripe from 'stripe';
import type { Store } from './store.js';
import { canReceiveTransfers } from './connect.js';

/**
 * Snapshot events (v1): payments, subscriptions, invoices.
 * Fulfillment lives here, never on the success page: buyers may never reach it,
 * and delayed payment methods complete hours or days later.
 */
export async function handleStripeEvent(event: Stripe.Event, store: Store): Promise<void> {
  if (!(await store.markEventProcessed(event.id))) return;

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      await rememberCustomer(session, store);
      if (session.mode !== 'payment' || session.payment_status === 'unpaid') return;
      await store.upsertOrder({
        checkoutSessionId: session.id,
        sellerAccountId: session.metadata?.seller_account_id ?? '',
        status: 'paid',
      });
      // TODO: fulfill the order (grant access, notify the seller, decrement inventory).
      return;
    }
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object;
      await store.upsertOrder({
        checkoutSessionId: session.id,
        sellerAccountId: session.metadata?.seller_account_id ?? '',
        status: 'failed',
      });
      // TODO: tell the buyer the payment failed and offer to retry.
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      await store.upsertSubscription({
        id: subscription.id,
        customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
        status: subscription.status,
      });
      // TODO: grant or revoke access based on subscription.status.
      return;
    }
    case 'invoice.paid':
      // TODO: extend access for the paid period / mark the invoice paid in your system.
      return;
    case 'invoice.payment_failed':
      // TODO: notify the customer; Stripe retries according to your Billing retry settings.
      return;
    default:
      return;
  }
}

async function rememberCustomer(session: Stripe.Checkout.Session, store: Store) {
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (session.client_reference_id && customerId) {
    await store.saveCustomerId(session.client_reference_id, customerId);
  }
}

/** Thin events (v2): connected account capability changes. */
export async function handleEventNotification(notification: Stripe.V2.Core.EventNotification, store: Store): Promise<void> {
  if (!(await store.markEventProcessed(notification.id))) return;

  switch (notification.type) {
    case 'v2.core.account[configuration.recipient].capability_status_updated':
    case 'v2.core.account[requirements].updated': {
      const account = await notification.fetchRelatedObject();
      const seller = await store.findSellerByAccount(account.id);
      if (!seller) return;
      await store.saveSeller({ ...seller, transfersActive: canReceiveTransfers(account) });
      // TODO: email the seller when requirements are due or transfers become restricted.
      return;
    }
    default:
      return;
  }
}
