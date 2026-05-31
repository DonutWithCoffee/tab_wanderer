# tab_wanderer — Project Context Contract

Актуально на момент: после `0.9.7.6 / Step 2`.

Этот документ заменяет старый `Message 51` и используется как living document для переноса контекста между чатами.

В новом чате использовать этот файл как основной контракт проекта. Если загружен актуальный архив кода, код из архива является источником истины по реализации.

---

## 1. Project Status

Проект: `tab_wanderer`

Назначение: Chrome extension для мониторинга заказов в админке Amperkot.

Текущая стадия:

```text
0.9.5 — Stabilization + Test Hardening ✅
0.9.6 — Deep Collection ✅
0.9.7 — Scope UX + Event/Notification Model 🔥
```

Текущая точка:

```text
0.9.7.6 / Step 2 ✅
Notification Triggers UI добавлен
Changed field controls отключаются, когда changedOrders выключен
```

Последние коммиты:

```text
4b27522 fix(popup): disable changed field controls when changes are off
dbb57b6 feat(popup): add notification trigger controls
4501f6d refactor(rules): remove hardcoded notification presets
edee8b2 test(core): cover notification trigger state updates
23e4517 feat(rules): apply notification trigger settings
8c1dec2 feat(config): add notification trigger defaults
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
7. Сохранять стабильность при reload/restart браузера
8. В будущем — автоматизировать отдельные действия, включая Ozon barcode binding
```

Ключевое разделение:

```text
monitorScope
→ какие заказы попадают в наблюдение

notificationTriggers
→ какие события/изменения создают уведомления
```

Это две разные модели. Их нельзя смешивать.

---

## 3. Architecture Invariants

Обязательные слои:

```text
core
rules / notification decision
config
monitorScope
collection policy
popup UX
```

Жёсткие правила:

```text
UI не источник логики
rules не влияют на сбор данных
scope не смешивается с notificationTriggers
config не содержит runtime state
worker определяется marker + tabId
URL reuse запрещён
partial diff запрещён
events вне active запрещены
baseline/rebaseline/recovery не генерируют events
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

Причина: в другом admin-tab может быть такой же URL, и это не worker.

---

## 5. Trusted Snapshot Model

Истина системы:

```text
разница между двумя полными trusted snapshots
```

Правила:

```text
baseline только из полного snapshot
partial snapshot не используется для diff
baseline не генерирует events
rebaseline не генерирует events
recovery не генерирует events
active monitoring генерирует events
```

---

## 6. Monitor State

Состояния:

```text
uninitialized
warming
active
```

Правила:

```text
warming → baseline phase
active → events разрешены
вне active events запрещены
```

---

## 7. Baseline Model

Типы baseline:

```text
initial baseline
rebaseline
deep baseline
recovery baseline
```

Правила:

```text
baseline = полный snapshot
baseline не уведомляет
baseline обновляет DB/hash/window state
```

---

## 8. Collection Model

Режимы:

```text
fast cycle
deep sync
```

Fast cycle:

```text
page 1
быстрый polling
```

Deep sync:

```text
pagination через ?page=N
до лимита страниц
используется для full-depth monitoring
```

Текущая модель:

```text
windowed mode:
  fast + deep sync

active mode:
  page 1 only
  deep sync не запускается
```

---

## 9. Event Model

Актуальная модель:

```text
events зависят от phase, а не от fast/deep
```

Не генерируют events:

```text
initial baseline
rebaseline
recovery
warming phase
```

Генерируют events:

```text
fast cycle в active
deep sync в active
```

Event context:

```text
eventType:
  new-order
  order-changed

changedFields:
  status
  delivery
  payment
  contractor
  date
  shipmentDateText
  hasOrderFlag
  hasAutoreserve
  tags
```

---

## 10. Notification Decision Model

Точка входа:

```text
evaluateNotification(order, eventContext, config)
```

Старая hardcoded rules-engine модель удалена.

Удалено:

```text
DEFAULT_CONFIG.rules
NOTIFICATION_IGNORE_RULES
ignoreOzon
ignoreJurics
ignoreLegalEntityBankTransfer
hardcoded notification presets
```

Текущая модель:

```text
notificationTriggers
```

Структура:

```js
notificationTriggers: {
    newOrders: true,
    changedOrders: true,
    changedFields: {
        status: true,
        delivery: true,
        payment: true,
        contractor: false,
        date: false,
        shipmentDateText: true,
        hasOrderFlag: true,
        hasAutoreserve: true,
        tags: true
    }
}
```

Правило:

```text
notificationTriggers suppress notification only
DB/hash/window state всегда обновляются
```

---

## 11. Monitor Scope

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
predicates:
  ozonOnly
  juridicalOnly
```

Scope change:

```text
вызывает rebaseline
блокирует events на rebaseline phase
```

---

## 12. Popup UX

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
  Дата отгрузки
  Флаг заказа
  Авторезерв
  Теги
```

Если `changedOrders = false`:

```text
field controls disabled
checked values сохраняются
при повторном включении changedOrders поля снова enabled
```

`contractor` и `date` пока не показаны в UI, но остаются в config.

---

## 13. Parser Contract

Парсер извлекает:

```text
id / internalId
status
delivery
payment
contractor
date / primary date
shipmentDateText
orderUrl
flags / tags
hasOrderFlag
hasAutoreserve
```

Важное изменение:

```text
date-cell tags отделены от date
date hash не должен ловить шум тегов
tags могут понадобиться в будущем
```

---

## 14. Tests

Тесты фиксируют behavior contract, а не реализацию.

Обязательное правило:

```text
каждый новый behavior → тест
каждый баг → тест
```

Текущий test runner печатает итоговую строку:

```text
N pass 0 fail
```

Перед коммитом достаточно одного зелёного `npm test` после финальной версии файлов.

Повторный `npm test` нужен только если после зелёного теста были новые правки, merge/rebase/conflict или сомнение в состоянии файлов.

---

## 15. Git Workflow

Работаем через Git Bash в VS Code.

Перед commit checkpoint:

```bash
git status
git diff --name-only
git diff --stat
git diff --check
```

Полный `git diff` по умолчанию не нужен.

Если нужен, смотреть точечно:

```bash
git diff -- popup.js
```

Не давать одним copy-paste блоком:

```text
status/diff + commit + push
```

Сначала checkpoint. Только после подтверждения — commit/push.

Коммит = логический behavior, не каждый микрошаг.

Маленькие шаги допустимы, но можно группировать в один commit, если они закрывают один behavior.

---

## 16. Local Archive Workflow

Для передачи актуального кода можно использовать архив:

```bash
git archive --format=zip --output=tab_wanderer_current.zip HEAD
```

Рекомендуемый alias:

```bash
git config alias.twzip '!f() { rm -f tab_wanderer_current.zip && git archive --format=zip --output=tab_wanderer_current.zip HEAD; }; f'
```

Использование:

```bash
git twzip
```

Локальный ignore для архива:

```bash
echo "/tab_wanderer_current.zip" >> .git/info/exclude
```

`tab_wanderer_current.zip` не должен попадать в commit.

---

## 17. Communication Contract

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

Запрещено:

```text
писать код без анализа
давать псевдокод вместо copy-ready code
давать примерный код
перескакивать через проверку
```

Формат точечных изменений:

```text
Файл: <path>

было:
<код>

стало:
<код>
```

При полной перезаписи файла:

```text
Файл: <path>

только финальная версия
без "было"
```

---

## 18. Roadmap

### 0.9.5 — Stabilization + Test Hardening ✅

Завершено.

```text
core stabilization
test hardening
parser/hash/date tests
background process/config tests
popup draft tests
```

---

### 0.9.6 — Deep Collection ✅

Завершено.

```text
deep collection
fast/deep cycles
pagination
collection session
monitorState
baseline/rebaseline
known/window DB
monitorMode active/windowed
```

Tag:

```text
v0.9.6
```

---

### 0.9.7 — Scope UX + Event/Notification Model 🔥

В работе.

Завершено:

```text
0.9.7.1 Parser Contract Hardening ✅
0.9.7.2 Event Model Upgrade ✅
0.9.7.3 Field-level Change Events ✅
0.9.7.4 Notification Trigger Settings ✅
0.9.7.5 Remove Hardcoded Notification Rule Presets ✅
0.9.7.6 Step 1 Notification Triggers UI ✅
0.9.7.6 Step 2 Changed-fields UI dependency ✅
```

Осталось:

```text
0.9.7.6 Step 3 Scope UX wording / explanation
0.9.7.6 Step 4 Notification Triggers polish
0.9.7 final README/version sync
tag v0.9.7
```

---

### 0.9.8 — Observability + Refactor ⏳

Цель:

```text
сделать систему объяснимой и удобной для диагностики
```

План:

```text
logs:
  phase
  eventType
  changedFields
  suppress reason
  baseline reason
  rebaseline reason
  collection session state

cleanup:
  background.js organization
  helper grouping
  test helper cleanup
  parser diagnostics
```

Ограничение:

```text
без большого опасного refactor
только маленькие шаги
```

---

### 1.0 — Stable Monitoring Release ⏳

Definition of Done:

```text
deterministic core
trusted snapshot model
events только в active
baseline/rebaseline/recovery не уведомляют
deep sync отслеживает изменения на глубину
monitorScope управляет входом
notificationTriggers управляют уведомлениями
нет hardcoded business rules
понятный popup UX
README актуален
tests green
release notes
tag v1.0
```

---

## 19. Post-1.0 Roadmap

### 1.1 — Action Foundation

Перед любыми автоматическими действиями нужны:

```text
action state
locks
queue
audit log
manual confirmation model
error handling
retry strategy
```

---

### 1.2 — Ozon Barcode Binding

Отложено до отдельного этапа.

Архитектура: отдельно от worker tab.

Планируемые источники:

```text
активное окно заказа
страница сборки заказа
личный кабинет Ozon
```

Обязательные требования:

```text
определить, что заказ именно Ozon
считать товары и штрихкоды со сборки
искать товар в Ozon по product ID
показать пользователю товар/штрихкод перед привязкой
возможно ручное подтверждение
учитывать минимальную цену товара для barcode binding
```

---

### Later — Firefox Fork

После стабильного Chrome release:

```text
оценить переносимость
проверить browser APIs
подготовить fork при необходимости
```

---

## 20. Current Next Step

Текущий следующий шаг после добавления этого документа:

```text
1. Add docs/project-context.md
2. Commit:
   docs: add project context contract
3. Move to new chat
4. In new chat continue:
   0.9.7.6 Step 3 — Scope UX wording / explanation
```

В новом чате загрузить:

```text
docs/project-context.md
актуальный tab_wanderer_current.zip при необходимости
```
