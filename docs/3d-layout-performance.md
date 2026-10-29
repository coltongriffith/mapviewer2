# Loaded-project Layout responsiveness

Layout editing rebuilt the complete 3D scene for every block option and hole
selection. This disposed terrain, wall and assay resources even for a text
change. The preview also repainted an unchanged scene on every animation frame,
competing with menu and input handling on larger projects.

The fix retains the scene for presentation edits and refreshes only the trace
sets for visibility changes. Switching the block look on/off still rebuilds when
necessary. Unit-label and side-title transitions update their wall labels, and
switching back from overlaid traces explicitly restores assay tube visibility.

The preview repaints on state revision, camera movement, resizing or font
readiness. Crew animation keeps its continuous loop. A one-second refresh covers
late image textures. Exports continue to render the complete scene at the chosen
size; no sampling, geometry resolution or scientific calculation is reduced.

## Local measurements

Both versions used the same loaded fixture: 102 holes and roughly 23,000 assay
intervals made from three ID-renamed copies of the bundled fictional sample.
This is synthetic QA data. No user project was read or changed. The baseline was
main 0726eacb, with the same eight-frame warm-up and software-rendered Chromium.

| Operation | Baseline | Fixed |
|---|---:|---:|
| Idle preview paints over 8 animation ticks | 8 | 0 |
| Open hole chooser | 4,447 ms | 96–105 ms |
| Edit block info text | 397 ms | 48–51 ms |
| GPU buffers destroyed by that text edit | 37 | 0 |

Preset computation itself remained around 0.8 seconds: it legitimately changes
the block extent and model presentation. These are local fixture measurements,
not a promise of the same timings on other hardware or datasets.

The before/after exported PNGs matched the original baseline byte for byte.
Regression checks cover hide/show restoration, tube/overlay restoration, live
camera updates, framing and PNG downloads, geology/unit labels, bracket exports,
hole-colour bars and crew rendering. The committed performance test keeps its
resource and output assertions enabled; diagnostic-only baseline runs live
outside the published source checkout.
