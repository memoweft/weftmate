param([Parameter(Mandatory)][string]$Evidence,[string]$Json,[switch]$ModelKey,[string]$Save)
$ErrorActionPreference='Stop'
$session=Get-Content (Join-Path $Evidence 'session.json') -Raw|ConvertFrom-Json
if($ModelKey){$Json=@{action='input';label='密钥';value=[Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine')}|ConvertTo-Json -Compress}
$client=[Net.Sockets.TcpClient]::new()
try {
  $client.Connect('127.0.0.1',[int]$session.forwardPort)
  $stream=$client.GetStream();$stream.ReadTimeout=45000
  $writer=[IO.StreamWriter]::new($stream,[Text.UTF8Encoding]::new($false),4096,$true)
  $writer.WriteLine($Json);$writer.Flush()
  $reader=[IO.StreamReader]::new($stream)
  $response=$reader.ReadLine()
  if(!$response){throw 'Driver closed without a response'}
  if($Save){$response|Set-Content (Join-Path $Evidence $Save)}
  $response
}finally{$client.Dispose();$Json=$null}
