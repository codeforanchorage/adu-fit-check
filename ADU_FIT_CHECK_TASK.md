# ADU Fit Check: work order for Claude Code

## Goal

Turn the single-file prototype (`index.html` in this repo) into a small open-source web app the Municipality of Anchorage can host. A homeowner types an address or uploads a survey, places a pre-approved ADU design on their lot, and sees where it fits (green), where it does not (red), and why.

Results are screening only. Zoning staff make the determination. Keep that statement on every screen and in every exported summary.

## What already works in `index.html`

- Canvas drawing: background image, lot lines, buildings, no-build areas, draggable ADU, fit map, distance lines.
- Rule check (`check()`): setbacks by lot-line type, alley exemption, building overlap, no-build overlap, lot coverage, ADU floor-area cap.
- District table (`DIST`) from AMC 21.06.020 Table 21.06-1, single-family detached rows, Anchorage Bowl only.
- ADU rules from AMC 21.05.070D.1.
- Manual tracing: scale, lot lines, buildings, no-build areas.
- Upload of an image or PDF (pdf.js from cdnjs).
- Two features that only run inside claude.ai and must be replaced: `window.claude.use("sample")` (AI reads the survey) and `window.claude.use("mcp")` (address lookup through the Anchorage Parcels and Anchorage GIS connectors).

## Phase 1: stand-alone address lookup (no Claude runtime)

Replace the `mcp` calls in `lookup()` with direct ArcGIS REST queries. The services are public and allow cross-origin requests.

1. Parcel by address
   - Layer: `https://services2.arcgis.com/Ce3DhLRthdwbHlfF/arcgis/rest/services/PropertyInformation_Hosted/FeatureServer/0`
   - `where=Parcel_Address LIKE '%<ADDRESS UPPERCASE>%' AND GIS_Category='Parcel' AND Parcel_ID IS NOT NULL`
   - `outFields=Parcel_ID,Parcel_Address,Zoning_District,Lot_Size`, `returnGeometry=true`, `f=geojson`
   - Never request or display `Owner_Name` or the mailing address.
   - Show a pick list when more than one parcel matches.
2. Buildings on the parcel
   - Buildings_Hosted, ArcGIS Online item `56d274594cbc4aa8bac4257edd06d6cf`. Resolve its FeatureServer URL from the item, then query with the parcel polygon as `geometry`, `spatialRel=esriSpatialRelIntersects`, `f=geojson`.
   - Do NOT pass `maxAllowableOffset`. The MCP path simplifies geometry to about 5 m, which turns garages into triangles. The prototype works around that with bounding boxes (`obox()`); delete that workaround once exact outlines arrive.
   - Clip each building to the parcel polygon (attached and zero-lot-line housing shares footprints across lots). Use Turf.js `intersect`.
3. Projection
   - Request geometry in a projected coordinate system in feet or metres (`outSR`). Confirm the right local system with MOA GIS before choosing; EPSG:3338 (Alaska Albers) is equal-area and is what the existing coverage tooling uses. Never compute area from Web Mercator `Shape__Area` (about 4.26 times too large at Anchorage's latitude).
   - Remove the hand-rolled degrees-to-feet conversion in `sceneFromGIS()` once geometry arrives projected.
4. Front lot line
   - The prototype guesses the front as the short lot line nearest the largest building. Replace the guess: intersect lot edges with the road right-of-way or street centreline layer (find it with the Anchorage GIS catalog) and mark the edge that touches a street as front, and an edge that touches an alley as alley. Corner lots have two street edges; ask the user which is the front.
5. Zoning district
   - `Zoning_District` is not normalised (`R1` and `R-1` both occur). Keep the normaliser. For districts not in `DIST`, show the message that setbacks must be set by hand. Add Chugiak-Eagle River (AMC 21.10) and Girdwood (AMC 21.09) tables only after Planning confirms the values.

Acceptance: typing an address draws exact lot lines and building outlines with no connector, and the plan-check table matches a hand calculation on three test parcels chosen with Development Services.

## Phase 2: property flags from map layers

Fill the "Other reviews this lot may need" checkboxes from GIS instead of asking the homeowner. Source text for each is the Pre-Approved ADU Plans permit checklist (March 2026).

| Flag | Rule | Layer to find |
|---|---|---|
| Geotechnical | Seismic hazard zone 4 or 5 | seismic hazard zones |
| Flood | In or within 300 ft of a flood zone | FEMA / MOA flood zones, buffered 300 ft |
| Steep slope | Average lot slope over 20% | slope or elevation model |
| Well and septic | Outside the water and wastewater service area | AWWU service area (may need a data request to AWWU) |
| Right of Way | New driveway or utility extension | cannot be derived; keep as a user checkbox |

Keep each flag editable by the user and show the source layer and its date beside it.

## Phase 3: aerial photo under the drawing

Add the Municipality's aerial imagery as an optional background (find the current imagery service in the MOA GIS catalog; use `exportImage` or tiles for the parcel's bounding box in the same projection). Add a toggle between "Drawing" and "Aerial". Do not use Google Maps or Street View tiles in the canvas; their terms do not allow it. A "See street view" link that opens Google Maps in a new tab is fine.

## Phase 4: AI reads an uploaded survey

Replace `window.claude.use("sample")`.

- Add a small server-side function (AWS Lambda behind API Gateway, same pattern as the MCP fleet) that accepts the survey image and returns the JSON described in `AI_PROMPT`. The model API key stays on the server. Never put a key in the page.
- Apply the fleet cost controls from `COST_CONTROLS.md`: reserved concurrency, stage throttles, request-spike alarm, log retention, tags.
- Limit uploads to 10 MB, images and PDFs only. Do not store uploads unless the homeowner chooses "save to my permit file"; that feature waits for a records decision by Development Services.
- Always show the tracing for the homeowner to confirm before any result is shown as final. Log, without the image, how often people correct the tracing; that is the accuracy measure for the pilot.
- Build an evaluation set of 20 redacted real as-builts from Development Services with hand-traced answers. Report corner error in feet and whether the fit verdict changes.

## Phase 5: pre-approved plan catalog

Replace `PRESETS` with the real footprints from the Municipality's pre-approved ADU catalog (www.muni.org/ADU): plan name, width, depth, height, floor area, and any Girdwood restriction. Store as `plans.json`. Non-rectangular footprints need polygon support in `aduPoly()`.

## Engineering notes

- Split `index.html` into `geometry.js` (pure functions), `rules.js` (`DIST`, `check()`), `data.js` (ArcGIS calls), `ui.js`. Keep it dependency-light: no framework needed.
- Unit-test `geometry.js` and `rules.js` (Vitest). Minimum cases: ADU touching a lot line, alley edge, rotated ADU, concave lot, coverage exactly at the cap, 900 sq ft / 40% / 1,200 sq ft size rule.
- Every rule in `rules.js` carries its code citation in a comment and in the UI text. When the code changes, the citation is how someone finds what to update. Check current text with the Anchorage Municipal Code MCP server before changing any number.
- Accessibility: WCAG 2.1 AA. The canvas needs a text equivalent; the plan-check table is that equivalent, so keep it complete. Keyboard movement of the ADU already works with arrow keys.
- Hosting: static files (S3 + CloudFront or GitHub Pages) plus the one Lambda from Phase 4.
- Licence: open source (MIT or Apache-2.0). The Cities Deliver grant requires software built with grant funds to be published under an open-source licence.
- Privacy: no owner names, no analytics that record addresses, no uploads kept by default.

## Not in scope

- Any statement that a project is approved or permitted.
- Building-code checks (fire separation, egress, energy).
- Accepting permit applications.

## How to start

```
cd C:\projects
git clone https://github.com/codeforanchorage/adu-fit-check   (create the repo first)
copy index.html and this file into it
claude
> Read ADU_FIT_CHECK_TASK.md. Do Phase 1 only. Start by splitting index.html as described in Engineering notes and adding tests for the existing check(), then replace the address lookup. Show me the plan before you change files.
```
