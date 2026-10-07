# PulseBoard — Real-Time Classroom Task Board

PulseBoard is a full-stack classroom collaboration demo. Authenticated users manage persistent tasks through a JSON REST API, while Socket.IO broadcasts task changes to active sessions without a page refresh.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
# Recommended outside the classroom demo:
export JWT_SECRET="replace-with-a-long-random-secret"
npm start
```

Open <http://localhost:3000>. The first start seeds a local SQLite demo account:

- Email: `demo@pulseboard.app`
- Password: `Classroom2026!`

The seed user has three sample tasks. Registration creates a separate authenticated classmate account; all authenticated accounts participate in the same shared classroom board. The database is created at `data/pulseboard.sqlite`. Do not use the development JWT fallback for a public deployment; set a unique secret using the environment.

## Architecture

```text
Browser (HTML/CSS/JS)
  ├── JSON fetch + Bearer JWT ──> Express REST API ──> SQLite (better-sqlite3)
  └── Socket.IO + JWT ──────────> Authenticated class room
                                      └── task:created / task:updated / task:deleted
```

| Method | Endpoint | Purpose | Success |
|---|---|---|---|
| `POST` | `/api/auth/register` | Validate and create account | `201` + token |
| `POST` | `/api/auth/login` | Verify password and issue JWT | `200` + token |
| `GET` | `/api/auth/me` | Resolve current user | `200` |
| `GET` | `/api/tasks` | List tasks; optional `status` and `q` filters | `200` |
| `POST` | `/api/tasks` | Create a task | `201` |
| `PUT` | `/api/tasks/:id` | Update task fields/status | `200` |
| `DELETE` | `/api/tasks/:id` | Delete a classroom task | `200` |
| `GET` | `/api/health` | Liveness and database probe | `200` |

Authenticated task APIs require `Authorization: Bearer <token>`. Responses use `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`. Socket messages use JSON objects containing the changed task, actor, and event time; events are delivered to the authenticated class room. This teaching demo models one shared class; production systems should add workspace membership and room authorization.

## Data and security notes

SQLite stores `users` and `tasks`; foreign keys cascade user deletion, creator IDs provide task attribution, and a status/update index supports board retrieval. Passwords are bcrypt hashes. JWTs expire after eight hours. Helmet security headers, a 32 KB JSON body limit, rate limiting on authentication routes, email/title/description/status/priority validation, and prepared SQL statements are included. Task CRUD is shared by authenticated members of this demonstration class. The client inserts untrusted strings with `textContent`.

This is a classroom-scale single-process demonstration. For a production multi-instance deployment, use a shared database, a Socket.IO adapter, refresh/revocation strategy, HTTPS, operational secrets management, and backup/monitoring controls.

## Verify

```bash
npm test
```

The automated integration test checks registration/login, unauthenticated rejection, GET/POST/PUT/DELETE, malformed input, shared access across accounts, persistence reads, and a real Socket.IO event delivered from one account to another.

## Project report

See [`docs/Assignment-Documentation.pdf`](docs/Assignment-Documentation.pdf) and [`docs/Assignment-Documentation.docx`](docs/Assignment-Documentation.docx). The report includes architecture, API and schema details, security/error handling, tested workflows, and screenshots from the running app.
