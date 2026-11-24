# ADU Fit Check

A screening tool for the Municipality of Anchorage. A homeowner looks up an address or uploads a survey, places an accessory dwelling unit (ADU) on the lot, and sees where it fits (green), where it does not (red), and why.

**Results are screening only. Zoning staff make the determination.** That statement stays in the page notice, on the drawn sheet and in the copied summary.

The page is a prototype for ideas and discussion. It says so beside the title, in the notice, under the plan check, on the drawn sheet and in the copied summary, along with the need for permitting and zoning staff to review any real project. Keep those in place.

Live copy: https://www.brendanbabb.com/experiments/adu-fit/

## What it does

- Address lookup against the Municipality's public ArcGIS services: lot lines, exact building outlines cut off at the lot line, and the front lot line and alleys taken from the street centrelines.
- After a lookup, the "other reviews" boxes for seismic zone, flood zone and slope are filled from the Municipality's map layers, with the layer and its date shown under each.
- After a lookup, a Drawing / Aerial photo switch puts the Municipality's own aerial photo under the lot lines (2026, or 2024 if that one does not load), and a link opens street view in Google Maps in a new tab. No Google imagery is drawn in the page.
- After a lookup, a Shadows panel draws the shadows of the ADU and the nearby buildings for any date and time of day. It is an aid for discussion: no shadow rule is checked.
- After a lookup, a 3D view shows the lot, the nearby buildings and the ADU as blocks, from above, from the street or from inside the ADU, with the same sun and shadows. It is view-only and loads three.js the first time it is opened.
- Upload of a survey image or PDF, traced by hand: scale, lot lines, buildings, no-build areas.
- ADU designs come from the Municipality's pre-approved plan catalog (`plans.json`), with a custom size as well.
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
| `sun.js` | Sun position and shadow length (pure functions) |
| `view3d.js` | The 3D block view (three.js), loaded on demand |
| `plans.json` | The pre-approved ADU plans: name, designer, footprint, floor area, and where each number comes from |
| `tests/` | Vitest unit tests, and `live-check.mjs` for checking an address from the command line |
| `build_deploy.py` | Builds the upload folder for DreamHost |
| `ADU_FIT_CHECK_TASK.md` | The work order, by phase |

No framework and no build step. Turf.js, pdf.js, three.js and the fonts load from CDNs; three.js only when the 3D view is opened.

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

## Updating the plan catalog

The plans are in `plans.json`, read from www.muni.org/ADU on 2026-11-24. The Municipality's cover sheets give each plan's floor area but print no width, depth or height, so `w` and `d` are estimates scaled from the cover sheet drawings and are marked `"approx": true`. The page says so wherever a plan is shown. When the real dimensions arrive (the "Not for Construction" plan set, or Development Services), replace `w` and `d`, set `approx` to `false` and update `dimSource`. A plan that is not a rectangle will need polygon footprints, which are not built yet.

## Known limits

- The 3D view is a block model with the same limits as the shadows, and it cannot be unit-tested here: check it in a browser after changing `view3d.js`.
- Shadows treat the ground as flat and every building as a flat-topped block, and show no trees or fences. Building heights come from the `ELEVATION` field of the Municipality's building layer, which the layer does not document; it is read as height above ground in feet, probably to the highest point of the roof. About one building in five has no value and casts no shadow. ADU heights are guesses (`heightGuess` in `plans.json`) that the person can change.
- Plan footprints are estimates (see above), so distances for a catalog plan may be off by a foot or two.
- ADU height (25 ft, or 30 ft over a garage, AMC 21.05.070D.1) is not checked: no plan height is published.
- The Williwaw's floor area is taken as the 811 sq ft on its sheet. Whether its 176 sq ft entryway also counts has not been confirmed.
- District table covers single-family detached rows of AMC 21.06.020 Table 21.06-1 for the Anchorage Bowl. Chugiak-Eagle River, Girdwood and Downtown are not included.
- Lot lines and buildings come from GIS, not a survey, and may not show recent construction.
- The projection (NAD83 Alaska State Plane Zone 4, feet) has not yet been confirmed with MOA GIS.
- The 2026 aerial photo service is named `Photo_2026_Temp` and its record gives no flight dates. If it is renamed, the page falls back to the 2024 photo until `AERIALS` in `data.js` is updated.
- Aerial photos are for orientation. Mapped lot lines can sit a few feet off the photo.
- "Read survey with AI" only appears inside claude.ai. A stand-alone version is Phase 4 of the work order.

## Licence

MIT. See `LICENSE`.
