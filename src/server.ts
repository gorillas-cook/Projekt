import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createStripeClient } from './stripe.js';
import { InMemoryStore } from './store.js';

const config = loadConfig();
const app = createApp({ config, stripe: createStripeClient(config), store: new InMemoryStore() });
const port = Number(process.env.PORT ?? 4242);
app.listen(port, () => console.log(`Listening on ${config.appUrl} (port ${port})`));
