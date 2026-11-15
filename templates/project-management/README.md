# PlainScript Project Management

A persistent project/workspace/task API with a small browser client. The backend is written in PlainScript and uses Node's built-in SQLite driver through an explicit interop boundary.

## Run

```bash
npm install
DB_PATH=./project-management.db npm start
# open http://localhost:3000
```

Useful endpoints are `GET /api/projects`, `POST /api/projects`, `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/:id`, and `GET /api/dashboard`. JSON request bodies are validated server-side and SQLite data survives restarts when `DB_PATH` points to a file.

`src/app.pln` owns HTTP, persistence, validation, and domain operations. `src/client.pln` is the browser-facing PlainScript module and `src/shared.pln` contains shared records. The current slice intentionally leaves invitation delivery and external identity providers as extension points; no fake authentication is claimed.

Commands: `npm run check`, `npm run build`, `npm start`.
