# ADU Fit Check

A screening tool for the Municipality of Anchorage. A homeowner looks up an address or uploads a survey, places an accessory dwelling unit (ADU) on the lot, and sees where it fits (green), where it does not (red), and why.

**Results are screening only. Zoning staff make the determination.** That statement stays in the page notice, on the drawn sheet and in the copied summary.

The page is a prototype for ideas and discussion. It says so beside the title, in the notice, under the plan check, on the drawn sheet and in the copied summary, along with the need for permitting and zoning staff to review any real project. Keep those in place.

Live copy: https://www.brendanbabb.com/experiments/adu-fit/

## What it does

- Address lookup against the Municipality's public ArcGIS services: lot lines, exact building outlines cut off at the lot line, and the front lot line and alleys taken from the street centrelines.
- After a lookup, the "other reviews" boxes for seismic zone, flood zone and slope are filled from the Municipality's map layers, with the layer and its date shown under each.
- After a lookup, a Drawing / Aerial photo switch puts the Municipality's own aerial photo under the lot lines (the 2024 photo), and a link opens street view in Google Maps in a new tab. No Google imagery is drawn in the page.
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
| `config.js` | Where the page finds the survey reader. Holds a public quota key, never a secret |
| `lambda/` | The survey reader: one Python function that asks Claude to trace an uploaded survey |
| `terraform/aws/` | The AWS resources for the survey reader |
| `plans.json` | The pre-approved ADU plans: name, designer, footprint, floor area, and where each number comes from |
| `tests/` | Vitest unit tests, and `live-check.mjs` for checking an address from the command line |
| `tools/` | `make_samples.py` draws the made-up surveys; `verdict.mjs` gives the page's fit verdict for a tracing |
| `build_deploy.py` | Builds the upload folder for DreamHost |
| `ADU_FIT_CHECK_TASK.md` | The work order, by phase |

No framework and no build step. Turf.js, pdf.js, three.js and the fonts load from CDNs; three.js only when the 3D view is opened.

## Run it

The page uses ES modules, so it has to be served rather than opened from disk.

```
npm install        # only needed for the tests
npm start          # http://127.0.0.1:8000/
npm test
node tests/live-check.mjs "132 E MANOR AVE"
```

`npm test` covers the geometry, the zoning rules and plan check, the sun, the map data, and the page itself. `tests/ui.test.js` runs `index.html` and `ui.js` in a simulated browser (happy-dom) with a canvas that draws nothing and no network: it checks the words, the plan check table, tracing by keyboard, and what the page sends to the survey reader. `tests/view3d.test.js` runs `view3d.js` against a stand-in for three.js (`tests/fakes/`). Neither can see the picture, so look at the drawing and the 3D view in a browser after changing them.

## Using it without a mouse

Every step works from the keyboard. With the drawing in focus:

- **Steps 1 to 4 (scale, lot lines, buildings, no-build areas):** the arrow keys move a crosshair, 10 screen pixels a press or 1 with Shift held. Enter or Space places a point, as a click does. Backspace takes the last point back. Home jumps to the first corner of the shape being drawn, so Enter there closes it; "Finish shape" closes it too.
- **Lot line labels:** in step 2, once the lot is traced, a list under the tools has a picker for each line (Front, Side, Rear, Alley).
- **Step 5:** the arrow keys move the ADU one foot.

What each key press did is announced for screen readers. Tracing still needs sight of the survey image; the "Does it fit" section gives every result in words.

## Deploy

```
python build_deploy.py            # builds deploy_dreamhost/ (gitignored)
```

Upload the contents of `deploy_dreamhost/` to `experiments/adu-fit/`, then:

```
python build_deploy.py --verify   # compares the live files with the build
```

## The survey reader (Phase 4)

"Read survey with AI" posts the uploaded survey image to a small AWS Lambda behind API Gateway (`lambda/handler.py`, `terraform/aws/`), which asks Claude for a first tracing. The person must check it and press "This tracing looks right" before any result is shown.

- **Spend is limited four ways:** an API Gateway usage plan with a daily quota (the page's key attaches it), reserved concurrency of 2, a throttle of one request a second, and a spend limit set on the Anthropic workspace that owns the model key. The quota is best-effort and the page's key is public, so one person could use up a day's quota for everyone; the concurrency cap and the Anthropic spend limit are the firm ceilings. A per-address limit would need a firewall rule in front of the API.
- **The model key** is an encrypted SSM parameter, `/adu-fit-check/anthropic-api-key`, created by hand. It is not in this repository, the Lambda package or the Terraform state.
- **No image or tracing is stored.** The image is held for one request. The log line has timing, token counts and how many shapes came back, never the image or the tracing.
- **How often people correct the tracing is logged.** When a person presses "This tracing looks right", the page posts to a second route, `/tracing-checked`, which parts they changed first (lot lines, buildings, no-build areas, scale, street sides, zoning district: yes or no for each) and how far the furthest lot corner moved, in whole feet. No image, coordinates or address. This is the accuracy measure for the pilot. The route makes no model call and needs no key, so it does not use up the daily quota; because the report comes from the page, anyone could send false ones. Lambda logs are kept 90 days. `python lambda/correction_report.py` prints the figures.
- **To switch it off:** `aws lambda put-function-concurrency --function-name adu-fit-check-survey-prod --reserved-concurrent-executions 0`, or empty `url` in `config.js`.

```
python -m unittest discover -s lambda -p "test_*.py"   # no network, no key
scripts/deploy_survey.sh                               # build the zip and show the Terraform plan
scripts/deploy_survey.sh --apply                       # apply the plan just shown
```

After the first deploy, put the two Terraform outputs into `config.js` and deploy the page.

Three made-up as-built surveys are in `samples/`, drawn by `tools/make_samples.py`, with what each one really shows in `samples/answers.json`. The page offers them under "Have a survey of your lot?" so people can try the upload and AI steps. `python lambda/score_samples.py` reads each through the live reader and reports how far each traced corner is from the truth, in feet, and whether the fit verdict changes: for each catalog plan, whether the page would say "Could fit" on the true tracing and on the reader's (three paid calls; `--replay` scores the saved replies again with none). The verdicts come from the page's own code through `tools/verdict.mjs`. To evaluate real as-builts, keep them outside this repository with an `answers.json` in the same format and pass its path; the format is described at the top of the script.

## Who the page is written for

The page is written for residents first: plain words, a clear "could fit" or "does not fit", and the Municipality's next steps. The measurements, code sections, data sources and open questions are kept for builders and permitting staff in notes that open on request ("for builders and reviewers") and in the last section on the right. When adding a feature, put the plain-language result in view and the detail in a note.

The sections on the right open and close. Opening the 3D view closes all of them except "Sun and shadows", so its controls sit beside the model on a laptop.

## Changing a zoning number

Every number in `rules.js` carries the code section it comes from. Read the current section before changing one, and update the citation in the comment and in the page text together.

## Updating the plan catalog

The plans are in `plans.json`, read from www.muni.org/ADU on 2026-11-24. The Municipality's cover sheets give each plan's floor area but print no width, depth or height, so `w` and `d` are estimates scaled from the cover sheet drawings and are marked `"approx": true`. The page says so wherever a plan is shown. When the real dimensions arrive (the "Not for Construction" plan set, or Development Services), replace `w` and `d`, set `approx` to `false` and update `dimSource`. A plan that is not a rectangle will need polygon footprints, which are not built yet.

## Known limits

- The 3D view is a block model with the same limits as the shadows. Its unit tests check what is built and where, not the picture: check it in a browser after changing `view3d.js`.
- Shadows treat the ground as flat and every building as a flat-topped block, and show no trees or fences. Building heights come from the `ELEVATION` field of the Municipality's building layer, which the layer does not document; it is read as height above ground in feet, probably to the highest point of the roof. About one building in five has no value and casts no shadow. ADU heights are guesses (`heightGuess` in `plans.json`) that the person can change.
- Plan footprints are estimates (see above), so distances for a catalog plan may be off by a foot or two.
- ADU height (25 ft, or 30 ft over a garage, AMC 21.05.070D.1) is not checked: no plan height is published.
- The Williwaw's floor area is taken as the 811 sq ft on its sheet. Whether its 176 sq ft entryway also counts has not been confirmed.
- District table covers single-family detached rows of AMC 21.06.020 Table 21.06-1 for the Anchorage Bowl. Chugiak-Eagle River, Girdwood and Downtown are not included.
- Lot lines and buildings come from GIS, not a survey, and may not show recent construction.
- The projection (NAD83 Alaska State Plane Zone 4, feet) has not yet been confirmed with MOA GIS.
- The aerial photo is the 2024 one. A 2026 photo service (`Photo_2026_Temp`) answers without a login but had no public catalog item on 2026-11-24, so it is left out until MOA GIS confirms it is meant to be public. The line to add it back is in a comment above `AERIALS` in `data.js`.
- Aerial photos are for orientation. Mapped lot lines can sit a few feet off the photo.
- "Read survey with AI" appears only when `config.js` names a survey reader and a survey has been uploaded. Its accuracy on real surveys has not been measured yet: that needs the 20 redacted as-builts from Development Services (`lambda/score_samples.py` is ready for them). On the three made-up samples, traced corners were within about a third of a foot and no fit verdict changed, but those are clean drawings. Until then, the only measure is how often people correct a tracing before accepting it (`lambda/correction_report.py`).

## Licence

MIT. See `LICENSE`.
