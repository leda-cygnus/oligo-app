# Oligo App

Internal lab management system for oligo synthesis operations.

## What it does

- Import customer orders from `.docx` files or pasted text
- Manage sequences, customers, and order lines
- Build and track synthesis runs (plate layout, reagents, CPG lots)
- Record per-well results (OD, purity, MS, CE)
- Generate shipping label `.docx` documents
- Create and manage sales quotes with per-oligo pricing, discounts, and VAT
- Export quotes as formatted `.docx` documents
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
└── db/             # SQL migration files (migrate_001.sql … migrate_018.sql)
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
# ... repeat through migrate_018.sql
```

### Backend

```bash
cd backend
npm install
```

Copy `.env.example` to `.env` and fill in your values (the file is gitignored):

```bash
cp .env.example .env
```

The `.env` includes database connection settings and company details used in generated documents (shipping labels, quote exports). See `.env.example` for all available keys.

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

## Quotes

Quotes are linked to orders. From any order's action menu, choose **Create quote** or **View quote** to open the quote editor.

- Pricing: `sequence length × base price per nt + purification surcharge`
- Surcharge values are configurable via the ⚙ Surcharges button in the editor
- Discounts can be applied as a percentage, a fixed amount, or both
- VAT is applied on top of the discounted net price
- Quotes can be exported as a `.docx` file using the **Download .docx** button (visible after saving)

Pricing defaults and company details (name, address, phone, rep name/email) are configured in `backend/.env`.

## Notes

- `backend/logo.png` is used in generated shipping label and quote documents
- The `db/` folder contains all schema migrations; run them sequentially on a fresh database to build the full schema
