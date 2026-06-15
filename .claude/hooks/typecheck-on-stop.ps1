try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $payload = $raw | ConvertFrom-Json

    # Guard 1: skip unless this turn's assistant messages contain a tool_use
    # that edited a .ts or .tsx file. Read the transcript JSONL from the path
    # the harness provides and scan only the entries after the most recent
    # user message (= the assistant's response in the turn that is ending).
    $touchedTs = $false
    $transcriptPath = $payload.transcript_path

    if ($transcriptPath -and (Test-Path $transcriptPath)) {
        $lines = @(Get-Content -Path $transcriptPath -ErrorAction SilentlyContinue)

        if ($lines.Count -gt 0) {
            $lastUserIdx = -1
            for ($i = $lines.Count - 1; $i -ge 0; $i--) {
                try {
                    $entry = $lines[$i] | ConvertFrom-Json
                }
                catch {
                    continue
                }
                if ($entry.type -eq 'user') {
                    $lastUserIdx = $i
                    break
                }
            }

            if ($lastUserIdx -ge 0) {
                $editToolNames = @('Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'str_replace_based_edit_tool', 'write_file')
                $tsExtensions = @('.ts', '.tsx')

                for ($i = $lastUserIdx + 1; $i -lt $lines.Count; $i++) {
                    try {
                        $entry = $lines[$i] | ConvertFrom-Json
                    }
                    catch {
                        continue
                    }
                    if ($entry.type -ne 'assistant') { continue }
                    $content = $entry.message.content
                    if (-not $content) { continue }
                    foreach ($block in $content) {
                        if ($block.type -ne 'tool_use') { continue }
                        if ($editToolNames -notcontains $block.name) { continue }
                        $filePath = $block.input.file_path
                        if (-not $filePath) { continue }
                        $ext = [System.IO.Path]::GetExtension([string]$filePath).ToLower()
                        if ($tsExtensions -contains $ext) {
                            $touchedTs = $true
                            break
                        }
                    }
                    if ($touchedTs) { break }
                }
            }
        }
    }

    if (-not $touchedTs) { exit 0 }

    # Guard 2: skip if no tsconfig.json in cwd (= project root when Claude Code
    # invokes the hook).
    if (-not (Test-Path 'tsconfig.json')) { exit 0 }

    # Guard 3: skip if typescript is not installed in the project's node_modules.
    # Avoids npx silently fetching a transient typescript install.
    if (-not (Test-Path 'node_modules\typescript')) { exit 0 }

    # Run `npx tsc --noEmit` with a 60-second timeout. .NET Process API gives
    # explicit handle on the timeout and exit code without temp-file dance.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = 'cmd.exe'
    $startInfo.Arguments = '/c npx tsc --noEmit'
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    $startInfo.WorkingDirectory = (Get-Location).Path

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $startInfo
    [void]$proc.Start()

    if (-not $proc.WaitForExit(60000)) {
        try { $proc.Kill() } catch { }
        [Console]::Error.WriteLine('typecheck-on-stop: tsc exceeded 60s; skipping')
        exit 0
    }

    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $exitCode = $proc.ExitCode

    if ($exitCode -ne 0) {
        [Console]::Error.WriteLine('typecheck-on-stop: tsc reported errors:')
        if ($stdout) { [Console]::Error.WriteLine($stdout.TrimEnd()) }
        if ($stderr) { [Console]::Error.WriteLine($stderr.TrimEnd()) }
        exit 2
    }

    exit 0
}
catch {
    exit 0
}
