# TCC Lanyards PDF Fill

Static site for filling the TCC lanyard PDF and downloading a flattened copy.

## Notes
- The PDF template lives at `assets/TCC-Lanyards-Fillable-Template.pdf`.
- Fonts live at `assets/fonts/` and are used for on-screen editing and rasterized output.
- Field styling rules live in `getFieldStyle` inside `app.js`.
- Field names are logged to the browser console on load.

## Local preview
Run any static server in this folder and open `index.html`.

Example:
```
python3 -m http.server 8000
```
