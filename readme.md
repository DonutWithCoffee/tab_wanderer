# tab_wanderer

Локальное Chrome Extension для внутренней админки Amperkot. Расширение мониторит заказы, ведёт локальную историю событий, поддерживает отслеживаемые заказы и помогает складу переносить единичные штрихкоды в Ozon.

## Текущее состояние

```text
Публичная стабильная версия: 1.0.3 (Chrome Web Store / Unlisted)
Release commit: f496d36
Annotated tag: v1.0.3
Manifest version в текущей ветке: 1.0.3
Текущая разработка: неопубликованный post-1.0.3 hardening
Tests: 290 pass / 0 fail
```

Текущий `main` новее опубликованной 1.0.3, но версия намеренно не повышена. CWS package для следующего релиза не подготовлен.

## Назначение

Расширение умеет:

- обнаруживать новые заказы и изменения известных заказов;
- быстро проверять первую страницу и периодически выполнять глубокую синхронизацию;
- ограничивать область сбора через `monitorScope`;
- отдельно настраивать события и быстрые фильтры уведомлений;
- хранить локальный журнал событий и диагностический лог;
- вести список отслеживаемых заказов с комментариями, напоминаниями и direct follow-up;
- проверять и записывать подходящие складские штрихкоды в Ozon;
- безопасно применять уже скачанное обновление расширения в момент, когда нет критической операции.

Расширение работает local-first: внешнего backend, analytics, remote code и стороннего облачного хранилища нет.

## Архитектурные инварианты

### Сбор и уведомления разделены

```text
monitorScope
→ какие заказы собираются

order event model
→ какие изменения считаются событием

notificationTriggers
→ какие события создают desktop-уведомление

notificationSuppressors
→ какие категории уведомлений скрываются
```

Фильтры уведомлений не блокируют обновление локального состояния и истории.

### Два цикла мониторинга

```text
Fast poll: первая страница примерно каждые 15 секунд
Deep sync: примерно каждые 5 минут, глубина 1–50 страниц
```

Режимы:

- `windowed` — fast poll + deep sync;
- `active` — только первая страница.

### Worker isolation

Используются отдельные фоновые вкладки:

- основной list worker — `#tab_wanderer_worker=1`;
- direct follow-up — `#tab_wanderer_direct_worker=1`;
- Ozon action worker — `#tab_wanderer_ozon_worker=1`.

Worker определяется сочетанием доверенного origin/path, marker и сохранённого `tabId`. Произвольная вкладка с похожим URL не принимается за worker.

### Отслеживаемые поля событий

Создают событие:

- `status`;
- `delivery`;
- `payment`;
- `city`.

Контекстные поля сами по себе событие не создают:

- contractor;
- phone;
- order date;
- сумма;
- готовность товаров;
- manager.

Теги сохраняются в состоянии и истории, но сами по себе не создают пользовательское уведомление.

## Быстрые фильтры

В popup и Options есть две группы:

```text
Скрывать уведомления:
- ОЗОН
- Юрлица

Уведомлять только:
- Заказы юрлиц
```

Режим «Заказы юрлиц» имеет приоритет: он очищает и блокирует оба hide-фильтра. Ozon-заказ без юридического способа оплаты и так не проходит legal-only режим.

Классификация Ozon и юридических заказов централизована в `notification-rules.js` и используется также при формировании notification tags.

## Warehouse ↔ Ozon

Правило записи:

- добавляются все подходящие единичные штрихкоды;
- `multiBarcodeType` не записывается;
- остальные причины пропуска показываются отдельно;
- успешной запись считается только после подтверждения ожидаемых штрихкодов;
- свежая повторная проверка заменяет устаревшее состояние записи/ошибки;
- частичный результат остаётся retryable и показывает точное количество найденных и отсутствующих штрихкодов.

Запись в Ozon может быть запущена только доверенным пользовательским событием. Синтетический click из page scripts не инициирует write flow.

Ozon network capture ограничен известными endpoints, методами, content type и размером ответа. Warehouse fallback scan имеет лимит времени и выполняется после более дешёвых источников данных.

## Lifecycle и хранение

Service worker использует:

- initialization barrier перед обработкой runtime events;
- сериализованную очередь записей в `chrome.storage.local`;
- `chrome.alarms` для watchdog, direct follow-up и storage maintenance;
- reconciliation фоновых вкладок после перезапуска;
- retention для известных заказов и notification targets;
- диагностику `bytesInUse`, ошибок записи и количества удалённых записей;
- `TRUSTED_CONTEXTS` для ограничения прямого доступа content scripts к storage.

Известные заказы ограничены 5000 записями, при этом текущие, direct-follow-up и watched orders защищены от удаления. Notification targets ограничены 500 элементами и TTL 7 дней.

Скачанное CWS-обновление применяется через `runtime.onUpdateAvailable`. Если активен Ozon/direct/watched-order-add flow, reload откладывается до безопасного момента.

## Permissions

Текущий manifest:

```text
permissions:
- storage
- notifications
- alarms

host_permissions:
- https://amperkot.ru/*
- https://seller.ozon.ru/*
```

Permission `tabs` удалён: используемые операции создания, обновления и закрытия вкладок работают без него, а доступ к нужным URL покрывается host permissions.

## Основные файлы

```text
background.js                     orchestration, lifecycle, storage, workers
content.js                        Amperkot parsing и warehouse UI
notification-rules.js             config normalization и notification classifier
warehouse-barcode-bridge.js       извлечение warehouse runtime data
ozon-product-bridge.js            isolated-world Ozon writer
ozon-product-page-bridge.js       read-only page-world resolver/capture bridge
core/order-model.js               snapshot/hash/change model
core/collection-model.js          fast/deep collection session
core/direct-follow-up.js          direct-check state model
core/event-journal.js             локальная история событий
core/diagnostic-log.js            диагностический журнал и retention
core/warehouse-ozon-view-model.js warehouse/Ozon UI state model
popup.*                           быстрый рабочий пульт
options.*                         настройки и диагностика
watched-orders.*                  отслеживаемые заказы
```

Документы:

```text
docs/chat-handoff.md
docs/project-context.md
docs/roadmap.md
docs/smoke-checklist.md
```

## Проверка

```bash
npm test
```

Дополнительная статическая проверка всех JavaScript-файлов:

```bash
find . -type f -name '*.js' -not -path './.git/*' -print0 | xargs -0 -n1 node --check
```

## Release workflow

1. Получить свежий полный архив актуального HEAD.
2. Провести review и закончить функциональные изменения.
3. Получить зелёный baseline и manual smoke.
4. Только после этого повысить `manifest.json`, `version.js` и release notes.
5. Собрать runtime ZIP без tests/docs/private/dev-файлов.
6. Проверить permissions, host permissions, remote code scan, SHA256 и состав package.
7. Отправить в CWS.
8. Создать annotated tag только после подтверждённой публикации.

Для обычной передачи исходников используется:

```bash
rm -f ../tab_wanderer.zip && git archive --format=zip --output=../tab_wanderer.zip HEAD
```

Полный архив рабочей папки может включать `.git` и локальный `docs/private`; его нельзя передавать как обычный release/source handoff.

## Privacy

Локальные snapshots могут содержать данные заказов, необходимые для работы мониторинга. Они не отправляются разработчику или стороннему серверу расширения.

`docs/private` предназначен только для локальных диагностических образцов, игнорируется Git и не должен попадать в CWS package, публичный репозиторий или обычный архив передачи. Перед сохранением образцов данные следует обезличивать.
