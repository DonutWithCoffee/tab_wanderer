# tab_wanderer

Chrome extension для мониторинга заказов в админке Amperkot.

`tab_wanderer` работает как локальный наблюдатель за потоком заказов: собирает snapshot заказов через изолированную worker-вкладку, сравнивает текущее состояние с известным состоянием, пишет события в локальную историю и показывает уведомления по настройкам пользователя.

---

## Текущий статус

```text
Стадия разработки: 0.9.7 late stage / переход к 0.9.8
Manifest version: 0.9.6 до следующего release bump
Следующий этап: 0.9.8 Observability + Refactor
```

Roadmap вынесен в отдельный файл:

```text
docs/roadmap.md
```

---

## Назначение

Плагин отслеживает:

- появление новых заказов;
- изменения известных заказов;
- изменения в рабочем окне заказов глубже первой страницы;
- историю событий заказа в локальном журнале;
- уведомления только по выбранным notification triggers.

---

## Основная модель

Система разделяет сбор данных, события и уведомления.

```text
monitorScope
→ какие заказы физически попадают в наблюдение

order event model
→ какие изменения считаются событием

notificationTriggers
→ какие события создают уведомление
```

Важно: `notificationTriggers` не блокируют обновление состояния и запись истории. Они управляют только показом уведомлений.

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

Система использует два контура сбора:

### Fast poll

```text
каждые 15 секунд
страница 1
быстро ловит свежие изменения
```

### Deep sync

```text
каждые 5 минут
до 10 страниц
pagination через ?page=N
синхронизирует рабочее окно заказов глубже первой страницы
```

Empty page не используется как обычное условие остановки, потому что валидные страницы админки заказов должны содержать хотя бы один заказ.

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

`knownOrdersDB` не должен очищаться при baseline/rebaseline. Scope/mode changes перестраивают текущее окно сравнения, но не стирают глобальную память известных заказов.

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

Только эти поля участвуют в event fingerprint, `changedFields`, history и notification triggers.

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

Это нужно для корректной истории, диагностики и будущего catch-up поведения после долгого простоя.

---

## Event journal / History

В проект добавлен локальный event journal.

Он хранит:

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

Также добавлена минимальная `history.html` skeleton page. Это технический скелет без финальной UI/UX-полировки.

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
  tags
```

При клике на уведомление открывается карточка заказа.

---

## Настройки

В popup/options доступны:

```text
START / STOP
monitorMode
monitorScope
notificationTriggers
history skeleton access
```

`monitorScope` должен быть похож на фильтры админки, чтобы сотрудникам не приходилось учить отдельную модель.

---

## Тесты

Запуск:

```bash
npm test
```

Test runner печатает итоговую строку:

```text
N pass 0 fail
```

Текущий последний подтверждённый результат после history skeleton:

```text
91 pass 0 fail
```

---

## Документация

Основные документы проекта:

```text
readme.md
→ краткое описание текущей версии

docs/project-context.md
→ living contract / замена старых Message 51

docs/roadmap.md
→ roadmap от текущего состояния до 1.0 и post-1.0
```
