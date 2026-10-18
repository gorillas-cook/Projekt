import { api } from './common.js';

const $ = (id) => document.getElementById(id);

async function mountComponents() {
  const { publishableKey } = await api('/api/config');
  const instance = window.StripeConnect.init({
    publishableKey,
    fetchClientSecret: async () => (await api('/api/connect/account-session', { method: 'POST' })).clientSecret,
    locale: 'ru-RU',
  });
  const { transfersActive } = await api('/api/connect/status');
  $('status').textContent = transfersActive ? 'Аккаунт готов к выплатам.' : 'Завершите онбординг, чтобы принимать платежи.';

  $('banner').append(instance.create('notification-banner'));
  if (!transfersActive) {
    const onboarding = instance.create('account-onboarding');
    onboarding.setOnExit(() => location.reload());
    $('onboarding').append(onboarding);
  }
  $('management').append(instance.create('account-management'));
  $('payments').append(instance.create('payments'));
  $('payouts').append(instance.create('payouts'));
}

function whenConnectLoaded(fn) {
  if (window.StripeConnect?.init) return fn();
  window.StripeConnect = window.StripeConnect || {};
  window.StripeConnect.onLoad = fn;
}

async function start() {
  try {
    await api('/api/connect/status');
    whenConnectLoaded(() => mountComponents().catch((e) => ($('error').textContent = e.message)));
  } catch {
    $('create').hidden = false;
  }
}

$('create').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/connect/accounts', { method: 'POST', body: Object.fromEntries(new FormData(event.target)) });
    location.reload();
  } catch (e) {
    $('error').textContent = e.message;
  }
});

start();
