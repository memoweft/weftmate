# WeftMate 品牌图标生成（冷蓝体系 + 纬线纹）：
#   build/icon.png           512×512（electron-builder 应用/安装器图标，win 会自行转 ico）
#   build/tray-icon.png       32×32（托盘；main.mjs 内嵌 data URL 用，生成后手动同步或看输出）
# 用法：pwsh -File scripts/gen-icon.ps1
Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Draw-Icon([int]$size, [string]$out) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 512.0

  # 背景：冷蓝渐变圆角方（W-UI 语义：雾蓝主视觉）
  $bg = New-RoundedRectPath (6*$s) (6*$s) (500*$s) (500*$s) (110*$s)
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
    [System.Drawing.Color]::FromArgb(255, 96, 142, 232),
    [System.Drawing.Color]::FromArgb(255, 44, 72, 138), 65.0)
  $g.FillPath($brush, $bg)
  $brush.Dispose()

  # 纬线纹（Weft）：三条横向波浪线——上下细、中间粗，白色不同透明度
  function Add-Thread([float]$yBase, [float]$amp, [float]$thick, [int]$alpha) {
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb($alpha, 255, 255, 255), ($thick * $s))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $x0 = 118*$s; $x1 = 394*$s
    $path.AddBezier($x0, $yBase*$s, ($x0+60)*$s, ($yBase-$amp)*$s, ($x0+120)*$s, ($yBase+$amp)*$s, ($x0+180)*$s, $yBase*$s)
    $path.AddBezier(($x0+180)*$s, $yBase*$s, ($x0+240)*$s, ($yBase-$amp)*$s, ($x1-60)*$s, ($yBase+$amp)*$s, $x1, $yBase*$s)
    $g.DrawPath($pen, $path)
    $pen.Dispose(); $path.Dispose()
  }
  Add-Thread 186 34 26 235   # 上：细
  Add-Thread 256 40 42 255   # 中：主纬线
  Add-Thread 326 34 26 235   # 下：细

  # 织结（品牌记忆点：纬线在中央打一个结——圆环套住中间纬线）
  $knotPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 255, 255), (13*$s))
  $knotPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $knotPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawEllipse($knotPen, (227*$s), (231*$s), (58*$s), (50*$s))
  $knotPen.Dispose()

  # 星点（陪伴感）：右上四角星
  $star = New-Object System.Drawing.Drawing2D.GraphicsPath
  $cx = 372*$s; $cy = 128*$s; $r1 = 34*$s; $r2 = 11*$s
  $star.AddPolygon([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF($cx, ($cy-$r1))),
    (New-Object System.Drawing.PointF(($cx+$r2), ($cy-$r2))),
    (New-Object System.Drawing.PointF(($cx+$r1), $cy)),
    (New-Object System.Drawing.PointF(($cx+$r2), ($cy+$r2))),
    (New-Object System.Drawing.PointF($cx, ($cy+$r1))),
    (New-Object System.Drawing.PointF(($cx-$r2), ($cy+$r2))),
    (New-Object System.Drawing.PointF(($cx-$r1), $cy)),
    (New-Object System.Drawing.PointF(($cx-$r2), ($cy-$r2)))
  ))
  $starBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 226, 232, 255))
  $g.FillPath($starBrush, $star)
  $starBrush.Dispose(); $star.Dispose()

  $g.Dispose()
  New-Item -ItemType Directory -Path (Split-Path $out -Parent) -Force | Out-Null
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "生成 $out"
}

$root = Split-Path $PSScriptRoot -Parent
Draw-Icon 512 (Join-Path $root 'build\icon.png')
Draw-Icon 32 (Join-Path $root 'build\tray-icon.png')

# 托盘 data URL（复制进 main.mjs 的 TRAY_ICON）
$bytes = [System.IO.File]::ReadAllBytes((Join-Path $root 'build\tray-icon.png'))
$b64 = [Convert]::ToBase64String($bytes)
Write-Output 'TRAY_DATA_URL=data:image/png;base64,' + $b64
