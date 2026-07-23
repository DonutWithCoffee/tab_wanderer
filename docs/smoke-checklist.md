# tab_wanderer — post-1.0.3 hardening smoke checklist

Текущая manifest version остаётся `1.0.3`. Это проверка неопубликованного hardening, а не release candidate и не CWS package.

```text
Expected automated baseline: 322 pass / 0 fail
Public CWS release: 1.0.3 / f496d36 / v1.0.3
```

## 0. Подготовка

```text
npm test зелёный
рабочая папка содержит hardening-файлы
расширение загружено через Load unpacked
старые service-worker console errors очищены
есть авторизованный доступ к Amperkot
для Ozon-сценария есть авторизованный Seller кабинет и тестовый заказ
```

Проверить в `chrome://extensions`:

```text
Version: 1.0.3
Permissions: storage, notifications, alarms
Нет permission tabs
Нет ошибок service worker
```

## 1. Базовый startup/recovery

1. Включить мониторинг.
2. Дождаться active/warming → active.
3. Закрыть и снова открыть Chrome.
4. Перезагрузить extension service worker.
5. Проверить popup и Options diagnostics.

Ожидаемо:

- сохранённая конфигурация не заменяется defaults;
- нет notification flood;
- main worker либо принимается повторно, либо безопасно создаётся заново;
- duplicate/direct/Ozon orphan tabs не остаются;
- monitor продолжает работу;
- в Options видны lifecycle/storage diagnostics.

## 2. Worker isolation и URL boundary

1. Открыть обычную вкладку `/admin/orders/`.
2. Включить мониторинг.
3. Убедиться, что обычная вкладка не используется как worker.
4. Проверить main/direct worker markers.
5. Закрыть main worker вручную.

Ожидаемо:

- worker определяется trusted origin/path + marker + tabId;
- обычная пользовательская вкладка не перезагружается;
- watchdog alarm создаёт/восстанавливает worker;
- foreign-origin URL с похожим hash не принимается.

## 3. Fast/deep monitoring

1. Проверить fast poll первой страницы.
2. В `windowed` дождаться deep sync.
3. Проверить возврат worker на page 1.
4. Переключить `active` и убедиться, что deep sync не запускается.
5. Изменить scope и проверить safe rebaseline.

Ожидаемо:

- события не дублируются;
- context-only изменения не уведомляют;
- local city time не создаёт diff;
- scope/mode change не создаёт лавину уведомлений.

## 4. Quick filters

1. Включить «Скрывать ОЗОН».
2. Включить «Скрывать Юрлица».
3. Включить «Заказы юрлиц».
4. Проверить popup и Options.
5. Перезапустить extension.

Ожидаемо:

- legal-only очищает оба hide-фильтра;
- оба hide checkbox заблокированы, пока legal-only включён;
- после restart конфликтные значения не возвращаются;
- Ozon-заказ с юридической оплатой проходит legal-only;
- обычный Ozon-заказ не проходит legal-only.

## 5. Watched orders/direct follow-up

1. Добавить существующий order ID.
2. Попробовать несуществующий ID.
3. Выключить follow-up у сохранённого заказа.
4. Проверить comment/reminder.
5. Снова включить follow-up.
6. Перезапустить service worker во время direct worker.

Ожидаемо:

- несуществующий заказ не сохраняется;
- stale pending state очищается;
- comment/reminder не теряются;
- orphan direct tab удаляется после recovery;
- следующий alarm продолжает direct follow-up.

## 6. Storage reliability

1. Открыть Options → Diagnostics.
2. Запомнить storage bytes.
3. Выполнить несколько monitor/direct операций.
4. Обновить diagnostics.
5. Очистить diagnostic log.
6. Перезапустить extension.

Ожидаемо:

- storage bytes отображаются числом;
- нет storage error;
- clear diagnostic log не повреждает остальной state;
- known/window counts остаются согласованными;
- retention counters не растут без фактического удаления;
- content scripts не могут напрямую читать `chrome.storage.local`.

## 7. Классификация заказа из вкладки менеджера

Подготовить три реальные карточки:

- Ozon-заказ;
- обычный заказ юрлица;
- обычный заказ физлица.

Для каждой карточки:

1. Открыть `/admin/orders/<номер>/` в обычной рабочей вкладке менеджера.
2. Убедиться, что вкладка не имеет worker marker и не заменяется background worker.
3. Открыть Склад 3 для того же номера заказа.
4. Проверить метку и начальное состояние панели.

Ожидаемо:

- Ozon определяется только по полной карточке с `Источник: OZON` и FBS ship-ссылкой того же заказа;
- Ozon-панель автоматически раскрыта и показывает `OZON · автозапись после сборки`;
- юрлицо и физлицо считаются `regular`, панель остаётся свернутой;
- manual раскрытие/проверка/запись доступно для всех трёх типов;
- обычная менеджерская вкладка не принимается за list/direct worker;
- в диагностике растёт счётчик сохранённых типов заказов.

Проверка unknown:

1. Взять номер заказа, карточка которого не открывалась после загрузки текущей unpacked-сборки.
2. Сразу открыть Склад 3.
3. Затем открыть или обновить карточку этого заказа в менеджерской вкладке.

Ожидаемо:

- до наблюдения панель свернута и показывает `Тип не определён — обновите карточку заказа`;
- после обновления полной карточки Warehouse получает новый тип без перезагрузки service worker;
- подтверждённый тип не затирается временным incomplete/unknown наблюдением;
- записи старше 24 часов считаются unknown.

## 8. Warehouse preview, ручное управление и защита записи

1. Открыть warehouse assembly page.
2. Дождаться preview.
3. Проверить collapsed/expanded UI и список причин пропуска.
4. Вручную развернуть и свернуть панель.
5. Выполнить обычный пользовательский click по «Записать в Ozon».
6. В DevTools страницы попытаться вызвать `.click()` на кнопке расширения.

Ожидаемо:

- ручное состояние панели не сбрасывается при обновлении preview того же заказа;
- при переходе SPA на другой заказ начальное состояние рассчитывается заново;
- обычный доверенный click запускает manual write flow;
- программный `.click()` блокируется и не открывает Ozon worker;
- preview/check остаются доступны;
- UI не зависает при fallback scan;
- multi barcode отображается отдельно от других причин.

## 9. Автозапись после складской сборки

### Подтверждённый Ozon-заказ

1. Сначала открыть/обновить карточку Ozon-заказа в обычной вкладке менеджера.
2. Открыть тот же заказ в Склад 3 на маршруте `#/wh/shop-orders/actions?order=<номер>` и убедиться, что панель уже раскрыта.
3. В Options убедиться, что «Автоматически добавлять штрихкоды в Ozon» включено.
4. Доверенно нажать финальную складскую кнопку подтверждения на странице actions. Название склада и видимый текст могут отличаться; у кнопки должен быть `ng-click="$ctrl.confirm();"`.
5. Убедиться, что после действия Склад 3 перешёл на `/assembly/` или полностью перезагрузил документ.
6. После загрузки дождаться, когда обычный warehouse preview прочитает штрихкоды из HTML.
7. Наблюдать Warehouse panel и Ozon worker.
8. Повторить быстрый двойной click/Enter только в безопасном тестовом сценарии.

Ожидаемо:

- простой переход в Склад 3 сам по себе не пишет штрихкоды;
- warehouse bridge и trusted-click listeners установлены ещё на странице actions, до пользовательского клика;
- automation определяется по `$ctrl.confirm()`, а не по тексту `СПБ/Москва: собрать заказ`;
- click создаёт одно одноразовое ожидание, а не немедленный write;
- ожидание сохраняется в background с привязкой к tabId/orderId и переживает SPA-переход, полный reload страницы и перезапуск service worker;
- после полного reload новый content script восстанавливает намерение, ждёт обычный HTML/Angular preview и использует тот же payload, что ручная кнопка записи;
- Ozon worker открывается только после свежего успешного post-action snapshot с единичными штрихкодами;
- неуспешный Warehouse API response не запускает перенос;
- первый успешный fallback snapshot после подтверждённого перехода `actions → assembly` считается post-action; при клике непосредственно на assembly по-прежнему требуется известный изменившийся baseline;
- двойной click не создаёт параллельные automatic sessions;
- automatic request связан с одним `actionId`; background принимает его только при наличии соответствующего непогашенного намерения;
- намерение погашается атомарно перед стартом Ozon worker, поэтому повторный reload или повторный snapshot не создаёт второй write;
- compare/write/verify добавляет только отсутствующие штрихкоды;
- после ошибки остаётся ручной retry.


### Выключенная настройка

1. В Options снять «Автоматически добавлять штрихкоды в Ozon».
2. Повторить подтверждение сборки для подтверждённого Ozon-заказа.
3. Дождаться свежего warehouse preview.
4. Вручную нажать проверку/запись в панели.

Ожидаемо:

- automatic intent не создаётся и Ozon worker сам не открывается;
- уже ожидавшие intents очищаются при выключении;
- панель показывает `OZON · автозапись выключена`;
- ручной preview/check/write работает без изменений;
- после повторного включения следующий доверенный `$ctrl.confirm()` снова запускает обычную автоматику.

### Обычный и unknown-заказ

1. Повторить складскую сборку для юрлица или физлица.
2. Повторить для unknown-заказа.
3. При желании вручную раскрыть панель до сборки.

Ожидаемо:

- Ozon worker автоматически не открывается;
- автоматический request не создаётся даже при вручную раскрытой панели;
- обычный складской preview продолжает обновляться;
- ручные кнопки остаются доступными.

### Защита от синтетического действия

В DevTools страницы попытаться синтетически вызвать складской control или отправить page event.

Ожидаемо:

- `event.isTrusted !== true` не создаёт automatic intent;
- background дополнительно отклоняет automatic write без действующего confirmed Ozon kind.

## 10. Ozon write/recheck

Сценарии:

- всё уже существует;
- успешная новая запись;
- read-after-write задержка;
- unconfirmed → успешный recheck;
- unconfirmed → partial recheck;
- stale error → successful recheck.

Ожидаемо:

- зелёный только при полном подтверждении;
- partial/error остаётся красным и retryable;
- свежий recheck заменяет старое состояние;
- одна актуальная status row;
- technical fallback не показывается пользователю;
- unrelated Ozon API traffic не попадает в capture/debug payload.

## 11. Update lifecycle

Полностью проверить можно только при наличии опубликованной версии выше установленной.

1. Начать Ozon/direct critical operation.
2. Получить `onUpdateAvailable`.
3. Проверить deferred alarm.
4. Завершить critical operation.
5. Проверить reload и восстановление monitoring.

Ожидаемо:

- idle extension reloads immediately;
- critical operation не обрывается;
- pending update сохраняется;
- после safe point происходит reload;
- monitoring восстанавливается без notification flood.

## 12. Финальная проверка перед будущим релизом

- [ ] Все пункты выше пройдены.
- [ ] `npm test` зелёный.
- [ ] Runtime JS проходит `node --check`.
- [ ] Нет remote code/eval/new Function.
- [ ] `docs/private`, `.git`, tests и docs не входят в CWS runtime ZIP.
- [ ] Version/release notes повышаются только после smoke.
- [ ] Permissions и host permissions отдельно зафиксированы в build report.
- [ ] Annotated tag создаётся только после публикации.
