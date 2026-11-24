# ADU Fit Check

A screening tool for the Municipality of Anchorage. A homeowner looks up an address or uploads a survey, places an accessory dwelling unit (ADU) on the lot, and sees where it fits (green), where it does not (red), and why.

**Results are screening only. Zoning staff make the determination.** That statement stays in the page notice, on the drawn sheet and in the copied summary.

Live copy: https://www.brendanbabb.com/experiments/adu-fit/

## What it does

- Address lookup against the Municipality's public ArcGIS services: lot lines, exact building outlines cut off at the lot line, and the front lot line and alleys taken from the street centrelines.
- After a lookup, the "other reviews" boxes for seismic zone, flood zone and slope are filled from the Municipality's map layers, with the layer and its date shown under each.
- After a lookup, a Drawing / Aerial photo switch puts the Municipality's own aerial photo under the lot lines (2026, or 2024 if that one does not load), and a link opens street view in Google Maps in a new tab. No Google imagery is drawn in the page.
- Upload of a survey image or PDF, traced by hand: scale, lot lines, buildings, no-build areas.
- Plan check: setbacks by lot-line type, alley exemption, overlap with buildings and no-build areas, lot coverage, ADU floor area.
- The plan-check table is the text equivalent of the drawing.

It never requests or shows owner names or mailing addresses.

## Files

| File | What is in it |
|---|---|
| `index.html` | Markup and styles |
| `ui.js` | Canvas, tracing tools, controls, address lookup flow |
| `geometry.js` | Pure geometry functions |
| `rules.js` | Zoning numbers (`DIST`) and the plan check (`check()`), each with its Anchorage Municipal Code citation |
| `data.js` | ArcGIS REST queries and clipping buildings to the lot |
| `tests/` | Vitest unit tests, and `live-check.mjs` for checking an address from the command line |
| `build_deploy.py` | Builds the upload folder for DreamHost |
| `ADU_FIT_CHECK_TASK.md` | The work order, by phase |

No framework and no build step. Turf.js, pdf.js and the fonts load from CDNs.

## Run it

The page uses ES modules, so it has to be served rather than opened from disk.

```
npm install        # only needed for the tests
npm start          # http://127.0.0.1:8000/
npm test
node tests/live-check.mjs "1400 W 23RD AVE"
```

## Deploy

```
python build_deploy.py            # builds deploy_dreamhost/ (gitignored)
```

Upload the contents of `deploy_dreamhost/` to `experiments/adu-fit/`, then:

```
python build_deploy.py --verify   # compares the live files with the build
```

## Changing a zoning number

Every number in `rules.js` carries the code section it comes from. Read the current section before changing one, and update the citation in the comment and in the page text together.

## Known limits

- District table covers single-family detached rows of AMC 21.06.020 Table 21.06-1 for the Anchorage Bowl. Chugiak-Eagle River, Girdwood and Downtown are not included.
- Lot lines and buildings come from GIS, not a survey, and may not show recent construction.
- The projection (NAD83 Alaska State Plane Zone 4, feet) has not yet been confirmed with MOA GIS.
- The 2026 aerial photo service is named `Photo_2026_Temp` and its record gives no flight dates. If it is renamed, the page falls back to the 2024 photo until `AERIALS` in `data.js` is updated.
- Aerial photos are for orientation. Mapped lot lines can sit a few feet off the photo.
- "Read survey with AI" only appears inside claude.ai. A stand-alone version is Phase 4 of the work order.

## Licence

MIT. See `LICENSE`.
