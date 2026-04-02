# Phase 1 QA Checklist

Manual regression tests for the critical trust flow. Run after any non-trivial change before sharing with users.

---

## 1. Core Flow — Home → Editor → Project → Back → Re-enter

- [ ] Load the app. Landing page renders correctly (no blank screen, no console errors).
- [ ] Click **Open Map Editor**. Editor screen appears with empty canvas and sidebar.
- [ ] Map tiles load (light basemap visible). No grey canvas.
- [ ] Click **Home**. Landing page reappears correctly.
- [ ] Click **Open Map Editor** again. Editor reappears. **Map tiles load. No grey screen.**
- [ ] Repeat Home → Editor cycle 3 times. Map renders correctly every time.

---

## 2. Upload + Save + Reopen Flow

- [ ] In the editor, drag a `.geojson` or `.zip` file onto the upload panel (or use the file picker).
- [ ] Layer appears in the layer list. Map auto-fits to the data.
- [ ] Click **Save**. Status bar shows "Saved project: [name]".
- [ ] Click **Home**, then **Open Map Editor**.
- [ ] Click **Open** (top bar). Recent Projects modal appears with the saved project.
- [ ] Click the saved project. It loads. Layer list is populated. Map renders with data. No grey screen.

---

## 3. Draft Recovery

- [ ] Open the editor, make a change (e.g. edit the title), do **not** save.
- [ ] Reload the page (Cmd/Ctrl+R).
- [ ] Click **Open Map Editor**.
- [ ] A yellow draft recovery banner appears at the top of the map area: "Draft recovered: [name] — saved [time]"
- [ ] "Keep Draft" button dismisses the banner and keeps the draft state.
- [ ] Reload again. Click **Open Map Editor**. Click **Start Fresh**. Editor resets to a blank project. Banner disappears.
- [ ] Reload again. If no meaningful draft exists, no banner appears.

---

## 4. Rename Project

- [ ] Save a project (so it appears in Recent Projects).
- [ ] Click **Open** (top bar). Hover over a project row — **Rename** and **Delete** buttons appear.
- [ ] Click **Rename**. An inline input appears with the current name pre-filled.
- [ ] Edit the name and press Enter (or click **Save**). The project row updates immediately.
- [ ] If the renamed project is the currently active project, the top bar title updates too.
- [ ] Press **Escape** or **Cancel** to abort — name stays unchanged.

---

## 5. Delete Project

- [ ] Click **Open** (top bar). Click **Delete** on a project row.
- [ ] Confirm dialog appears: "Delete this project? This cannot be undone."
- [ ] Clicking **OK** removes the project from the list immediately.
- [ ] Clicking **Cancel** keeps the project unchanged.
- [ ] **Delete the currently active project**: after confirming, the editor resets to a new blank workspace.

---

## 6. Export Project File

- [ ] In the editor, click **Export File** (top bar).
- [ ] A `.mapviewer.json` file downloads to your machine.
- [ ] Open the file in a text editor — confirm it contains `version`, `name`, `payload`, `exportedAt` fields.
- [ ] `payload.layers` is an array. `payload.layout` is an object.

---

## 7. Import Project File

- [ ] Click **New / Clear** to reset to a blank workspace.
- [ ] Click **Import File** (top bar). Select the `.mapviewer.json` file exported in step 6.
- [ ] Project loads: layers, title, layout, callouts all restored.
- [ ] Status bar shows "Imported project file: [name]".
- [ ] Try importing an invalid file (e.g. a plain text file renamed to `.json`). Status bar shows a readable error. App does not crash.

---

## 8. Load Demo

- [ ] From the landing page, click **Try Demo**.
- [ ] Editor opens with the Goldridge Property demo project loaded.
- [ ] Two layers visible: "Mineral Claims" (polygons) and "Drillholes" (points).
- [ ] Map auto-fits to the claims area in northern BC.
- [ ] Two callouts visible. One ellipse highlight zone visible.
- [ ] From the editor top bar, click **Load Demo** — same result as above.

---

## 9. Export PNG / SVG

- [ ] With a project containing at least one layer, click **Export PNG**.
- [ ] A PNG file downloads. Open it — map, legend, title, callouts all render.
- [ ] Click **Export SVG**. An SVG file downloads. Open it — confirms vector output.
- [ ] Export buttons are disabled (greyed) while export is in progress.

---

## 10. Sentry (smoke test)

- [ ] In `.env.local`, leave `VITE_SENTRY_DSN` empty.
- [ ] Load the app. No Sentry initialization errors in the console.
- [ ] Temporarily set `VITE_SENTRY_DSN` to a real DSN and confirm that errors surface in the Sentry dashboard.

---

## 11. Analytics (smoke test)

- [ ] In `.env.local`, leave `VITE_ANALYTICS_KEY` empty.
- [ ] Open DevTools console. Perform actions: enter editor, save, open project, load demo, export.
- [ ] Each action logs a `[analytics:disabled]` message to the console (dev mode only).
- [ ] No analytics calls reach any external service when key is empty.

---

## 12. Build Check

```
npm run build
```

- [ ] Build completes with no errors.
- [ ] No missing module warnings for the new files: `analytics.js`, `projectFile.js`, `demoProject.js`.
- [ ] Output bundle size is acceptable (check `dist/assets/*.js`).

---

## Known Limitations (Phase 1)

- Rename input does not support multi-line names (by design, names should be short).
- Draft banner appears on every load if the user never saves; a "don't show again" preference is a Phase 2 improvement.
- Analytics provider is a stub — no data is collected until a provider SDK is configured in `src/utils/analytics.js`.
- Sentry error boundary shows a minimal fallback; a more polished error page is a Phase 2 improvement.
