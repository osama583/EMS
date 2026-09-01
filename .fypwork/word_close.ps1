# Close one document in the already-running Word, leaving Word itself and every
# other open document alone. Refuses if that document has unsaved changes.
param([Parameter(Mandatory = $true)][string]$Name)

try {
    $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
} catch {
    Write-Output "NO_WORD"
    exit 0
}
foreach ($doc in @($word.Documents)) {
    if ([IO.Path]::GetFileName($doc.FullName) -ne $Name) { continue }
    if (-not $doc.Saved) {
        Write-Output "REFUSED unsaved changes in $($doc.FullName)"
        exit 2
    }
    $doc.Close(0)          # wdDoNotSaveChanges
    Write-Output "CLOSED $Name"
    exit 0
}
Write-Output "NOT_OPEN $Name"
