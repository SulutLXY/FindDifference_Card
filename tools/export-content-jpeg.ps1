param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path -LiteralPath $Manifest).Path
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $manifestPath.StartsWith($workspacePath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The export manifest must be inside this project.'
}
$manifestText = [IO.File]::ReadAllText($manifestPath)
$exportSpec = $manifestText | ConvertFrom-Json
foreach ($job in $exportSpec.jobs) {
    $target = [IO.Path]::GetFullPath($job.target)
    if (-not $target.StartsWith($workspacePath + '\temp\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Photoshop exports must be staged in this project temp directory.'
    }
}
$script = @'
(function () {
    var spec = __SPEC__;
    var previousDialogs = app.displayDialogs;
    var previousUnits = app.preferences.rulerUnits;
    var completed = [];
    function write(path, value) {
        var file = new File(path);
        file.encoding = 'UTF8';
        if (!file.open('w')) throw new Error('Cannot write export status: ' + path);
        file.write(value); file.close();
    }
    try {
        app.displayDialogs = DialogModes.NO;
        app.preferences.rulerUnits = Units.PIXELS;
        for (var i = 0; i < spec.jobs.length; i++) {
            var job = spec.jobs[i];
            var doc = null;
            try {
                doc = app.open(new File(job.source));
                if (doc.mode !== DocumentMode.RGB) doc.changeMode(ChangeMode.RGB);
                doc.bitsPerChannel = BitsPerChannelType.EIGHT;
                doc.resizeImage(UnitValue(1024, 'px'), UnitValue(672, 'px'), null, ResampleMethod.BICUBIC);
                doc.flatten();
                var options = new JPEGSaveOptions();
                options.quality = 8;
                options.embedColorProfile = true;
                options.formatOptions = FormatOptions.STANDARDBASELINE;
                options.matte = MatteType.WHITE;
                doc.saveAs(new File(job.target), options, true, Extension.LOWERCASE);
                completed.push(job.target);
            } finally {
                if (doc) doc.close(SaveOptions.DONOTSAVECHANGES);
            }
            write(spec.progress, String(i + 1) + '/' + String(spec.jobs.length));
        }
        write(spec.done, 'Photoshop ' + app.version + '\nJPEGSaveOptions.quality=8\n1024x672\n' + String(completed.length));
    } finally {
        app.preferences.rulerUnits = previousUnits;
        app.displayDialogs = previousDialogs;
    }
    return String(completed.length);
})();
'@
$script = $script.Replace('__SPEC__', $manifestText)
$photoshop = New-Object -ComObject Photoshop.Application
try { $photoshop.DoJavaScript($script) }
finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($photoshop) }
