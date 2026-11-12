$dll = "C:\Program Files (x86)\Steam\steamapps\common\Lossless Scaling\LosslessScaling.dll"
$fs = [System.IO.File]::OpenRead($dll)
$pe = New-Object System.Reflection.PortableExecutable.PEReader($fs)
$md = [System.Reflection.Metadata.PEReaderExtensions]::GetMetadataReader($pe)

$types = @()
foreach ($th in $md.TypeDefinitions) {
    $td = $md.GetTypeDefinition($th)
    $name = $md.GetString($td.Name)
    $ns = $md.GetString($td.Namespace)
    if ($name -match 'Settings|Profile|MainWindow') {
        $props = @()
        foreach ($ph in $td.GetProperties()) {
            $pd = $md.GetPropertyDefinition($ph)
            $props += $md.GetString($pd.Name)
        }
        $fields = @()
        foreach ($fh in $td.GetFields()) {
            $fd = $md.GetFieldDefinition($fh)
            $fields += $md.GetString($fd.Name)
        }
        $types += [pscustomobject]@{ Type = "$ns.$name"; Props = ($props -join ','); Fields = ($fields -join ',') }
    }
}
$types | Format-List

"=== enums de scaling/framegen ==="
foreach ($th in $md.TypeDefinitions) {
    $td = $md.GetTypeDefinition($th)
    $name = $md.GetString($td.Name)
    if ($name -match 'Scaling|FrameGeneration|Capture|Sync|Gsync|FlowScale|Mode') {
        $vals = @()
        foreach ($fh in $td.GetFields()) {
            $fd = $md.GetFieldDefinition($fh)
            $vals += $md.GetString($fd.Name)
        }
        if ($vals.Count -le 20) { "[$name] " + ($vals -join ',') }
    }
}
$pe.Dispose(); $fs.Dispose()
