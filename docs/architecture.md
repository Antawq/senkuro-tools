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
    ISO["Content script, isolated world<br/>render loop, price tags, trade totals, profile chip,<br/>price sort, search keys, token bar, card poster, switches and buttons"]
    MAIN["Scripts in the page world, MAIN<br/>app-mounted, client-swap, trade-capture,<br/>avatar-confirm"]
  end
  subgraph TAB["Browser tab"]
    PAGE["Site page<br/>Vue app, Vue Router, urql and graphcache, page fetch, DOM"]
  end
  subgraph NET["Network"]
    API["Site API, card image CDN and /sw.js"]
  end
  P -->|"saves settings"| ST
  BG -->|"removes retired keys on install or update"| ST
  ST -->|"storage change"| ISO
  DB -->|"runtime.getURL fetch"| ISO
  ISO -->|"runtime message, token back (cookies API)"| BG
  ISO -->|"senkutools events: price-view, price-order, inventory-refresh, trades-replay, strings only"| MAIN
  MAIN -->|"senkutools events: trades, search, price, refresh, app-mounted, strings only"| ISO
  ISO -->|"draws into the DOM, watches it with MutationObserver"| PAGE
  MAIN -->|"swaps the site urql client for its own with exchanges in front, wraps fetch for trade capture, adds a router guard, opens the confirm modal"| PAGE
  PAGE -->|"GraphQL over HTTP"| API
  ISO -->|"anonymous GraphQL for the profile chip and the poster art, card images for the poster"| API
  MAIN -->|"anonymous crawl for the price sort, reads /sw.js"| API
```

## Sort by price

```mermaid
sequenceDiagram
  participant U as User
  participant C as Content script
  participant G as client-swap, price exchange
  participant A as Site API
  participant S as Site page
  U->>C: picks Цене in the sort menu of a card list: profile, deck builder or a trade or forge window
  C->>G: senkutools:price-view on, naming the list: grid or picker
  G->>A: crawls the list, 100 cards a page, no token
  G->>C: senkutools:price-rows and price-state, progress
  C->>G: senkutools:price-order, sorted by the bundled prices
  G->>S: answers that list itself, page by page from the crawl, the site client never sees it
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
  participant G as client-swap, inventory exchange
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
  participant R as client-swap, search exchange
  participant A as Site API
  participant C as Content script
  U->>S: types in the site search
  S->>R: the search query passes the search exchange
  R->>A: asks for 30 results instead of 10
  R->>C: senkutools:search, start and end of each search
  C->>S: marks the typed words, fixes Enter, arrows and Ctrl+K
```

## Catalog search

```mermaid
sequenceDiagram
  participant U as User
  participant S as Site page
  participant H as client-swap, catalog exchange
  participant A as Site API
  U->>S: Enter in the site search, Manga or Anime tab
  S->>H: opens the catalog with the text in query
  H->>S: beforeEach guard: query becomes the search filter
  H->>S: afterEach hook: a changed filter set the catalog left unread is replaced once more with force
  S->>H: the catalog query passes the catalog exchange
  H->>A: empty answer: asks search, up to 300 rows, and catalogRowFacts for each page
  H->>S: hands back rows in the catalog format, with the 18+ flag
```

## Card poster

```mermaid
sequenceDiagram
  participant U as User
  participant S as Site page
  participant C as Content script
  participant A as Site API
  participant N as Card image CDN
  U->>S: selects cards with the site's own selection, long press or Select all
  U->>C: presses the poster button
  C->>S: reads the selected rows from the grid
  C->>A: asks card(slug) for the original art of each selected card, no token
  A->>C: image address, 400x600
  C->>N: fetches each original, cache reload
  N->>C: image bytes
  C->>C: draws the poster on a canvas
  U->>C: presses Download or Copy
  C->>U: a PNG file or an image on the clipboard
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
