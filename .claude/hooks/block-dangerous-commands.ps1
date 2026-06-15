try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $payload = $raw | ConvertFrom-Json

    $cmd = $null
    foreach ($field in @('command', 'script', 'commandText', 'input')) {
        $val = $payload.tool_input.$field
        if (-not [string]::IsNullOrWhiteSpace("$val")) {
            $cmd = "$val"
            break
        }
    }
    if ([string]::IsNullOrWhiteSpace($cmd)) { exit 0 }

    $rules = @(
        @{ pattern = 'taskkill\s+/f\s+/im\s+node';                  reason = 'broad node-kill is banned (Dev Centre safety rule).' },
        @{ pattern = 'Stop-Process\s+-Name\s+node';                 reason = 'broad node-kill is banned (Dev Centre safety rule).' },
        @{ pattern = 'Remove-Item.+-Recurse.+-Force';               reason = 'recursive forced delete is banned (Dev Centre safety rule).' },
        @{ pattern = 'Remove-Item.+-Force.+-Recurse';               reason = 'recursive forced delete is banned (Dev Centre safety rule).' },
        @{ pattern = 'npm\s+audit\s+fix\s+--force';                 reason = 'npm audit fix --force is banned (destructive).' },
        @{ pattern = '\bgit\s+add\s+\.(?:\s|$)';                    reason = 'git add . is banned; stage specific paths.' },
        @{ pattern = '\bgit\s+add\s+-A\b';                          reason = 'git add -A is banned; stage specific paths.' },
        @{ pattern = '\bgit\s+push\s+--force(?!-with-lease)';       reason = 'git push --force is banned without --force-with-lease.' },
        @{ pattern = '\brm\s+-rf\b';                                reason = 'rm -rf is banned (recursive forced delete).' }
    )

    foreach ($rule in $rules) {
        if ($cmd -match $rule.pattern) {
            [Console]::Error.WriteLine("Blocked by Dev Centre safety hook: $($rule.reason)")
            [Console]::Error.WriteLine("Command: $cmd")
            exit 2
        }
    }

    exit 0
}
catch {
    exit 0
}
