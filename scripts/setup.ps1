# LightMCP - Setup & Windows Task Scheduler Registration
# Run as Administrator for Task Scheduler registration
param(
    [switch]$RegisterTask,
    [switch]$UnregisterTask
)

$ErrorActionPreference = "Stop"
$TaskName = "LightMCP_AutoStart"

# -- Unregister ---------------------------------------------------------------
if ($UnregisterTask) {
    Write-Host "`n[INFO] Removing LightMCP startup task..."
    try {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "   [OK] Task removed"
    } catch {
        Write-Host "   [WARN] Task not found or already removed"
    }
    exit 0
}

# -- Install Ollama -----------------------------------------------------------
if (-not $RegisterTask) {
    Write-Host "`n[INFO] Checking for Ollama..."

    $ollamaCmd = Get-Command "ollama" -ErrorAction SilentlyContinue
    $ollamaPath = $null
    if ($ollamaCmd) { $ollamaPath = $ollamaCmd.Source }

    if (-not $ollamaPath) {
        Write-Host "[INFO] Ollama not found. Attempting installation via winget..."

        $wingetCmd = Get-Command "winget" -ErrorAction SilentlyContinue
        $winget = $null
        if ($wingetCmd) { $winget = $wingetCmd.Source }
        
        if ($winget) {
            winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements
        } else {
            Write-Host ""
            Write-Host "[WARN] winget not available. Please install Ollama manually:"
            Write-Host "   https://ollama.com/download/windows"
            Write-Host ""
            Write-Host "   After installation, re-run: lightmcp setup"
            exit 1
        }

        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")

        $ollamaCmd = Get-Command "ollama" -ErrorAction SilentlyContinue
        $ollamaPath = $null
        if ($ollamaCmd) { $ollamaPath = $ollamaCmd.Source }
        
        if (-not $ollamaPath) {
            Write-Host "[ERROR] Ollama installation failed. Please install manually."
            exit 1
        }
        Write-Host "[OK] Ollama installed successfully"
    } else {
        Write-Host "[OK] Ollama found at: $ollamaPath"
    }
}

# -- Register Task Scheduler --------------------------------------------------
if ($RegisterTask -or (-not $RegisterTask)) {
    # Detect LightMCP executable / script
    $lightmcpDir = Split-Path -Parent $PSScriptRoot

    # Try compiled binary first, fallback to node
    $distCli = Join-Path $lightmcpDir "dist\cli\index.js"
    $nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
    $nodeExe = $null
    if ($nodeCmd) { $nodeExe = $nodeCmd.Source }

    if (-not $nodeExe) {
        Write-Host "[ERROR] Node.js not found. Install Node.js 20+ from https://nodejs.org"
        exit 1
    }

    if (-not (Test-Path $distCli)) {
        Write-Host "[WARN] Compiled dist not found - building LightMCP..."
        Push-Location $lightmcpDir
        & npm run build
        Pop-Location
    }

    # Create a .vbs launcher that runs node completely hidden (no window flash)
    $vbsLauncher = Join-Path $lightmcpDir "start_hidden.vbs"
    $vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """$nodeExe"" ""$distCli"" start", 0, False
"@
    Set-Content -Path $vbsLauncher -Value $vbsContent -Encoding ASCII

    $action = New-ScheduledTaskAction `
        -Execute "wscript.exe" `
        -Argument "//B `"$vbsLauncher`"" `
        -WorkingDirectory $lightmcpDir

    $trigger  = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Hours 0)  # No limit

    Write-Host "`n[INFO] Registering Task Scheduler task: $TaskName"

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

        Write-Host "   [OK] Task registered - LightMCP will start automatically on next login"
        Write-Host "   To start now: lightmcp start"
        Write-Host "   To remove:    powershell -File scripts\setup.ps1 -UnregisterTask"
    } catch {
        Write-Host "   [ERROR] Could not register task: $_"
        Write-Host "   Run this script as Administrator."
    }
}
