# Rebuild every field in the report: SEQ numbering, REF cross-references, the
# table of contents, the List of Figures and the List of Tables.
#
# Only Word can do this properly, because the lists carry page numbers and a
# page number cannot be known without laying the document out.
param(
    [Parameter(Mandatory = $true)][string]$Path
)

$full = (Resolve-Path $Path).Path
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    $doc = $word.Documents.Open($full, [ref]$false, [ref]$false)

    # Two passes. The first settles the SEQ numbers and cross-references; the
    # second rebuilds the lists against numbers that are now correct, and picks
    # up the page numbers the repagination produced.
    for ($pass = 1; $pass -le 2; $pass++) {
        foreach ($story in $doc.StoryRanges) {
            $s = $story
            while ($null -ne $s) {
                $s.Fields.Update() | Out-Null
                $s = $s.NextStoryRange
            }
        }
        foreach ($toc in $doc.TablesOfContents)  { $toc.Update() }
        foreach ($tof in $doc.TablesOfFigures)   { $tof.Update() }
        $doc.Repaginate()
    }

    $counts = [pscustomobject]@{
        Fields          = $doc.Fields.Count
        TablesOfContents = $doc.TablesOfContents.Count
        TablesOfFigures  = $doc.TablesOfFigures.Count
        Pages            = $doc.ComputeStatistics(2)   # wdStatisticPages
        Words            = $doc.ComputeStatistics(0)
    }
    $counts | Format-List

    $doc.Save()
    $doc.Close(0)
    Write-Output "UPDATED OK"
}
finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
