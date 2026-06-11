# tab_wanderer — Project Context Contract

Актуально на момент: 0.9.8 observability/refactor checkpoint.

Этот документ заменяет старые `Message 51` и используется как living document для переноса контекста между чатами. Если загружен актуальный архив кода, код из архива является источником истины по реализации.

---

## 1. Project Status

```text
Проект: tab_wanderer
Назначение: Chrome extension для мониторинга заказов в админке Amperkot
Текущая стадия: 0.9.8 Observability + Refactor checkpoint
Manifest version: 0.9.8
```

Roadmap:

```text
0.9.5 — Stabilization + Test Hardening ✅
0.9.6 — Deep Collection ✅
0.9.7 — Scope UX + Event/History Foundation ✅
0.9.8 — Observability + Refactor 🔥 current
Pre-1.0 — UI/UX polish with user ⏳
1.0 — Stable Monitoring Release ⏳
Post-1.0 — centralized collector / priority follow-up / Ozon automation / Firefox fork
```

Последние важные behavior/refactor slices:

```text
feat(core): expose monitor status snapshot
feat(options): show monitor diagnostics snapshot
fix(core): return worker to first page after deep sync
feat(diagnostics): add persistent diagnostic log export
fix(diagnostics): reduce log noise and record deep collection completion
feat(settings): simplify settings UX and configure deep sync depth
feat(notifications): show order change diff
docs(project): sync 0.9.8 checkpoint and deep sync defaults
fix(core): detect manual start catch-up changes
refactor(diagnostics): reduce background log responsibilities
fix(core): complete deep sync from pagination state
fix(diagnostics): export full retained log
test(core): lock runtime sync consistency
refactor(core): extract collection session model
refactor(core): extract runtime response helpers
```

Текущий тестовый checkpoint:

```text
127 pass 0 fail
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
8. Давать диагностический лог для удалённой поддержки
9. Сохранять стабильность при reload/restart браузера
10. В будущем — централизовать сбор событий и добавить отдельные automation/action features
```

Ключевое разделение:

```text
monitorScope
→ какие заказы физически попадают в наблюдение

order event model
→ какие изменения считаются событием и пишутся в историю

notificationTriggers
→ какие события/изменения создают пользовательские уведомления
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
diagnostic log
notification message model
runtime API response model
popup/options/history UI
Chrome runtime edge
```

Жёсткие правила:

```text
UI не источник логики
rules не влияют на сбор данных
notificationTriggers не влияют на state update
notificationTriggers не влияют на eventJournal/history
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

После deep sync worker обязан вернуться на page 1, иначе fast cycle может смотреть старую глубокую страницу вместо свежих заказов.

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
scope/mode/depth change не должен стирать глобальную память известных заказов
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
каждые 5 минут
настраиваемый лимит deepSyncMaxPages
safe range: 1–50 страниц
default: 50 страниц / около 1500 заказов
```

Ручная проверка показала:

```text
30 страниц / 900 заказов ≈ 18 секунд
50 страниц / 1500 заказов ≈ 30–35 секунд
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
не останавливаться только из-за встречи известного заказа
после deep session всегда возвращать worker на page 1
deep sync завершается по pagination-last-page, empty-first-page или max-pages
empty page не является обычным stop condition для валидной глубокой страницы
empty first page при выбранном scope = корректное завершение без timeout
```

Collection/session pure logic вынесена в:

```text
core/collection-model.js
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

Эти поля участвуют в:

```text
event fingerprint
changedFields
history diff
eventJournal
future search/filtering
```

Notification fields:

```text
status
delivery
payment
city
```

Важно:

```text
tags остаются event/history/search data
tags не показываются в уведомлениях
tag-only changes не создают уведомления
если изменились status + tags, уведомление показывает только status
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

Pending sync action:

```text
manual-start + known DB → catch-up
initial / recovery / stale-resume / scope-change / mode-change → baseline
```

Зачем:

```text
отличать первый запуск от ручного старта
отличать обычное recovery от stale resume
отличать scope/mode/depth changes
строить корректную историю и diagnostics
manual-start с known DB запускать как catch-up
recovery/stale-resume/scope-change/mode-change оставлять safe baseline без notification flood
```

---

## 10. Event Journal / History

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

Runtime access:

```text
GET_EVENT_JOURNAL
```

History page:

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

History UI пока skeleton. Полировка переносится в pre-1.0 UI/UX stage.

---

## 11. Notification Decision / Message Model

Точка входа:

```text
evaluateNotification(order, eventContext, config)
```

Config:

```js
notificationTriggers: {
    newOrders: true,
    changedOrders: true,
    changedFields: {
        status: true,
        delivery: true,
        payment: true,
        city: true
    }
}
```

Правила:

```text
notificationTriggers suppress notification only
DB/hash/window state всегда обновляются
eventJournal пишет события независимо от подавления уведомления
```

Уведомления:

```text
new-order → компактное текущее состояние
order-changed → diff было → стало по notification fields
```

Пример:

```text
Статус: Новый → Ожидает оплаты
Доставка: Самовывоз → Курьер СДЭК
```

Tags не попадают в notification surface.

---

## 12. Diagnostic Log

Core file:

```text
core/diagnostic-log.js
```

Runtime response helpers:

```text
core/runtime-api.js
```

Назначение:

```text
удалённая поддержка без DevTools
работник скачивает .txt и отправляет разработчику
```

Runtime access:

```text
GET_DIAGNOSTIC_LOG preview → последние 100 entries
GET_DIAGNOSTIC_LOG full → весь retained log
CLEAR_DIAGNOSTIC_LOG
```

UI:

```text
popup → Download diagnostic log
options → diagnostic log details/dropdown внизу страницы
preview/copy → preview
download/export → full retained log
```

Retention policy:

```text
preview limit = 100 entries
max retained entries = 5000
max retained bytes = 2_000_000
diagnosticLogDroppedEntries хранит число удалённых старых entries
export header показывает retained/exported/dropped counts
```

Persistent log пишет INFO/WARN/ERROR, но не пишет шумный fast PROCESS каждые 15 секунд.

В лог пишутся:

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

Popup — quick-control only:

```text
Start / Stop одной кнопкой
Open settings
Open history
Download diagnostic log
```

Popup не должен быть тяжёлой формой настроек.

Options — settings editor + diagnostics:

```text
monitorMode autosave
deepSyncMaxPages autosave
notificationTriggers autosave
monitor diagnostics read-only
diagnostic log tools under details/dropdown
```

Save status:

```text
Загрузка настроек...
Сохраняем...
Сохранено
Ошибка сохранения
```

Текущий UI функциональный, но не финальный. Пользователь не удовлетворён текущей читаемостью/красотой. Полировка popup/options/diagnostics/history — отдельный pre-1.0 stage.

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

Текущий checkpoint:

```text
127 pass 0 fail
```

Перед commit достаточно одного зелёного `npm test` после финальной версии файлов.

---

## 17. Git Workflow

Работаем через Git Bash в VS Code.

Правила:

```text
не использовать git add .
добавлять файлы явно
коммит = логический behavior/docs slice
не делать микрокоммиты без необходимости
группировать core + API + UI + tests, если это одна пользовательская возможность
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
но без микрокоммитов
архитектурные решения от ассистента
русский язык для документации и project contracts
```

Если актуальный код неизвестен:

```text
спросить нужные файлы списком или свежий архив
не угадывать реализацию
```

---

## 19. Current Next Step

После этого checkpoint:

```text
0.9.8 manual smoke / release-readiness checkpoint
```

Отложенные manual smoke checks:

```text
manual START catch-up: STOP → change known order → START → notification diff
scope with 1–3 pages: deep sync completes by pagination-last-page
scope with 0 orders: completes by empty-first-page without timeout
diagnostic export: full retained log, not preview-only
diagnostic retention: export header shows retained/dropped metadata
worker returns to page 1 after deep sync
```

Вероятные следующие работы:

```text
status/log wording consistency
storage/state migration sanity check
0.9.8 release notes / tag decision
pre-1.0 UI/UX polish planning
manual browser QA checklist
```
