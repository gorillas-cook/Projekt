import 'dotenv/config';

export interface Config {
  stripeApiKey: string;
  stripePublishableKey: string;
  /** Signing secret of the snapshot-event destination (/webhooks/stripe). */
  webhookSecret: string;
  /** Signing secret of the thin-event destination for v2 account events (/webhooks/stripe-v2). */
  webhookSecretV2: string;
  appUrl: string;
  /** Platform commission in basis points (1000 = 10%). */
  platformFeeBps: number;
  /**
   * Enable only after a head office address is set and at least one registration is active.
   * Without an active registration Stripe Tax silently collects 0 tax.
   */
  taxEnabled: boolean;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const read = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };
  const stripeApiKey = read('STRIPE_API_KEY');
  if (/^sk_/.test(stripeApiKey)) {
    console.warn('STRIPE_API_KEY is a secret key (sk_). Prefer a restricted key (rk_) with minimal permissions.');
  }
  const platformFeeBps = Number(env.PLATFORM_FEE_BPS ?? '1000');
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10000) {
    throw new Error('PLATFORM_FEE_BPS must be an integer between 0 and 10000');
  }
  return {
    stripeApiKey,
    stripePublishableKey: read('STRIPE_PUBLISHABLE_KEY'),
    webhookSecret: read('STRIPE_WEBHOOK_SECRET'),
    webhookSecretV2: read('STRIPE_WEBHOOK_SECRET_V2'),
    appUrl: env.APP_URL ?? 'http://localhost:4242',
    platformFeeBps,
    taxEnabled: env.STRIPE_TAX_ENABLED === 'true',
    isProduction: env.NODE_ENV === 'production',
  };
}
