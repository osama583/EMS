# Report what the already-running Word has open, without opening or closing
# anything. Windows PowerShell 5.1 only: GetActiveObject is absent from pwsh 7.
try {
    $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
} catch {
    Write-Output "NO_WORD"
    exit 0
}
foreach ($doc in $word.Documents) {
    Write-Output ("DOC|{0}|saved={1}" -f $doc.FullName, $doc.Saved)
}
