# tab_wanderer

Chrome extension для мониторинга заказов в админке Amperkot.

`tab_wanderer` работает как локальный наблюдатель за потоком заказов: собирает snapshot заказов через изолированную worker-вкладку, сравнивает текущее состояние с известным состоянием, пишет события в локальную историю и показывает уведомления по настройкам пользователя.

---

## Текущий статус

```text
Стадия разработки: 0.9.8 Observability + Refactor checkpoint
Manifest version: 0.9.8
Текущий фокус: runtime consistency, support diagnostics, безопасный refactor, подготовка к pre-1.0 UI/UX polish
```

Roadmap:

```text
docs/roadmap.md
```

Project contract:

```text
docs/project-context.md
```

---

## Назначение

Плагин отслеживает:

- появление новых заказов;
- изменения известных заказов;
- изменения в рабочем окне заказов глубже первой страницы;
- историю событий заказа в локальном журнале;
- уведомления только по выбранным notification triggers;
- диагностическое состояние и локальный диагностический лог для поддержки.

---

## Основная модель

Система разделяет сбор данных, события и уведомления.

```text
monitorScope
→ какие заказы физически попадают в наблюдение

order event model
→ какие изменения считаются событием и пишутся в историю

notificationTriggers
→ какие события создают пользовательское уведомление
```

`notificationTriggers` не блокируют обновление состояния и запись истории. Они управляют только показом уведомлений.

---

## Worker tab

Мониторинг выполняется через отдельную worker-вкладку.

Правила:

```text
worker определяется marker + tabId
URL reuse запрещён
нельзя брать произвольную admin-вкладку с похожим URL
```

Это нужно потому, что менеджер может работать в другой вкладке админки с тем же URL.

---

## Collection model

Система использует два контура сбора.

### Fast poll

```text
каждые 15 секунд
страница 1
быстро ловит свежие изменения
```

### Deep sync

```text
каждые 5 минут
pagination через ?page=N
по умолчанию до 50 страниц / около 1500 заказов
настраиваемый безопасный диапазон: 1–50 страниц
```

По ручной проверке 50 страниц собираются примерно за 30–35 секунд и после deep session worker возвращается на page 1.

Deep sync завершается по явной pagination-информации:

```text
pagination-last-page
empty-first-page для scope без заказов
max-pages, если страницы ещё доступны
```

Empty page не используется как обычное условие остановки для валидной глубокой страницы, но пустая первая страница при выбранном scope считается корректным завершением: в этой области сейчас нет заказов.

---

## Monitor modes

```text
windowed
→ page 1 fast poll + периодический deep sync

active
→ page 1 only, без deep sync
```

---

## State model

Система хранит две разные модели состояния:

```text
knownOrdersDB
→ долговременная память всех известных заказов

windowOrdersDB
→ текущее наблюдаемое окно заказов
```

`knownOrdersDB` не очищается при baseline/rebaseline. Scope/mode/depth changes перестраивают текущее окно сравнения, но не стирают глобальную память известных заказов.

---

## Core modules

0.9.8 постепенно разгружает `background.js` и переносит pure/domain logic в core:

```text
core/order-model.js
core/sync-model.js
core/collection-model.js
core/event-journal.js
core/monitor-status.js
core/diagnostic-log.js
core/notification-message.js
core/runtime-api.js
```

Chrome APIs остаются на runtime edge.

---

## Event model

Event fields:

```text
status
delivery
payment
city
tags
```

Эти поля участвуют в event fingerprint, `changedFields`, history и eventJournal.

Context/search fields:

```text
id
internalId
orderUrl
date
phoneNormalized
totalAmount
productsDone
productsTotal
manager
contractor
hasAutoreserve
```

Эти поля могут храниться для контекста, поиска и отображения, но не создают события и уведомления.

Важно про tags:

```text
tags парсятся и хранятся для history/search
изменения tags пишутся в eventJournal/history
tags не показываются в пользовательских уведомлениях
tag-only changes не создают уведомления
```

---

## Sync reasons

Система различает причины синхронизации:

```text
initial
manual-start
recovery
stale-resume
scope-change
mode-change
window-sync
normal
```

Это нужно для корректной истории, диагностики и catch-up поведения после ручного старта.

---

## Event journal / History

Локальный event journal хранит:

```text
orderId
eventType
eventKind
syncReason
changedFields
diff было → стало
order context
notification decision
coverage metadata
```

Доступ к журналу:

```text
GET_EVENT_JOURNAL
```

Добавлена минимальная `history.html` skeleton page. Это технический скелет без финальной UI/UX-полировки.

---

## Уведомления

Уведомления создаются для событий, которые прошли notification decision model.

Текущие trigger-группы:

```text
newOrders
changedOrders
changedFields:
  status
  delivery
  payment
  city
```

`tags` не входят в notification triggers.

Для новых заказов уведомление показывает компактное текущее состояние:

```text
Статус: Новый
Доставка: Самовывоз
Оплата: ...
```

Для изменений уведомление показывает diff `было → стало`:

```text
Статус: Новый → Ожидает оплаты
Доставка: Самовывоз → Курьер СДЭК
```

Context-only поля и чувствительные данные в уведомления не попадают.

При клике на уведомление открывается карточка заказа.

---

## Diagnostic log

В 0.9.8 добавлен локальный диагностический лог с retention policy и полным export сохранённого лога.

Назначение:

```text
удалённая поддержка без DevTools
работник может скачать .txt и отправить лог разработчику
```

Доступ:

```text
GET_DIAGNOSTIC_LOG preview → последние 100 записей
GET_DIAGNOSTIC_LOG full → весь retained log
CLEAR_DIAGNOSTIC_LOG
```

В UI:

```text
popup → быстрая кнопка Download diagnostic log
options → подробный блок диагностического лога внизу страницы под details/dropdown
preview/copy → короткий preview
download/export → полный retained log
```

Retention:

```text
preview limit: 100 entries
max retained entries: 5000
max retained bytes: 2_000_000
dropped old entries counter сохраняется и показывается в export header
```

В лог пишутся технические события:

```text
START / STOP
worker created/adopted/restarted
baseline/rebaseline/recovery
deep collection completed
state changes
notification decisions
WARN/ERROR
```

В лог не должны попадать:

```text
телефоны
полный payload заказа
HTML/DOM
cookie/token/auth данные
```

---

## UI model

Popup — быстрый пульт:

```text
Start / Stop одной кнопкой
Open settings
Open history
Download diagnostic log
```

Options — страница настроек и диагностики:

```text
monitorMode autosave
deepSyncMaxPages autosave
notificationTriggers autosave
monitor diagnostics read-only
diagnostic log tools
```

Текущий UI — функциональный скелет. Финальная читаемость, группировка, wording и внешний вид переносятся в pre-1.0 UI/UX polish stage.

---

## Тесты

Запуск:

```bash
npm test
```

Runner печатает итог:

```text
N pass 0 fail
```

Текущий checkpoint:

```text
127 pass 0 fail
```

---

## Release direction

Перед 1.0 нужно:

```text
закрыть финальные 0.9.8 manual smoke checks
зафиксировать release notes / tag для 0.9.8 при необходимости
сделать pre-1.0 UI/UX polish вместе с пользователем
провести manual browser QA
подготовить stable local-first Chrome extension 1.0 release
```
