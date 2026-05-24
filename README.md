# Oligo App

Internal lab management system for oligo synthesis operations.

## What it does

- Import customer orders from `.docx` files or pasted text
- Manage sequences, customers, and order lines
- Build and track synthesis runs (plate layout, reagents, CPG lots)
- Record per-well results (OD, purity, MS, CE)
- Generate shipping label `.docx` documents
- Manage modification catalog and material lots

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite |
| Backend | Node.js + Express 5 |
| Database | PostgreSQL |

## Project structure

```
oligo-app/
├── backend/        # Express API server (server.js)
├── frontend/       # React app (Vite)
└── db/             # SQL migration files (migrate_001.sql … migrate_017.sql)
```

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL (database: `oligosynth`)

### Database

Run all migrations in order against your PostgreSQL instance:

```bash
psql -h localhost -U <user> -d oligosynth -f db/migrate_001.sql
psql -h localhost -U <user> -d oligosynth -f db/migrate_002.sql
# ... repeat through migrate_017.sql
```

### Backend

```bash
cd backend
npm install
```

Create a `.env` file (not committed):

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=oligosynth
PORT=3001
```

Start the server:

```bash
node server.js
```

The API runs on `http://localhost:3001`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs on `http://localhost:5173` by default.

## Authentication

The app uses HTTP Basic Auth — the username and password you enter at login are passed directly as PostgreSQL credentials. Make sure the PostgreSQL user has appropriate permissions on the `oligosynth` database.

## Notes

- `backend/logo.png` is used in generated shipping label documents
- The `db/` folder contains all schema migrations; run them sequentially on a fresh database to build the full schema
