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
- Manage modification catalog and material lots (name, CAS number, lot tracking)
- Track NHS ester modification delivery and post-synthesis conjugation info per run

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite |
| Backend | Node.js + Express 5 |
| Database | PostgreSQL |

## Project structure

```
oligo-app/
├── backend/        # Express API server (server.js, idgen.js)
├── frontend/       # React app (Vite)
└── db/             # SQL migration files (migrate_001.sql … migrate_026.sql)
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
# ... repeat through migrate_026.sql
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

### Quote & sales order numbering

Each quote is assigned a human-readable ID on creation, e.g. `Q-2026-K4M9R`.

| Part | Example | Description |
|---|---|---|
| Prefix | `Q` / `SO` | `Q` for quotes, `SO` for sales orders |
| Year | `2026` | 4-digit year of creation |
| Suffix | `K4M9R` | 5-character random alphanumeric, uppercase, excluding ambiguous characters (`0`, `1`, `O`, `I`) |

When a quote is converted to a sales order the suffix is preserved and only the prefix changes (`Q-2026-K4M9R` → `SO-2026-K4M9R`).

The database also stores an internal sequential counter per entity type (e.g. `0047`) that is never exposed in the UI or documents. All list ordering is by `created_at` timestamp, not by ID.

ID generation lives in `backend/idgen.js`. Run the unit tests with:

```bash
cd backend && node test-idgen.js
```

## Material lots

Each lot entry stores:

| Field | Description |
|---|---|
| `canonical_name` | Linking key that matches the lot to reagent/amidite/CPG slots in a run |
| `name` | Full vendor product name (display only, shown in Run Detail reagent table) |
| `cas_number` | CAS registry number |
| `catalogue_number` | Vendor catalogue number |
| `lot_number` | Manufacturer lot number |
| `manufacturer` / `vendor` | Source |
| `mw` / `fw` | Molecular weight / formula weight (Da) |
| `mw_addition` | Net MW added to the oligo per coupling/conjugation event (shown as **Conj. FW** in the table) |

Multiple lots with different names or lot numbers can share the same `canonical_name`.

The material lots table supports click-to-sort on all columns; clicking the same column header a second time reverses the sort direction. Received and expiry dates are stored but not shown in the table view (still editable in the form).

## NHS ester modifications

When building a synthesis run, each modification can be assigned a delivery method:

- **Amidite** (default) — standard phosphoramidite coupling, assigned to a machine position (1–8)
- **NHS ester** — post-synthesis conjugation via AmMC6 linker

For NHS ester mods the Run Builder and Run Detail both show:

- **AminoMod C6 reagent lot** — the C6-amino linker amidite used during synthesis
- **Conjugation section** — one row per NHS ester mod with fields: material lot (for MW lookup), NHS ester reagent lot, date conjugated, operator, notes

The conjugation section has its own **Save conjugation** button that calls `PUT /api/runs/:id/conjugation` independently of the main reagents save.

Schema notes:
- `migrate_020.sql` adds `delivery_method` to `synthesis_run_mod_map` and creates `synthesis_run_conjugation`
- `migrate_024.sql` drops the unique constraint on `(run_id, synth_slot)` so multiple NHS ester dyes can share the same aminomodifier slot
- `migrate_025.sql` adds `material_lot_id` to `synthesis_run_conjugation` for conjugate MW lookup

## Notes

- `backend/logo.png` is used in generated shipping label and quote documents
- The `db/` folder contains all schema migrations; run them sequentially on a fresh database to build the full schema
- `migrate_023.sql` drops the unique index on sequence checksum so multiple oligos with the same base sequence (e.g. same sequence with different modifications) can coexist in one order
- `migrate_026.sql` expands the `material_type` check constraint to include `nhs` (NHS ester reagent lots)
