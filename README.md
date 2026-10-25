# SenkuTools

Prices on cards, trade totals and account tools for senkuro.me, shiruho.com and senkognito.com.

English | [Русский](README.ru.md)

![Manifest V3](https://img.shields.io/badge/manifest-v3-4285f4) ![Firefox 142+](https://img.shields.io/badge/firefox-142%2B-ff7139) ![WXT](https://img.shields.io/badge/built%20with-WXT-67d55e)

## Features

Click the extension icon to open the settings. Labels in backticks are the extension's Russian interface.

- **Prices on cards.** The bank price on every card, from the bundled database. `Показывать цены банка на картах` hides it.
- **Trade totals.** A table with value in F (the lowest rank), cards per rank and a verdict, `Выгода` or `Потеря`.
- **Profile value.** The chip `Посчитать ценность` counts a collection in F.
- **Sort by price.** The last item of the card sort menu, `Цене`. About 40 seconds for 10,000 cards.
- **Fresh lists.** Cached card lists reload in the background. Refresh buttons sit on the cards page and in the forge, trade and offer windows.
- **Cards and shards.** A `Все | Карты | Осколки` switch in the trade, offer and merge pickers.
- **Search.** The catalog takes Russian queries. The site search shows 30 results per tab.
- **Copy a card's name.** A button on each card, off by default.
- **Avatar price warning.** A confirm window with the 5000 senkoin price before an upload.
- **Token bar.** `Показывать токен аккаунта` adds a bar with a button that copies the account token. Off by default.

## Install

Download from the [latest release](https://github.com/Antawq/senkuro-tools/releases/latest).

- **Chrome, Edge, Brave, Opera:** unzip `senkutools-<version>-chrome.zip`, open `chrome://extensions`, turn on Developer mode, press Load unpacked and pick the folder.
- **Firefox:** the build is unsigned. Open `about:debugging#/runtime/this-firefox`, press Load Temporary Add-on and pick `senkutools-<version>.xpi`. A restart removes it.
- **Zen, Developer Edition, Nightly:** set `xpinstall.signatures.required` to `false` in `about:config`, then install the `.xpi` from `about:addons` (gear menu, Install Add-on From File).

## Privacy

No analytics. The extension talks only to the supported sites and their APIs. Prices ship inside it. The token is read only while the token bar is on and is never sent anywhere. Permissions: `storage`, `clipboardWrite`, `cookies` (the `access_token` cookie, for the token bar) and the six site hosts.

## Development

`npm install`, then `npm run dev`, `npm run build`, `npm test` and `npm run zip`. Commits follow [Conventional Commits](https://www.conventionalcommits.org) in English.

## Support

[@SenkuTools](https://t.me/SenkuTools) on Telegram or an [issue](https://github.com/Antawq/senkuro-tools/issues). Author: phaivroh ([.com](https://senkuro.com/users/phaivroh), [.me](https://senkuro.me/users/phaivroh)). Thanks to Anta ([.com](https://senkuro.com/users/chu), [.me](https://senkuro.me/users/chu)).
