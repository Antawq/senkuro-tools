# SenkuTools

Цены на картах, итоги обменов и инструменты аккаунта для senkuro.me, shiruho.com и senkognito.com.

[English](README.md) | Русский

![Manifest V3](https://img.shields.io/badge/manifest-v3-4285f4) ![Firefox 142+](https://img.shields.io/badge/firefox-142%2B-ff7139) ![WXT](https://img.shields.io/badge/built%20with-WXT-67d55e)

## Возможности

Настройки открываются по значку расширения.

- **Цены на картах.** Цена банка на каждой карте, из базы внутри расширения. Выключатель: `Показывать цены банка на картах`.
- **Итоги обмена.** Ценность в F (низший ранг), число карт по рангам и вердикт, `Выгода` или `Потеря`.
- **Ценность профиля.** Кнопка `Посчитать ценность` на профиле считает коллекцию в F.
- **Сортировка по цене.** Последний пункт меню сортировки карт, `Цене`. Около 40 секунд на 10 000 карт.
- **Свежие списки.** Списки из кэша сайта обновляются в фоне. Кнопки обновления есть на странице карт и в окнах кузни, обмена и предложения.
- **Карты и осколки.** Переключатель `Все | Карты | Осколки` в окнах выбора карт для обмена, предложения и слияния.
- **Поиск.** Каталог понимает русские запросы. Поиск сайта показывает по 30 результатов на вкладку.
- **Копирование имени.** Кнопка на каждой карте, по умолчанию выключена.
- **Цена аватарки.** Окно подтверждения с ценой 5000 сенкоинов перед загрузкой.
- **Токен аккаунта.** `Показывать токен аккаунта` добавляет панель с кнопкой копирования токена. По умолчанию выключена.

## Установка

Файлы лежат в [последнем релизе](https://github.com/Antawq/senkuro-tools/releases/latest).

- **Chrome, Edge, Brave, Opera:** распакуйте `senkutools-<версия>-chrome.zip`, откройте `chrome://extensions`, включите режим разработчика, нажмите «Загрузить распакованное» и выберите папку.
- **Firefox:** сборка не подписана. Откройте `about:debugging#/runtime/this-firefox`, нажмите «Загрузить временное дополнение» (Load Temporary Add-on) и выберите `senkutools-<версия>.xpi`. После перезапуска оно пропадёт.
- **Zen, Developer Edition, Nightly:** в `about:config` поставьте `xpinstall.signatures.required` в `false`, затем установите `.xpi` через `about:addons` (шестерёнка, Install Add-on From File).

## Приватность

Аналитики нет. Расширение обращается только к поддерживаемым сайтам и их API. Цены лежат внутри него. Токен читается только при включённой панели и никуда не отправляется. Разрешения: `storage`, `clipboardWrite`, `cookies` (cookie `access_token`, для панели токена) и шесть адресов сайтов.

## Разработка

`npm install`, затем `npm run dev`, `npm run build`, `npm test` и `npm run zip`. Коммиты пишутся по [Conventional Commits](https://www.conventionalcommits.org) на английском.

## Связь

[@SenkuTools](https://t.me/SenkuTools) в Telegram или [issue](https://github.com/Antawq/senkuro-tools/issues). Автор: phaivroh ([.com](https://senkuro.com/users/phaivroh), [.me](https://senkuro.me/users/phaivroh)). Благодарность: Anta ([.com](https://senkuro.com/users/chu), [.me](https://senkuro.me/users/chu)).
