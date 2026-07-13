# Servidor HTTP Local para GeoMet V1
# Ejecutar en PowerShell para servir los archivos de la aplicación en http://localhost:8000
# Presione Ctrl+C en la consola para detener el servidor.

$port = 8000
$localPath = $PSScriptRoot
if (-not $localPath) { $localPath = Get-Location }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

Write-Host "==================================================" -ForegroundColor Green
Write-Host "Iniciando servidor local GeoMet V1..." -ForegroundColor Green
Write-Host "Dirección: http://localhost:$port/" -ForegroundColor Cyan
Write-Host "Directorio: $localPath" -ForegroundColor DarkGray
Write-Host "Presione Ctrl+C en esta consola para apagar." -ForegroundColor Yellow
Write-Host "==================================================" -ForegroundColor Green

try {
    $listener.Start()
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $urlPath = $request.Url.LocalPath
        if ($urlPath -eq "/" -or $urlPath -eq "") { $urlPath = "/index.html" }
        
        # Sanitizar ruta para Windows
        $relPath = $urlPath.Replace("/", "\").TrimStart("\")
        $filePath = Join-Path $localPath $relPath
        
        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mimeType = switch ($ext) {
                ".html" { "text/html; charset=utf-8" }
                ".css"  { "text/css; charset=utf-8" }
                ".js"   { "application/javascript; charset=utf-8" }
                ".json" { "application/json; charset=utf-8" }
                ".csv"  { "text/csv; charset=utf-8" }
                ".dxf"  { "text/plain; charset=utf-8" }
                default { "application/octet-stream" }
            }
            
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.Headers.Add("Access-Control-Allow-Origin", "*")
            # Sin esto, el navegador puede seguir sirviendo versiones viejas de
            # .js/.css desde caché incluso después de recargar la página (F5),
            # ocultando cambios reales hechos en disco durante el desarrollo.
            $response.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate")
            $response.Headers.Add("Pragma", "no-cache")
            $response.ContentType = $mimeType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("Error 404: Archivo no encontrado ($urlPath)")
            $response.ContentType = "text/plain; charset=utf-8"
            $response.ContentLength64 = $errBytes.Length
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }
        $response.Close()
    }
} catch {
    Write-Host "Servidor detenido o error: $_" -ForegroundColor Red
} finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
}
