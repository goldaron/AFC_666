# AFC_666 Frontend Developer Guide

This guide explains how to use the UI functions and patterns added to make the browser version playable. Keep code simple and commented, and reuse `GameSession` flows via the Flask API.

## Overview
- Single-page app with two main screens:
  - Start screen (aloitusnäyttö)
  - Game screen (pelinäkymä) with views for Contracts (Sopimukset) and Market (Kauppa)
- Vanilla HTML/CSS/JavaScript
- API base: `http://localhost:5000`

## Files
- `static/index.html`: UI structure for start screen and game views
- `static/styles.css`: Global styles including start screen visuals
- `static/app.js`: Core app logic (screen switching, notifications, stats, helpers)
- `static/tasks.js`: Contracts (tasks) listing and acceptance
- `static/market.js`: Market listing (new/used) and purchase

## Screen Switching
- Containers:
  - Start screen: `#start-screen`
  - Game screen: `#game-container`
- CSS helper: `.hidden { display: none !important; }`
- Functions (in `app.js`):
  - `showGameScreen()`: hides start screen, shows game
  - `exitGame()`: hides game, shows start screen
- Entry points (buttons in `index.html`):
  - `startNewGame()`: prepare new session (placeholder), then `showGameScreen()`
  - `loadGame()`: load default/selected save (placeholder), then `showGameScreen()`
  - `showSettings()`: placeholder notification for settings

## View Switching (Game Screen)
- Navigation buttons (in `index.html`):
  - `Sopimukset` → `showView('tasks')`
  - `Kauppa` → `showView('market')`
- Function (in `app.js`):
  - `showView(viewName)`: toggles `.view-container` elements and loads data
    - `tasks` → `loadActiveTasks()`
    - `market` → `showMarketTab('new')`

## Notifications
- HTML structure: `#notification` contains `.notification-card`
- Function (in `app.js`):
  - `showNotification(message, type = 'success', title = '')`
    - `type`: `'success' | 'error'`
    - Auto-hides after 4s

## Game Stats (Header)
- Function: `updateGameStats()`
  - Fetches `GET /api/game`
  - Updates `#player-name`, `#current-day`, `#cash-amount`, `#home-base`
- Money formatting: `formatMoney(amount)` accepts string/number

## API Helper
- `apiCall(endpoint, options = {})`
  - Wraps `fetch` with JSON headers and error handling
  - Throws with `error.message` from server or HTTP status

## Contracts (Tasks)
- Load: `loadActiveTasks()` → `GET /api/tasks`
- Render: `createTaskElement(task)` builds a concise card
- Offers for aircraft:
  - `loadAircraftListForTasks()` → `GET /api/aircrafts` and filter `status === 'IDLE'`
  - `loadTaskOffersForAircraft()` → `GET /api/aircrafts/{id}/task-offers`
  - `createOfferElement(offer, aircraftId)` renders an offer + accept button
- Accept: `acceptTask(aircraftId, offer)` → `POST /api/tasks`
  - On success: refresh stats, active tasks, offers list

## Market
- Tabs: `showMarketTab('new' | 'used')`
- New aircraft:
  - `loadNewAircraft()` → `GET /api/market/new`
  - `createNewAircraftElement(aircraft)`
  - `buyNewAircraft(aircraft)` → `POST /api/market/buy` with `{ type: 'new', model_code }`
- Used aircraft:
  - `loadUsedAircraft()` → `GET /api/market/used`
  - `createUsedAircraftElement(aircraft)`
  - `buyUsedAircraft(aircraft)` → `POST /api/market/buy` with `{ type: 'used', market_id }`

## Localization
- All player-facing strings are Finnish in HTML/JS (labels, headings, buttons, notifications)
- If you add new strings, keep them in Finnish and follow the existing style

## Determinism and Money
- Backend handles determinism (RNG seed) and money math (Decimal)
- Frontend: preserve money as strings from API (`_decimal_to_string`), format via `formatMoney`

## Testing
- Start Flask: `python api_server.py` (or use venv path)
- Open: `http://localhost:5000`
- Validate:
  - Start screen appears first
  - Buttons switch screens
  - Sopimukset and Kauppa views load data without errors

## Future Hooks
- Implement settings modal in `showSettings()`
- Add save selection UI for `loadGame()`
- Animate transitions (CSS fade/scale) for screens/views

## Troubleshooting
- If server fails due to missing packages, install in venv:
  - `pip install flask mysql-connector-python playsound3`
- Check API_BASE matches your server address
- Open devtools console for JS errors
