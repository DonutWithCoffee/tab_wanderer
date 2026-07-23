# tab_wanderer — Project Context

## Product

`tab_wanderer` — local-first Chrome Extension для внутреннего рабочего процесса Amperkot. Оно не является официальным продуктом Amperkot или Ozon и не использует внешний backend.

Главные сценарии:

1. Мониторинг новых заказов и изменений.
2. Отслеживаемые заказы с прямыми проверками, комментариями и напоминаниями.
3. Warehouse → Ozon barcode helper.
4. Локальная диагностика для поддержки.

## Release state

```text
1.0.0 published
1.0.1 published
1.0.2 published
1.0.3 published and tagged v1.0.3
Current code: unpublished post-1.0.3 hardening + order-aware Ozon automation
Manifest remains 1.0.3
Automated baseline: 322 pass / 0 fail
```

## Monitoring model

### State layers

```text
knownOrdersDB / knownOrdersHashDB
→ долговременное известное состояние

windowOrdersDB / windowOrdersHashDB
→ последнее покрытое рабочее окно

collectionSession
→ временный fast/deep сбор нескольких страниц

eventJournal
→ локальные события

diagnosticLog
→ локальная техническая диагностика

orderKindsDB
→ краткоживущая классификация ozon / regular / unknown по номеру заказа
```

### Fast/deep policy

- Fast poll: page 1 примерно каждые 15 секунд.
- Deep sync: примерно каждые 5 минут.
- Configurable maximum: 1–50 pages.
- `active`: только fast.
- `windowed`: fast + deep.

Основной worker после deep sync возвращается на page 1.

### Startup and recovery

Service worker не полагается на сохранность глобальных переменных. Все runtime/tab/alarm/notification/update events проходят через initialization barrier.

На startup:

1. Ограничивается storage access.
2. Загружается и нормализуется state.
3. Применяется retention.
4. Ищутся marked worker tabs.
5. Один корректный main worker может быть принят повторно.
6. Duplicate main, direct и Ozon orphan tabs удаляются.
7. Восстанавливаются alarms/reminders.
8. При необходимости создаётся main worker.

Lifecycle-critical периодика работает через `chrome.alarms`, а не через `setInterval` service worker.

## Storage model

Все state/diagnostic writes проходят через одну сериализованную очередь. Повторные state saves объединяются, а после активной записи сохраняется самый новый snapshot.

Retention:

```text
known orders: max 5000
notification targets: max 500, TTL 7 days
order kinds: max 500, TTL 24 hours
watched/current/direct orders: protected
journals: own count/byte retention
```

Options diagnostics показывают:

- bytes in use;
- последнюю storage error;
- время проверки/успешной записи;
- количество удалённых known orders и notification targets;
- количество сохранённых классификаций заказов.

`chrome.storage.local` ограничен `TRUSTED_CONTEXTS`, поэтому page content scripts не получают прямой API-доступ к локальной базе расширения.

## Security boundaries

### Trusted URLs

- Order URL строится из валидного order ID.
- Protocol должен быть `https:`.
- Host Amperkot должен быть ровно `amperkot.ru`.
- Worker marker принимается только на ожидаемом origin/path.
- Warehouse/Ozon request принимается только от `https://amperkot.ru/web-apps/wh3/...`.
- Notification click повторно строит canonical URL, а не доверяет сохранённой строке.
- Наблюдение типа заказа принимается от обычной вкладки менеджера только при точном `/admin/orders/<id>/` и совпадении sender URL с payload order ID.
- Warehouse читает тип только для order ID из собственного доверенного hash URL.

### Ozon write

Preview/check не изменяет данные. Write flow требует `event.isTrusted === true` в content script. Синтетический click из page context блокируется.

Background дополнительно связывает Ozon session с ожидаемыми warehouse/Ozon tab IDs и product IDs.

### Order-aware automatic write

Открытая менеджером карточка сообщает background только компактные ограниченные поля:

```text
orderId
source
contractor
ozonShipActionUrl
pageComplete
```

Background валидирует URL и сохраняет в `orderKindsDB` только итоговый тип, reason, timestamps и три boolean evidence-флага. Личные данные и содержимое заказа в эту базу не копируются.

Классификация:

- `ozon`: полная карточка, точный источник `OZON` и доверенная `/ozon/<seller>/posting/fbs/ship` ссылка того же заказа;
- `regular`: полная карточка без Ozon-маркеров;
- `unknown`: отсутствующая, просроченная, частичная или конфликтующая информация.

Свежий `unknown` не затирает подтверждённый тип. `regular` не понижает ещё действующий `ozon`.

Warehouse UI использует тип только для начального состояния и автоматики:

- Ozon раскрывает панель;
- regular/unknown оставляет её свернутой;
- пользовательское ручное состояние сохраняется до смены заказа;
- неизвестный тип показывает `Тип не определён — обновите карточку заказа`;
- manual preview/check/write доступен всегда.

При включённой настройке trusted click по активной кнопке с Angular-маркером `ng-click="$ctrl.confirm()"` создаёт одноразовый `actionId`. Видимый текст кнопки и префикс склада не участвуют в разрешении автоматики. Automatic apply запускается только после свежего успешного snapshot того же заказа с подходящими штрихкодами. Background повторно проверяет подтверждённый тип Ozon и включённую настройку `ozonAutoBarcodeApplyEnabled`. Выключение настройки очищает pending intents, но не блокирует ручной flow. Неуспешные Warehouse API responses и синтетические события не запускают запись.

### Remote code

- Нет удалённых script imports.
- Нет `eval`/`new Function`.
- Нет runtime dependency download.
- Page bridges поставляются внутри extension package.

## Notification model

События и уведомления разделены. Suppressed event всё равно обновляет state и journal.

Legal/Ozon classifier централизован:

- юридическое лицо определяется по нормализованной оплате и tags;
- Ozon определяется по contractor/tags с границами слова;
- notification tags используют тот же classifier.

Legal-only mode является верхнеуровневым режимом и выключает оба hide suppressors.

## Warehouse extraction

Приоритет источников:

1. Captured warehouse API response.
2. Visible DOM.
3. Budgeted Angular/object-graph fallback.

Fallback ограничен числом scopes/objects и time budget, чтобы не блокировать main thread тяжёлой страницы.

## Ozon bridge

Ozon integration разделена на два контекста:

- `ozon-product-page-bridge.js` — read-only resolver и network capture в page world;
- `ozon-product-bridge.js` — writer в isolated world, недоступный page scripts.

Network capture перехватывает только:

```text
/api/v1/products/list-by-filter
/api/sc/barcode-details-by-item-id
```

До `clone().json()` проверяются method, endpoint, content type и content length. XHR listener не устанавливается для посторонних запросов.

Write endpoint:

```text
POST /api/barcode-add-v2
{ seller_id, barcodes: [{ barcode, item_id }] }
```

Verification учитывает read-after-write lag и использует API/drawer polling.

## UI

### Popup

- Start/Stop.
- Monitor status.
- Add watched order by full ID.
- Open watched orders.
- Quick notification filters.
- Options.
- Diagnostic log download.
- Versioned release notes.

### Options

- Monitor mode.
- Scope.
- Deep sync depth.
- Notification triggers/suppressors.
- Diagnostics and log tools.

### Watched orders

- List/add/remove.
- Direct follow-up toggle.
- Comments.
- One-time reminders.
- Follow-up interval.

## Permissions

```text
storage
notifications
alarms
```

Host permissions:

```text
https://amperkot.ru/*
https://seller.ozon.ru/*
```

`tabs` is intentionally absent after least-privilege review.

## Development workflow

- Windows + VS Code + Git Bash.
- No `git add .`.
- Full replacement ZIP preferred.
- Tests green before commit.
- Exact paths in stage commands.
- Conventional Commits.
- Version/CWS package only after functionality and smoke are complete.
