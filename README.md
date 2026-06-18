# Side Quest API

Backend for the Side Quest mobile app. Deploy this folder to Render.

## Local setup

```bash
cd /Users/mohammadothman/Documents/side-quest-api
npm install
cp .env.example .env
# Edit .env — paste External Database URL from Render → side-quest-db → Connect
# The path must end with /side-quest-db
npm run dev
```

Test: http://localhost:4000/health

## Render deploy

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Environment:** copy variables from `.env.example`
