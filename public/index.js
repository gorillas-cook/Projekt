import { api } from './common.js';

const error = document.getElementById('error');
const show = (e) => (error.textContent = e.message);

document.getElementById('buy').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const sellerUserId = form.get('sellerUserId');
  const priceId = form.get('priceId');
  try {
    const { url } = form.get('subscription')
      ? await api('/api/subscriptions/checkout', { method: 'POST', body: { sellerUserId, priceId } })
      : await api('/api/checkout', { method: 'POST', body: { sellerUserId, items: [{ priceId, quantity: 1 }] } });
    location.href = url;
  } catch (e) {
    show(e);
  }
});

document.getElementById('portal').addEventListener('click', async () => {
  try {
    location.href = (await api('/api/billing/portal', { method: 'POST' })).url;
  } catch (e) {
    show(e);
  }
});
