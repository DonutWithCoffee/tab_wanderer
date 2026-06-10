# tab_wanderer — Project Context Contract

Актуально на момент: после `0.9.7 history skeleton` и перед входом в `0.9.8 Observability + Refactor`.

Этот документ заменяет старые `Message 51` и используется как living document для переноса контекста между чатами.

В новом чате использовать этот файл как основной контракт проекта. Если загружен актуальный архив кода, код из архива является источником истины по реализации.

---

## 1. Project Status

Проект: `tab_wanderer`

Назначение: Chrome extension для мониторинга заказов в админке Amperkot.

Текущая стадия:

```text
0.9.5 — Stabilization + Test Hardening ✅
0.9.6 — Deep Collection ✅
0.9.7 — Scope UX + Event/History Foundation ✅ / checkpoint stage
0.9.8 — Observability + Refactor ⏭ next
1.0 — Stable Monitoring Release ⏳
```

Текущая точка:

```text
0.9.7 late stage / transition to 0.9.8
```

Последние завершённые slices:

```text
fix(core): align tracked order state fields
feat(core): add sync reason and coverage metadata foundation
feat(core): add event journal foundation
feat(core): expose event journal for history
feat(history): add history page skeleton
chore(repo): normalize text file line endings
```

Последний подтверждённый тестовый результат:

```text
91 pass 0 fail
```

---

## 2. Product Vision

Плагин решает бизнес-задачи:

```text
1. Отслеживать появление новых заказов
2. Отслеживать изменения известных заказов
3. Делать мониторинг глубже первой страницы
4. Уменьшать шум уведомлений
5. Позволять сотруднику управлять тем, какие заказы отслеживать
6. Позволять сотруднику управлять тем, какие изменения должны уведомлять
7. Сохранять историю изменения заказов
8. Сохранять стабильность при reload/restart браузера
9. В будущем — централизовать сбор событий и добавить отдельные automation/action features
```

Ключевое разделение:

```text
monitorScope
→ какие заказы физически попадают в наблюдение

order event model
→ какие изменения считаются событием

notificationTriggers
→ какие события/изменения создают уведомления
```

Эти модели нельзя смешивать.

---

## 3. Architecture Invariants

Обязательные слои:

```text
core / domain model
rules / notification decision
config
monitorScope
collection policy
sync model
event journal
popup/options/history UI
Chrome runtime edge
```

Жёсткие правила:

```text
UI не источник логики
rules не влияют на сбор данных
notificationTriggers не влияют на state update
scope не смешивается с notificationTriggers
config не содержит runtime state
worker определяется marker + tabId
URL reuse запрещён
partial diff запрещён
baseline/rebaseline не должны создавать notification flood
Chrome APIs держать на краях
новую domain logic постепенно выносить из background.js
```

Всегда выбирать:

```text
deterministic > быстрее
```

---

## 4. Worker Model

Worker tab:

```text
идентификация через marker + tabId
нельзя искать произвольный tab по совпадающему URL
нельзя reuse URL как identity
```

Причина: менеджер может работать в другой admin-tab с таким же URL, и это не worker.

---

## 5. Trusted Snapshot / State Model

Система разделяет:

```text
knownOrdersDB
→ долговременная память обо всех известных заказах

windowOrdersDB
→ текущее наблюдаемое окно заказов
```

Правила:

```text
knownOrdersDB не очищается при baseline/rebaseline
windowOrdersDB может перестраиваться из нового snapshot
partial snapshot не используется для diff
scope/mode change не должен стирать глобальную память известных заказов
```

Baseline/rebaseline:

```text
строит trusted snapshot
обновляет current window
не должен создавать false notification flood
```

---

## 6. Monitor State

Состояния:

```text
uninitialized
warming
active
```

Смысл:

```text
uninitialized → монитор выключен / нет активного наблюдения
warming → worker/baseline/rebaseline phase
active → нормальное сравнение snapshot и запись событий
```

---

## 7. Collection Model

Fast cycle:

```text
page 1
polling каждые 15 секунд
быстро ловит свежие изменения
```

Deep sync:

```text
pagination через ?page=N
до 10 страниц
каждые 5 минут
синхронизирует рабочее окно заказов глубже первой страницы
```

Monitor modes:

```text
windowed:
  fast + deep sync

active:
  page 1 only
  deep sync не запускается
```

Important:

```text
empty page не является обычным stop condition
не останавливаться только из-за встречи известного заказа
```

---

## 8. Event Field Contract

Event fields:

```text
status
delivery
payment
city
tags
```

Только эти поля участвуют в:

```text
event fingerprint
changedFields
history diff
notificationTriggers.changedFields
```

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

Context/search fields могут храниться и отображаться, но не создают события и уведомления.

Ignored/noise fields:

```text
shipmentDateText
hasOrderFlag
user column
```

Причины:

```text
shipmentDateText содержит countdown/noise
hasOrderFlag не нужен текущему поведению
user column не идентифицирует клиента
```

---

## 9. Sync Reason Model

Sync reasons:

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

Зачем:

```text
отличать первый запуск от ручного старта
отличать обычное recovery от stale resume
отличать scope/mode changes
строить корректную историю и diagnostics
готовить будущий catch-up behavior
```

---

## 10. Event Journal

Core file:

```text
core/event-journal.js
```

Journal entry хранит:

```text
orderId
eventType
eventKind
syncReason
changedFields
diff было → стало
order context
prevHash/newHash
monitorMode
monitorScopeSignature
coverage metadata
notification decision
```

Event kinds:

```text
live
catch-up
scope-catch-up
```

Storage/read limits:

```text
stored journal limit: 500
read default limit: 100
```

Runtime access:

```text
GET_EVENT_JOURNAL
```

Фильтры чтения:

```text
orderId
eventType
eventKind
limit
```

---

## 11. History Page

Добавлена минимальная history page skeleton:

```text
history.html
history.js
tests/history-ui.test.js
```

Назначение skeleton:

```text
проверить цепочку eventJournal → GET_EVENT_JOURNAL → UI
показать последние события
показать простой diff было → стало
```

Важно:

```text
не разгонять UI/UX сейчас
детальную полировку history page делать совместно с пользователем в pre-1.0 stage
```

---

## 12. Notification Decision Model

Точка входа:

```text
evaluateNotification(order, eventContext, config)
```

Текущая модель:

```js
notificationTriggers: {
    newOrders: true,
    changedOrders: true,
    changedFields: {
        status: true,
        delivery: true,
        payment: true,
        city: true,
        tags: true
    }
}
```

Правила:

```text
notificationTriggers suppress notification only
DB/hash/window state всегда обновляются
eventJournal пишет события независимо от подавления уведомления
```

Hardcoded production rules for Ozon/Jurics were temporary and should not be preserved as product architecture.

---

## 13. Monitor Scope

Назначение:

```text
monitorScope управляет входным потоком данных
```

Текущие группы:

```text
status[]
delivery[]
payment[]
orderFlags[]
store[]
reserve[]
assemblyStatus[]
predicates
```

Scope change:

```text
назначает syncReason = scope-change
перестраивает наблюдаемое окно
не должен стирать knownOrdersDB
не должен создавать notification flood
```

UX direction:

```text
monitorScope должен быть похож на фильтры админки
```

---

## 14. Popup / Options UX

Popup использует draft/apply/reset модель.

Правила:

```text
изменения UI не отправляют UPDATE_CONFIG сразу
Apply отправляет UPDATE_CONFIG
Reset возвращает current config
dirty state отображается в UI
```

Актуальные UI-блоки:

```text
Monitor Mode
Monitor Scope
Notification Triggers
History navigation
Actions
```

Notification Triggers UI:

```text
Уведомлять о новых заказах
Уведомлять об изменениях заказов
Поля изменений:
  Статус
  Доставка
  Оплата
  Город
  Теги
```

Если `changedOrders = false`:

```text
field controls disabled
checked values сохраняются
при повторном включении changedOrders поля снова enabled
```

---

## 15. Parser Contract

Парсер должен извлекать:

```text
id / internalId
status
delivery
payment
contractor
date / primary date
orderUrl
tags
city
phoneNormalized
totalAmount
productsDone
productsTotal
manager
hasAutoreserve
```

Правила:

```text
date-cell tags отделять от date
shipment countdown noise не включать в event model
phone хранить normalized only
totalAmount хранить numeric only
products progress хранить как productsDone/productsTotal
```

---

## 16. Tests

Тесты фиксируют behavior contract, а не реализацию.

Обязательное правило:

```text
каждый новый behavior → тест
каждый баг → тест
```

Запуск:

```bash
npm test
```

Runner печатает:

```text
N pass 0 fail
```

Перед commit достаточно одного зелёного `npm test` после финальной версии файлов.

Повторный `npm test` нужен только если после зелёного теста были новые правки, merge/rebase/conflict или сомнение в состоянии файлов.

---

## 17. Git Workflow

Работаем через Git Bash в VS Code.

Правила:

```text
не использовать git add .
добавлять файлы явно
коммит = логический behavior/docs slice
не делать микрокоммиты без необходимости
```

Перед commit checkpoint при необходимости:

```bash
git status --short
git diff --name-only
git diff --stat
git diff --check
```

Commit/push после зелёных тестов или docs-only changes:

```bash
git add <explicit files>
git commit -m "type(scope): message"
git push origin main
```

---

## 18. Communication Contract

Стиль:

```text
инженер → инженер
кратко
прямо
без воды
без смягчений
```

Обязательная структура при разработке:

```text
Анализ
Решение
Код
```

Пользователь предпочитает:

```text
готовые полные файлы вместо мелких patch snippets
малые безопасные implementation steps
архитектурные решения от ассистента
русский язык для документации и project contracts
```

Если актуальный код неизвестен:

```text
спросить нужные файлы списком
не угадывать реализацию
```

---

## 19. Roadmap

Основной roadmap вынесен в отдельный файл:

```text
docs/roadmap.md
```

Кратко:

```text
0.9.7 checkpoint docs/smoke test
0.9.8 Observability + Refactor
pre-1.0 UI/UX polish with user
1.0 Stable Monitoring Release
post-1.0 centralized collector / priority direct follow-up / Ozon barcode binding / Firefox fork
```

---

## 20. Current Next Step

После обновления документации:

```text
0.9.8 Step 1 — GET_MONITOR_STATUS / diagnostic snapshot
```

Цель:

```text
read-only monitor status endpoint for diagnostics and smoke tests
```

Ожидаемые поля:

```text
isRunning
monitorState
hasWorkerTab
pendingRebaseline
pendingSyncReason
monitorMode
knownOrdersCount
windowOrdersCount
eventJournalCount
lastBaselineDate
lastDeepSyncAt
lastCollectionMetadata
collectionSession summary
```

Правила:

```text
только чтение
не запускать worker
не менять state
не создавать notifications
```
