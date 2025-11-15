param(
    [string]$BucketName = $env:PDF_STORAGE_BUCKET,
    [string]$ConfigPath = "../docs/storage-cors.json"
)

if (-not $BucketName) {
    Write-Error "Bucket name is required. Pass -BucketName or set the PDF_STORAGE_BUCKET environment variable."
    exit 1
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultConfigPath = Join-Path -Path $scriptRoot -ChildPath $ConfigPath

$resolvedConfig = Resolve-Path -Path $defaultConfigPath -ErrorAction SilentlyContinue
if (-not $resolvedConfig) {
    Write-Error "Cannot find storage CORS config at $defaultConfigPath"
    exit 1
}

Write-Host "Applying CORS policy from $resolvedConfig to bucket gs://$BucketName" -ForegroundColor Cyan

$gsutil = Get-Command gsutil -ErrorAction SilentlyContinue
if (-not $gsutil) {
    Write-Error "gsutil was not found. Install the Google Cloud SDK from https://cloud.google.com/sdk/docs/install and retry."
    exit 1
}

& $gsutil.Path cors set $resolvedConfig "gs://$BucketName"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to apply CORS policy. See gsutil output above."
    exit $LASTEXITCODE
}

Write-Host "CORS policy applied successfully." -ForegroundColor Green
