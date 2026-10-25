# How it works

English | [Русский](architecture.ru.md)

The components first, then the main flows. Events named `senkutools:` are the messages between the isolated content script and the page-world scripts, and carry strings only. Back to the [README](../README.md).

## Where the code runs

```mermaid
flowchart TB
  subgraph EXT["Extension"]
    P["Popup<br/>settings form"]
    BG["Background script<br/>token request, cleanup on install or update"]
    ST["storage.local<br/>settings, profileCollections"]
    DB["database.json<br/>bundled card prices"]
    ISO["Content script, isolated world<br/>render loop, price tags, trade totals, profile chip,<br/>price sort, search keys, token bar, switches and buttons"]
    MAIN["Scripts in the page world, MAIN<br/>app-mounted, trade-capture, inventory-guard,<br/>search-request, catalog-search, avatar-confirm"]
  end
  subgraph TAB["Browser tab"]
    PAGE["Site page<br/>Vue app, Vue Router, urql and graphcache, page fetch, DOM"]
  end
  subgraph NET["Network"]
    API["Site API and /sw.js"]
  end
  P -->|"saves settings"| ST
  BG -->|"removes retired keys on install or update"| ST
  ST -->|"storage change"| ISO
  DB -->|"runtime.getURL fetch"| ISO
  ISO -->|"runtime message, token back (cookies API)"| BG
  ISO -->|"senkutools events: price-view, price-order, inventory-refresh, trades-replay, strings only"| MAIN
  MAIN -->|"senkutools events: trades, search, price, refresh, app-mounted, strings only"| ISO
  ISO -->|"draws into the DOM, watches it with MutationObserver"| PAGE
  MAIN -->|"wraps fetch, executeQuery and executeMutation, adds a router guard, opens the confirm modal"| PAGE
  PAGE -->|"GraphQL over HTTP"| API
  ISO -->|"anonymous GraphQL for the profile chip"| API
  MAIN -->|"anonymous crawl for the price sort, reads /sw.js"| API
```

## Sort by price

```mermaid
sequenceDiagram
  participant U as User
  participant C as Content script
  participant G as inventory-guard
  participant A as Site API
  participant S as Site page
  U->>C: picks Цене in the sort menu
  C->>G: senkutools:price-view on
  G->>A: crawls the list, 100 cards a page, no token
  G->>C: senkutools:price-rows and price-state, progress
  C->>G: senkutools:price-order, sorted by the bundled prices
  G->>S: answers the grid with a private sorted list, one page at a time
  G->>C: senkutools:price-state ready
```

## Trade totals

```mermaid
sequenceDiagram
  participant S as Site page
  participant T as trade-capture
  participant C as Content script
  C->>T: senkutools:trades-replay, once on start
  T->>C: senkutools:trades, what it already holds
  S->>T: a trade response arrives through fetch
  T->>C: senkutools:trades, from a copy of the response
  C->>S: renders the totals table into the DOM
```

## Fresh card lists

```mermaid
sequenceDiagram
  participant S as Site page
  participant G as inventory-guard
  participant A as Site API
  S->>G: forge or accepted trade, or a list read from cache
  G->>A: asks the recorded pages again, network only
  G->>S: fresh pages land in graphcache, the grid redraws
```

## Site search

```mermaid
sequenceDiagram
  participant U as User
  participant S as Site page
  participant R as search-request
  participant A as Site API
  participant C as Content script
  U->>S: types in the site search
  S->>R: the search query goes through executeQuery
  R->>A: asks for 30 results instead of 10
  R->>C: senkutools:search, start and end of each search
  C->>S: marks the typed words, fixes Enter, arrows and Ctrl+K
```

## Catalog search

```mermaid
sequenceDiagram
  participant U as User
  participant S as Site page
  participant H as catalog-search
  participant A as Site API
  U->>S: Enter in the site search, Manga or Anime tab
  S->>H: opens the catalog with the text in query
  H->>S: beforeEach guard: query becomes the search filter
  S->>H: the catalog asks for titles through executeQuery
  H->>A: empty answer: asks search, up to 300 rows, and catalogRowFacts
  H->>S: hands back rows in the catalog format
```

## Avatar price warning

```mermaid
sequenceDiagram
  participant U as User
  participant V as avatar-confirm
  participant W as /sw.js
  participant S as Site page
  U->>V: presses the avatar upload button, the click is held
  V->>W: finds the confirm chunk and coin image
  V->>S: opens the site confirm window, price 5000 senkoins
  U->>V: confirms
  V->>S: replays the click, the site takes over
```

## Token bar

```mermaid
sequenceDiagram
  participant U as User
  participant O as Popup
  participant C as Content script
  participant B as Background script
  participant K as Clipboard
  U->>O: turns the token bar on and confirms the warning
  O->>C: storage change
  C->>B: runtime message
  B->>C: access_token cookie, or null
  U->>C: presses the copy button
  C->>K: writes the token
```
