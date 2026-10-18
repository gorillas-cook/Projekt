/**
 * Persistence boundary. The in-memory implementation is for local development only:
 * replace it with your database before deploying (state is lost on restart, and
 * webhook deduplication must survive restarts and multiple instances).
 */
export interface Seller {
  /** Your user id of the seller. */
  userId: string;
  stripeAccountId: string;
  /** Cached from v2 account events; always re-check live before charging. */
  transfersActive: boolean;
}

export interface Order {
  checkoutSessionId: string;
  sellerAccountId: string;
  status: 'paid' | 'failed';
}

export interface SubscriptionRecord {
  id: string;
  customerId: string;
  status: string;
}

export interface Store {
  getSeller(userId: string): Promise<Seller | undefined>;
  findSellerByAccount(stripeAccountId: string): Promise<Seller | undefined>;
  saveSeller(seller: Seller): Promise<void>;
  getCustomerId(userId: string): Promise<string | undefined>;
  saveCustomerId(userId: string, customerId: string): Promise<void>;
  /** Returns false if the event was already processed (Stripe retries deliveries). */
  markEventProcessed(eventId: string): Promise<boolean>;
  upsertOrder(order: Order): Promise<void>;
  upsertSubscription(subscription: SubscriptionRecord): Promise<void>;
}

export class InMemoryStore implements Store {
  private sellers = new Map<string, Seller>();
  private customers = new Map<string, string>();
  private events = new Set<string>();
  readonly orders = new Map<string, Order>();
  readonly subscriptions = new Map<string, SubscriptionRecord>();

  async getSeller(userId: string) {
    return this.sellers.get(userId);
  }

  async findSellerByAccount(stripeAccountId: string) {
    return [...this.sellers.values()].find((s) => s.stripeAccountId === stripeAccountId);
  }

  async saveSeller(seller: Seller) {
    this.sellers.set(seller.userId, seller);
  }

  async getCustomerId(userId: string) {
    return this.customers.get(userId);
  }

  async saveCustomerId(userId: string, customerId: string) {
    this.customers.set(userId, customerId);
  }

  async markEventProcessed(eventId: string) {
    if (this.events.has(eventId)) return false;
    this.events.add(eventId);
    return true;
  }

  async upsertOrder(order: Order) {
    this.orders.set(order.checkoutSessionId, order);
  }

  async upsertSubscription(subscription: SubscriptionRecord) {
    this.subscriptions.set(subscription.id, subscription);
  }
}
