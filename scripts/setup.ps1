# LightMCP — Setup & Windows Task Scheduler Registration
# Run as Administrator for Task Scheduler registration
param(
    [switch]$RegisterTask,
    [switch]$UnregisterTask
)

$ErrorActionPreference = "Stop"
$TaskName = "LightMCP_AutoStart"

# ── Unregister ───────────────────────────────────────────────
if ($UnregisterTask) {
    Write-Host "`n🗑  Removing LightMCP startup task..."
    try {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "   ✅ Task removed"
    } catch {
        Write-Host "   ⚠️  Task not found or already removed"
    }
    exit 0
}

# ── Install Ollama ───────────────────────────────────────────
if (-not $RegisterTask) {
    Write-Host "`n🔍 Checking for Ollama..."

    $ollamaPath = (Get-Command "ollama" -ErrorAction SilentlyContinue)?.Source

    if (-not $ollamaPath) {
        Write-Host "📦 Ollama not found. Attempting installation via winget..."

        $winget = (Get-Command "winget" -ErrorAction SilentlyContinue)?.Source
        if ($winget) {
            winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements
        } else {
            Write-Host ""
            Write-Host "⚠️  winget not available. Please install Ollama manually:"
            Write-Host "   https://ollama.com/download/windows"
            Write-Host ""
            Write-Host "   After installation, re-run: lightmcp setup"
            exit 1
        }

        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")

        $ollamaPath = (Get-Command "ollama" -ErrorAction SilentlyContinue)?.Source
        if (-not $ollamaPath) {
            Write-Host "❌ Ollama installation failed. Please install manually."
            exit 1
        }
        Write-Host "✅ Ollama installed successfully"
    } else {
        Write-Host "✅ Ollama found at: $ollamaPath"
    }
}

# ── Register Task Scheduler ──────────────────────────────────
if ($RegisterTask -or (-not $RegisterTask)) {
    # Detect LightMCP executable / script
    $lightmcpDir = Split-Path -Parent $PSScriptRoot

    # Try compiled binary first, fallback to node
    $distCli = Join-Path $lightmcpDir "dist\cli\index.js"
    $nodeExe  = (Get-Command "node" -ErrorAction SilentlyContinue)?.Source

    if (-not $nodeExe) {
        Write-Host "❌ Node.js not found. Install Node.js 20+ from https://nodejs.org"
        exit 1
    }

    if (-not (Test-Path $distCli)) {
        Write-Host "⚠️  Compiled dist not found — building LightMCP..."
        Push-Location $lightmcpDir
        & npm run build
        Pop-Location
    }

    $action = New-ScheduledTaskAction `
        -Execute $nodeExe `
        -Argument "`"$distCli`" start" `
        -WorkingDirectory $lightmcpDir

    $trigger  = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Hours 0)  # No limit

    Write-Host "`n⏰ Registering Task Scheduler task: $TaskName"

    try {
        $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($existing) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        }

        Register-ScheduledTask `
            -TaskName $TaskName `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -RunLevel Highest `
            -Description "Starts the LightMCP MCP tool router on user login" | Out-Null

        Write-Host "   ✅ Task registered — LightMCP will start automatically on next login"
        Write-Host "   To start now: lightmcp start"
        Write-Host "   To remove:    powershell -File scripts\setup.ps1 -UnregisterTask"
    } catch {
        Write-Host "   ❌ Could not register task: $_"
        Write-Host "   Run this script as Administrator."
    }
}
