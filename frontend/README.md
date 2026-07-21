# ERM Workstation — Frontend

React + Vite single-page app, built to static files and served by the
Express backend from `/public`. See `../docs/ARCHITECTURE.md` section 6
for the file structure (`App.jsx` routing, `pages/`, `components/`,
`translations.js`/`help-content.js` for the bilingual content) and
`../docs/API_REFERENCE.md` for the backend it talks to.

## Local development

```bash
npm install
npm run dev       # Vite dev server, proxies API calls to the backend
npm run build     # production build, output to ../public
```

This project was originally scaffolded from Vite's React template; no
template-specific setup steps remain relevant.
