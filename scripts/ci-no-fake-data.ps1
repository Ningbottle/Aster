# CI No-Fake-Data Gate (Delegates to Node.js scanner)
param()
$scriptPath = Join-Path $PSScriptRoot "ci-no-fake-data.mjs"
node $scriptPath
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
