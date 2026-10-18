import Stripe from 'stripe';
import type { Config } from './config.js';

export function createStripeClient(config: Config): Stripe {
  // The SDK pins the API version it was generated for (2026-08-26.dahlia in stripe@22.6.0).
  return new Stripe(config.stripeApiKey, {
    appInfo: { name: 'projekt-marketplace' },
  });
}
