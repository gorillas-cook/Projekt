import Stripe from 'stripe';
import { loadConfig, type Config } from '../src/config.js';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      STRIPE_API_KEY: 'rk_test_dummy',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_dummy',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_v1',
      STRIPE_WEBHOOK_SECRET_V2: 'whsec_test_v2',
      APP_URL: 'http://localhost:4242',
      PLATFORM_FEE_BPS: '1000',
    }),
    ...overrides,
  };
}

/** Real client with a dummy key: used for signing/verification and as a target for vi.spyOn; never hits the network in tests. */
export function testStripe(config: Config) {
  return new Stripe(config.stripeApiKey, { maxNetworkRetries: 0 });
}

export function signedPayload(stripe: Stripe, payload: object, secret: string) {
  const body = JSON.stringify(payload);
  return { body, signature: stripe.webhooks.generateTestHeaderString({ payload: body, secret }) };
}
