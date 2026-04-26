# StreamBIM objektwidget

Det har ar en enkel statisk widget som ar byggd for att koras **inne i StreamBIM**.

Den foljer monstret fran GitHub-repot `streambim/streambim-widget-api`:

- widgeten ansluter med `StreamBIM.connectToParent(window, callbacks)`
- objektklick fangas via `pickedObject(result)`
- IFC-data hamtas med `StreamBIM.API.getObjectInfo(guid)`

## Vad widgeten gor

- visar nar widgeten ar ansluten till StreamBIM
- laser projekt-id, byggnads-id och anvandare fran aktuell session
- reagerar nar anvandaren klickar pa ett objekt i modellen
- visar GUID, grundmetadata och IFC-egenskaper for valt objekt
- har snabblankar for att ga till objektet, markera det och kopiera GUID

## Filer

- `index.html` innehaller widgetens markup och laddar StreamBIM API fran jsDelivr
- `styles.css` innehaller all styling
- `app.js` hanterar anslutning, event och rendering av objektdata

## Publicering

Publicera mappen som en vanlig statisk webbplats, till exempel:

- GitHub Pages
- Netlify
- Azure Static Web Apps
- valfri egen webbserver

Sedan lagger du in den publika URL:en i StreamBIM och whitelistar samma doman dar.

## Viktigt

For att widgeten ska kunna prata med StreamBIM maste den oppnas **inne i StreamBIM-widgetramen**. Om du oppnar sidan direkt i en vanlig webblasaflik kommer `connectToParent(...)` inte att fa nagon riktig foraldrakontext att ansluta till.
