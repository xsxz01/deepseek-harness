param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Add', 'Remove')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$Directory,

  [ValidateSet('User', 'Process')]
  [string]$Target = 'User',

  [string]$InitialPath
)

$ErrorActionPreference = 'Stop'
$directoryPath = [System.IO.Path]::GetFullPath($Directory).TrimEnd('\')
$current = if ($PSBoundParameters.ContainsKey('InitialPath')) {
  $InitialPath
} else {
  [Environment]::GetEnvironmentVariable('Path', $Target)
}
$entries = if ([string]::IsNullOrEmpty($current)) { @() } else { @($current -split ';') }
$remaining = @($entries | Where-Object {
  $candidate = $_.Trim().TrimEnd('\')
  -not $candidate.Equals($directoryPath, [StringComparison]::OrdinalIgnoreCase)
})

if ($Action -eq 'Add') {
  $remaining += $directoryPath
}

$result = $remaining -join ';'
[Environment]::SetEnvironmentVariable('Path', $result, $Target)
Write-Output $result
