# Как это устроено

[English](architecture.md) | Русский

Сначала компоненты, потом основные потоки. События `senkutools:` это сообщения между изолированным контент-скриптом и скриптами в мире страницы, в них только строки. Назад к [README](../README.ru.md).

## Где что работает

```mermaid
flowchart TB
  subgraph EXT["Расширение"]
    P["Меню<br/>форма настроек"]
    BG["Фоновый скрипт<br/>запрос токена, очистка при установке и обновлении"]
    ST["storage.local<br/>настройки, profileCollections"]
    DB["database.json<br/>цены карт внутри расширения"]
    ISO["Контент-скрипт, изолированный мир<br/>цикл отрисовки, ценники, итоги обмена, значок профиля,<br/>сортировка по цене, клавиши поиска, панель токена, переключатели и кнопки"]
    MAIN["Скрипты в мире страницы, MAIN<br/>app-mounted, trade-capture, inventory-guard,<br/>search-request, catalog-search, avatar-confirm"]
  end
  subgraph TAB["Вкладка браузера"]
    PAGE["Страница сайта<br/>приложение Vue, Vue Router, urql и graphcache, fetch страницы, DOM"]
  end
  subgraph NET["Сеть"]
    API["API сайта и /sw.js"]
  end
  P -->|"сохраняет настройки"| ST
  BG -->|"убирает старые ключи при установке и обновлении"| ST
  ST -->|"изменение хранилища"| ISO
  DB -->|"runtime.getURL и fetch"| ISO
  ISO -->|"сообщение runtime, токен обратно (cookies API)"| BG
  ISO -->|"события senkutools: price-view, price-order, inventory-refresh, trades-replay, только строки"| MAIN
  MAIN -->|"события senkutools: trades, search, price, refresh, app-mounted, только строки"| ISO
  ISO -->|"рисует в DOM, следит за ним через MutationObserver"| PAGE
  MAIN -->|"оборачивает fetch, executeQuery и executeMutation, ставит хук роутера, открывает окно подтверждения"| PAGE
  PAGE -->|"GraphQL по HTTP"| API
  ISO -->|"анонимный GraphQL для значка профиля"| API
  MAIN -->|"анонимный обход для сортировки по цене, читает /sw.js"| API
```

## Сортировка по цене

```mermaid
sequenceDiagram
  participant U as Пользователь
  participant C as Контент-скрипт
  participant G as inventory-guard
  participant A as API сайта
  participant S as Страница сайта
  U->>C: выбирает Цене в меню сортировки
  C->>G: senkutools:price-view включить
  G->>A: обходит список по 100 карт, без токена
  G->>C: senkutools:price-rows и price-state, прогресс
  C->>G: senkutools:price-order, порядок по ценам из расширения
  G->>S: отвечает сетке служебным отсортированным списком, по странице
  G->>C: senkutools:price-state готово
```

## Итоги обмена

```mermaid
sequenceDiagram
  participant S as Страница сайта
  participant T as trade-capture
  participant C as Контент-скрипт
  C->>T: senkutools:trades-replay, один раз при старте
  T->>C: senkutools:trades, то, что уже собрано
  S->>T: через fetch приходит ответ с обменом
  T->>C: senkutools:trades, из копии ответа
  C->>S: рисует таблицу итогов в DOM
```

## Свежие списки карт

```mermaid
sequenceDiagram
  participant S as Страница сайта
  participant G as inventory-guard
  participant A as API сайта
  S->>G: кузня, принятый обмен или список из кэша
  G->>A: заново запрашивает записанные страницы, только по сети
  G->>S: свежие страницы попадают в graphcache, сетка перерисовывается
```

## Поиск сайта

```mermaid
sequenceDiagram
  participant U as Пользователь
  participant S as Страница сайта
  participant R as search-request
  participant A as API сайта
  participant C as Контент-скрипт
  U->>S: печатает в поиске сайта
  S->>R: запрос поиска идёт через executeQuery
  R->>A: просит 30 результатов вместо 10
  R->>C: senkutools:search, начало и конец каждого поиска
  C->>S: отмечает набранные слова, чинит Enter, стрелки и Ctrl+K
```

## Поиск в каталоге

```mermaid
sequenceDiagram
  participant U as Пользователь
  participant S as Страница сайта
  participant H as catalog-search
  participant A as API сайта
  U->>S: Enter в поиске сайта, вкладка Манга или Аниме
  S->>H: открывает каталог с текстом в query
  H->>S: хук beforeEach: query становится фильтром поиска
  S->>H: каталог запрашивает тайтлы через executeQuery
  H->>A: пустой ответ: просит search до 300 строк и catalogRowFacts
  H->>S: отдаёт строки в формате каталога
```

## Предупреждение о цене аватарки

```mermaid
sequenceDiagram
  participant U as Пользователь
  participant V as avatar-confirm
  participant W as /sw.js
  participant S as Страница сайта
  U->>V: жмёт кнопку загрузки аватарки, клик удерживается
  V->>W: ищет чанк окна и картинку монеты
  V->>S: открывает окно подтверждения сайта, цена 5000 сенкоинов
  U->>V: подтверждает
  V->>S: повторяет клик, дальше работает сайт
```

## Панель токена

```mermaid
sequenceDiagram
  participant U as Пользователь
  participant O as Меню
  participant C as Контент-скрипт
  participant B as Фоновый скрипт
  participant K as Буфер обмена
  U->>O: включает панель токена и подтверждает предупреждение
  O->>C: изменение хранилища
  C->>B: сообщение runtime
  B->>C: cookie access_token или null
  U->>C: нажимает кнопку копирования
  C->>K: записывает токен
```
