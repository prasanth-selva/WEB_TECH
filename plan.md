# PulseBoard implementation plan

## Product and implementation
PulseBoard is a real-time classroom task board. Users authenticate with an email/password account, view one shared class board grouped by status, create/update/delete records through JSON REST endpoints, and receive WebSocket updates when another classmate changes the board. Express serves both `/api` and static assets, SQLite persists users and tasks, and Socket.IO distributes authorized class-wide events.

## Project structure
- `server.js` — Express app, REST API, authentication, Socket.IO authorization/broadcasting, input validation, centralized errors, static hosting.
- `src/database.js` — SQLite connection, users/tasks schema, initialization, demo-user seed, prepared data access.
- `public/index.html` — semantic application shell and auth/board views.
- `public/styles.css` — responsive product UI, status colors, accessible control states.
- `public/app.js` — fetch-based JSON client, bearer-token auth, Socket.IO client, CRUD interactions, user-facing error/status handling.
- `public/manus-routes.json` — public page-route manifest.
- `docs/` — assignment documentation source and captured screenshots.
- `data/` — runtime SQLite database, excluded from Git.

## API and event design
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`: account creation, login, and token identity. JWT is validated by protected middleware.
- `GET /api/tasks?status=&q=`: retrieve the shared classroom task list, with optional filters.
- `POST /api/tasks`: validate and persist a new task; broadcast `task:created`.
- `PUT /api/tasks/:id`: validate and persist task changes; broadcast `task:updated`.
- `DELETE /api/tasks/:id`: delete the owned task; broadcast `task:deleted`.
- Socket.IO connection authentication uses the same JWT, with task events and presence distributed to the authenticated class room. Server-originated task events include a compact JSON task payload and actor identity.
- API responses use `{ success, data }`; failures use `{ success: false, error: { code, message } }` and meaningful HTTP status codes.

## Security and data integrity
Passwords are hashed with bcrypt; JWTs are short-lived and sent in the `Authorization: Bearer` header. Helmet applies secure headers, rate limiting protects authentication, request bodies and task fields are validated and bounded, SQL uses prepared statements, and task APIs require authentication. The demonstration classroom is intentionally a shared workspace: all authenticated classmates can view and update board tasks. Client-rendered user content uses `textContent` rather than HTML insertion.

## Visual direction
- **Design movement:** editorial productivity software with a dark, ink-blue canvas and bright mint signal color.
- **Core principles:** calm hierarchy, visible live status, low-friction task capture, legible state changes.
- **Color philosophy:** navy grounds the workspace; warm off-white panels support reading; mint marks live/active states while coral and gold distinguish priority.
- **Layout paradigm:** compact command rail and header above a spacious three-lane kanban workspace; a persistent activity rail provides live context.
- **Signature elements:** live pulse indicator, numbered status chips, slim colored priority edge on task cards.
- **Interaction philosophy:** optimistic but server-confirmed mutations; inline status transitions and clear undo/error cues.
- **Animation:** brief fades and 160–220 ms transitions; no motion that obscures content; respect reduced-motion settings.
- **Typography:** system sans for interface text, mono for IDs/timestamps; sizes follow a clear title / label / body hierarchy.
- **Brand essence:** a live classroom coordination board for learners and instructors; focused, dependable, lively.
- **Brand voice:** concise, supportive, action-oriented. Examples: “Keep the class moving.” and “A change on the board appears here instantly.”
- **Wordmark & logo:** compact pulse-wave mark beside the PulseBoard wordmark.
- **Signature brand color:** vivid mint `#57E6B1`.

## Running and evidence
Run `npm install`, configure `JWT_SECRET` (or use the development-only fallback), then `npm run dev`. The demo user is seeded on first startup. SQLite data is local in `data/pulseboard.sqlite`. The assignment report will include a system architecture diagram, endpoint and schema summaries, validation/error details, verified test evidence, screenshots of login and the authenticated real-time board, and setup instructions.
