# setup.ps1 - Oligo App setup script
# Checks prerequisites, installs npm packages, and optionally runs database migrations.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step { param($msg) Write-Host "" ; Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "   OK   $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "   WARN $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "   FAIL $msg" -ForegroundColor Red; exit 1 }

# 1. Node.js
Write-Step "Checking Node.js (18+ required)..."
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "   Node.js not found." -ForegroundColor Red
    Write-Host "   Download and install from: https://nodejs.org" -ForegroundColor Yellow
    exit 1
}
$nodeVersion = & node --version
$major = [int]($nodeVersion -replace "v(\d+)\..*", '$1')
if ($major -lt 18) {
    Write-Host "   Node.js $nodeVersion found but version 18+ is required." -ForegroundColor Red
    Write-Host "   Download from: https://nodejs.org" -ForegroundColor Yellow
    exit 1
}
Write-Ok "Node.js $nodeVersion"

# 2. PostgreSQL
Write-Step "Checking PostgreSQL (psql)..."
$psqlCmd = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlCmd) {
    Write-Host "   psql not found in PATH." -ForegroundColor Yellow
    Write-Host "   Install PostgreSQL from: https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
    Write-Host "   After installing, add the PostgreSQL bin directory to your PATH." -ForegroundColor Yellow
    $cont = Read-Host "   Continue without psql? (y/N)"
    if ($cont -ne "y") { exit 1 }
} else {
    $psqlVersion = & psql --version
    Write-Ok "$psqlVersion"
}

# 3. Backend npm install
Write-Step "Installing backend packages..."
Push-Location (Join-Path $root "backend")
npm install
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "npm install failed in backend/" }
Pop-Location
Write-Ok "backend packages installed"

# 4. Frontend npm install
Write-Step "Installing frontend packages..."
Push-Location (Join-Path $root "frontend")
npm install
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "npm install failed in frontend/" }
Pop-Location
Write-Ok "frontend packages installed"

# 5. .env setup
Write-Step "Checking backend\.env..."
$envPath    = Join-Path $root "backend\.env"
$envExample = Join-Path $root "backend\.env.example"
if (-not (Test-Path $envPath)) {
    Copy-Item $envExample $envPath
    Write-Warn ".env created from .env.example"
    Write-Host "   Edit backend\.env before starting the server:" -ForegroundColor Yellow
    Write-Host "     DB_HOST, DB_PORT, DB_NAME, DB_USER (if needed)" -ForegroundColor Yellow
    Write-Host "     COMPANY_NAME, COMPANY_ADDRESS, etc." -ForegroundColor Yellow
} else {
    Write-Ok ".env already exists"
}

# 6. Database migrations (optional)
Write-Step "Database migrations"
Write-Host "   The schema is built by running SQL files in db/ (migrate_001.sql ... migrate_026.sql)." -ForegroundColor Gray
Write-Host "   Only run these on a fresh, empty database - they are not safe to re-run." -ForegroundColor Yellow

$psqlAvailable = $null -ne (Get-Command psql -ErrorAction SilentlyContinue)
if (-not $psqlAvailable) {
    Write-Host "   Skipped (psql not available). See README.md for manual migration instructions." -ForegroundColor Gray
} else {
    $runMigrations = Read-Host "   Run all migrations now? (y/N)"
    if ($runMigrations -eq "y") {
        $pgUser = Read-Host "   PostgreSQL username"
        $pgHost = Read-Host "   PostgreSQL host [press Enter for localhost]"
        if (-not $pgHost) { $pgHost = "localhost" }
        $dbName = "oligosynth"

        Write-Host "   Creating database $dbName if it does not exist..." -ForegroundColor Gray
        & psql -h $pgHost -U $pgUser -c "CREATE DATABASE $dbName;"

        $migDir = Join-Path $root "db"
        $files  = Get-ChildItem $migDir -Filter "migrate_*.sql" | Sort-Object Name

        $ok = $true
        foreach ($file in $files) {
            Write-Host "   Applying $($file.Name)..." -ForegroundColor Gray -NoNewline
            & psql -h $pgHost -U $pgUser -d $dbName -f $file.FullName
            if ($LASTEXITCODE -ne 0) {
                Write-Host " FAILED" -ForegroundColor Red
                $ok = $false
                break
            }
            Write-Host " done" -ForegroundColor Green
        }

        if ($ok) {
            Write-Ok "All $($files.Count) migrations applied."
        } else {
            Write-Host "   Migration failed - check the output above." -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "   Skipped. See README.md for manual migration instructions." -ForegroundColor Gray
    }
}

# Done
Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Edit backend\.env with your database credentials and company details"
Write-Host "  2. Start the backend:   cd backend ; node server.js"
Write-Host "  3. Start the frontend:  cd frontend ; npm run dev"
Write-Host "  4. Open http://localhost:5173 in your browser"
Write-Host ""