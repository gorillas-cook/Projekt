# Маркетплейс на Stripe — каркас

Node.js (Express 5 + TypeScript) каркас маркетплейса на Stripe:

| Продукт | Что реализовано |
| --- | --- |
| **Connect** | Продавцы — аккаунты **Accounts v2** (`/v2/core/accounts`) с конфигурацией `recipient`, дашборд `express`, комиссии и убытки на платформе. Онбординг и кабинет через встроенные компоненты (`account_onboarding`, `notification_banner`, `account_management`, `payments`, `payouts`). |
| **Payments** | Checkout Sessions, destination charges: деньги автоматически уходят продавцу, платформа удерживает `application_fee_amount`. |
| **Billing** | Подписки через Checkout (`mode: 'subscription'`) с `application_fee_percent` и `transfer_data`; Customer Portal для покупателей. |
| **Invoicing** | Продавец выставляет счёт покупателю; оплата на странице счёта Stripe, деньги — продавцу, комиссия — платформе. |
| **Tax** | `automatic_tax` с ответственностью платформы (`liability: self`) — включается флагом `STRIPE_TAX_ENABLED` только после настройки (см. ниже). |

## Запуск

```bash
npm install
cp .env.example .env      # заполните ключи тестового режима
npm run dev               # http://localhost:4242
npm test                  # офлайн-тесты, без обращений к Stripe
npm run typecheck
```

Локальная доставка вебхуков через Stripe CLI:

```bash
stripe listen --forward-to localhost:4242/webhooks/stripe \
  --forward-thin-to localhost:4242/webhooks/stripe-v2 \
  --thin-events 'v2.core.account[configuration.recipient].capability_status_updated,v2.core.account[requirements].updated'
```

`stripe listen` печатает signing secret — его в `STRIPE_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET_V2`.

## Ключи и безопасность

- Используйте **restricted API key** (`rk_…`), а не `sk_…`. Минимальные права: Checkout Sessions, Prices (read), Customers, Invoices, Invoice Items, Customer Portal, Connect: Accounts (v2) и Account Sessions.
- Ключи — только в `.env` локально и в хранилище секретов в продакшене. `.env` в `.gitignore`; хук `.githooks/pre-commit` (подключается `npm install`) блокирует коммит с `sk_`/`rk_`/`whsec_`.
- Подпись каждого вебхука проверяется; события дедуплицируются по `id`.

## Вебхуки (обязательны)

Snapshot-destination → `/webhooks/stripe`:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`.

Thin-destination (события v2) → `/webhooks/stripe-v2`:
`v2.core.account[configuration.recipient].capability_status_updated`, `v2.core.account[requirements].updated`.

Выдача заказа происходит только в обработчике вебхуков, не на странице `success.html`.

## Цены продавцов

Цены создаются на аккаунте платформы. Каждой цене продавца нужен `metadata.seller_user_id` — сервер проверяет его, чтобы покупатель не оплатил товар одного продавца в пользу другого.

## Stripe Tax — перед включением

1. Dashboard → Tax → Settings: адрес головного офиса (иначе статус `pending` и налог не считается).
2. Dashboard → Tax → Locations: регистрация в каждой юрисдикции, где вы **уже** зарегистрированы как плательщик. Без активной регистрации `automatic_tax` молча собирает 0.
3. На продуктах — налоговый код из [списка Stripe](https://docs.stripe.com/tax/tax-codes.md), на ценах — `tax_behavior`.
4. `STRIPE_TAX_ENABLED=true`, затем тестовый платёж и проверка `taxability_reason` (не должно быть `not_collecting`).

При destination charges продавцом (merchant of record) обычно является платформа, поэтому налог собирает она. Это юридический вопрос — подтвердите с налоговым консультантом.

## Что заменить перед продакшеном

- `src/auth.ts` — заглушка аутентификации (в продакшене отвечает 501 на всё).
- `src/store.ts` — хранилище в памяти → ваша БД (включая дедупликацию событий).
- `TODO` в `src/webhooks.ts` — выдача заказа, доступ по подписке, уведомления.
- [Go-live checklist](https://docs.stripe.com/get-started/checklist/go-live.md) Stripe.
