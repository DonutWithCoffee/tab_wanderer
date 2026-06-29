# tab_wanderer — Manual Smoke Checklist

Актуально для checkpoint `0.9.9.8` / manifest `0.9.9`.

Цель: быстро проверить, что release-candidate поведение не ломает рабочий процесс сотрудника.

---

## 0. Перед проверкой

```text
npm test → 168 pass / 0 fail
расширение загружено в chrome://extensions
старые вкладки worker закрыты или расширение перезагружено
есть доступ к https://amperkot.ru/admin/orders/
```

---

## 1. Startup / catch-up без лавины уведомлений

Шаги:

```text
1. Остановить мониторинг в popup.
2. Перезагрузить расширение в chrome://extensions.
3. Открыть popup.
4. Включить мониторинг.
5. Дождаться первого deep/catch-up прохода.
```

Ожидаемо:

```text
нет массовых desktop-уведомлений по backlog
status не зависает в warming
known/window counts обновляются
в diagnostic log есть catch-up/startup записи
live-циклы после старта продолжают работать
```

---

## 2. Worker isolation

Шаги:

```text
1. Открыть обычную вкладку админки заказов вручную.
2. Включить мониторинг.
3. Проверить, что worker-вкладка отдельная и помеченная marker/hash.
4. Убедиться, что ручная вкладка менеджера не перезагружается как worker.
```

Ожидаемо:

```text
worker определяется marker + tabId
случайная вкладка с тем же URL не используется как worker
```

---

## 3. Deep sync

Шаги:

```text
1. Режим windowed.
2. deepSyncMaxPages = 50 или тестовое меньшее значение.
3. Дождаться deep sync.
4. Проверить diagnostic log.
```

Ожидаемо:

```text
deep sync идёт по ?page=N
completionReason корректный:
  pagination-last-page / pagination-single-page / empty-first-page / deep-sync-page-limit
после deep sync worker возвращается на page 1
fast cycle не остаётся на глубокой странице
```

---

## 4. Notification controls

Шаги:

```text
1. В popup включить/выключить “Игнорировать юриков”.
2. В popup включить/выключить “Игнорировать ОЗОН”.
3. Проверить, что настройки сохраняются.
```

Ожидаемо:

```text
suppressors влияют только на desktop notifications
state/eventJournal/order lookup продолжают обновляться
если suppressors выключены, уведомления по этим категориям возможны
```

---

## 5. Orders page / lookup

Шаги:

```text
1. Открыть popup.
2. Нажать “Открыть заказы”.
3. Найти заказ по полному orderId.
4. Найти заказ по первым 4 цифрам.
```

Ожидаемо:

```text
страница не показывает broad timeline всех событий
full orderId открывает конкретный заказ, если он есть в локальных данных
short number показывает одного кандидата или список кандидатов
если заказ не найден, текст честно говорит, что плагин его ещё не видел
```

---

## 6. Watchlist / direct follow-up

Шаги:

```text
1. В popup добавить заказ по полному orderId.
2. Открыть страницу “Заказы”.
3. Проверить список отслеживаемых заказов.
4. Удалить заказ из отслеживаемых.
5. Добавить снова со страницы “Заказы”.
```

Ожидаемо:

```text
popup не принимает короткий 4-digit номер для добавления
Orders page показывает watched status / lastChecked / lastError
Direct follow-up не создаёт duplicate notification после list-monitor sync
первый direct baseline не создаёт уведомление
```

---

## 7. Options

Шаги:

```text
1. Открыть Options.
2. Изменить monitorMode.
3. Изменить deepSyncMaxPages.
4. Изменить monitorScope.
5. Изменить notificationTriggers.
6. Открыть ссылку на “Заказы”.
```

Ожидаемо:

```text
Options autosave работает
monitorScope changes debounced
watchlist не управляется напрямую в Options
Options содержит ссылку на Orders page
```

---

## 8. Diagnostic log

Шаги:

```text
1. Скачать diagnostic log из popup.
2. Скачать/скопировать diagnostic log из Options.
3. Очистить log в Options.
```

Ожидаемо:

```text
export содержит header с retained/exported/dropped counts
full export не ограничен preview=100
после clear counters/entries обновляются корректно
лог не содержит HTML, cookie/token/auth данные или полный payload заказа
```

---

## 9. Stop / restart

Шаги:

```text
1. Остановить мониторинг.
2. Убедиться, что worker не продолжает polling.
3. Запустить снова.
```

Ожидаемо:

```text
STOP останавливает циклы
START восстанавливает worker и state
повторный START не создаёт notification flood
```
