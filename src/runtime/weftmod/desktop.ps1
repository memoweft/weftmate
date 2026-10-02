# One JSON request on stdin, one JSON result on stdout. No profile or command interpolation.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Fail([string]$code, [string]$message) {
    $exception = New-Object System.Exception($message)
    $exception.Data['desktop_code'] = $code
    throw $exception
}

try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($null -eq $request -or $request.action -notin @('windows','inspect','screenshot','click','invoke','type','keys','scroll','open')) {
        Fail 'DESKTOP_INVALID_ACTION' 'Unsupported desktop action.'
    }
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, UIAutomationClientsideProviders, WindowsBase, System.Windows.Forms, System.Drawing
    # PowerShell does not initialize WPF's default client-side proxy table.
    # Register the shipped framework providers for Win32/WinForms controls.
    $null = [System.Windows.Automation.AutomationElement]::RootElement
    [System.Windows.Automation.ClientSettings]::RegisterClientSideProviders([UIAutomationClientsideProviders.UIAutomationClientSideProviders]::ClientSideProviderDescriptionTable)
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class WeftDesktop {
    public delegate bool EnumCallback(IntPtr h, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk,wScan; public uint dwFlags,time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT key; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback cb, IntPtr data);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder title, int length);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
    public static long[] Windows() {
        var found = new List<long>();
        EnumWindows((h,p) => { if (IsWindowVisible(h)) found.Add(h.ToInt64()); return true; }, IntPtr.Zero);
        return found.ToArray();
    }
    public static string Title(IntPtr h) { var s=new StringBuilder(32768); GetWindowText(h,s,s.Capacity); return s.ToString(); }
    public static uint ProcessId(IntPtr h) { uint p; GetWindowThreadProcessId(h,out p); return p; }
    public static RECT Bounds(IntPtr h) { RECT r; if(!GetWindowRect(h,out r)) throw new Exception("Window bounds unavailable."); return r; }
    public static bool Foreground(IntPtr h) {
        if(GetForegroundWindow()==h) return true;
        if(IsIconic(h)) ShowWindow(h,9);
        uint p; uint ours=GetCurrentThreadId(); uint other=GetWindowThreadProcessId(GetForegroundWindow(),out p);
        bool attached = other!=0 && other!=ours && AttachThreadInput(ours,other,true);
        try { BringWindowToTop(h); SetForegroundWindow(h); } finally { if(attached) AttachThreadInput(ours,other,false); }
        return GetForegroundWindow()==h;
    }
    static void Send(INPUT[] inputs) {
        if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT))) != inputs.Length) throw new Exception("Windows rejected input; the target may run at a higher integrity level.");
    }
    public static void Text(string text) {
        var inputs=new List<INPUT>();
        foreach(char c in text) { var a=new INPUT(); a.type=1; a.data.key.wScan=c; a.data.key.dwFlags=4; inputs.Add(a); a.data.key.dwFlags=6; inputs.Add(a); }
        // Chunk at a bounded size without changing the user's clipboard.
        for(int offset=0;offset<inputs.Count;offset+=256) Send(inputs.GetRange(offset,Math.Min(256,inputs.Count-offset)).ToArray());
    }
    public static void Key(ushort key, ushort[] modifiers) {
        var inputs=new List<INPUT>();
        foreach(ushort modifier in modifiers) { var m=new INPUT(); m.type=1; m.data.key.wVk=modifier; inputs.Add(m); }
        var a=new INPUT(); a.type=1; a.data.key.wVk=key;
        if((key>=33 && key<=46) || key==91) a.data.key.dwFlags=1;
        inputs.Add(a); a.data.key.dwFlags|=2; inputs.Add(a);
        for(int i=modifiers.Length-1;i>=0;i--) { var m=new INPUT(); m.type=1; m.data.key.wVk=modifiers[i]; m.data.key.dwFlags=2; inputs.Add(m); }
        Send(inputs.ToArray());
    }
    public static void Click(int x,int y,string button,int count) {
        if(!SetCursorPos(x,y)) throw new Exception("Cannot position pointer.");
        for(int i=0;i<count;i++) { var a=new INPUT(); a.data.mouse.dwFlags=button=="right" ? 8u : button=="middle" ? 32u : 2u; var b=a; b.data.mouse.dwFlags*=2; Send(new[]{a,b}); }
    }
    public static void Wheel(int delta,bool horizontal) { var a=new INPUT(); a.data.mouse.dwFlags=horizontal?4096u:2048u; a.data.mouse.mouseData=unchecked((uint)delta); Send(new[]{a}); }
    public static string QuoteArgument(string value) {
        if(value.Length>0 && value.IndexOfAny(new[]{' ','\t','\n','\v','"'})<0) return value;
        var s=new StringBuilder("\""); int slashes=0;
        foreach(char c in value) { if(c=='\\') { slashes++; continue; } if(c=='"') { s.Append('\\',slashes*2+1); s.Append(c); } else { s.Append('\\',slashes); s.Append(c); } slashes=0; }
        s.Append('\\',slashes*2); s.Append('"'); return s.ToString();
    }
}
'@
    [void][WeftDesktop]::SetProcessDPIAware()

    function WindowHandle {
        $id = [string]$request.window_id
        if ($id -notmatch '^\d{1,19}$') { Fail 'DESKTOP_WINDOW_REQUIRED' 'window_id must be a decimal handle returned by windows.' }
        $handle = [IntPtr]::new([long]$id)
        if (-not [WeftDesktop]::IsWindow($handle)) { Fail 'DESKTOP_WINDOW_GONE' 'The selected window no longer exists; enumerate windows again.' }
        return $handle
    }
    function Bounds($rect) { return @{ x=[int][Math]::Round($rect.X); y=[int][Math]::Round($rect.Y); width=[int][Math]::Round($rect.Width); height=[int][Math]::Round($rect.Height) } }
    function ElementInfo($element, [int]$depth) {
        $current = $element.Current
        $result = [ordered]@{
            element_id=($element.GetRuntimeId() -join '.'); automation_id=$current.AutomationId; name=$current.Name
            control_type=($current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
            depth=$depth; bounds=(Bounds $current.BoundingRectangle); enabled=$current.IsEnabled; offscreen=$current.IsOffscreen
        }
        $pattern = $null
        if (-not $current.IsPassword -and $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { $result.value=$pattern.Current.Value; $result.read_only=$pattern.Current.IsReadOnly }
        $result.patterns = @($element.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'PatternIdentifiers.Pattern$','' -replace 'Pattern$','' })
        return $result
    }
    function FindElement($handle) {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
        $selector = $request.selector
        if ($null -eq $selector) { return $root }
        $fields = @('element_id','automation_id','name','control_type')
        $used = @($fields | Where-Object { $null -ne $selector.$_ })
        if ($used.Count -eq 0) { Fail 'DESKTOP_SELECTOR_INVALID' 'selector needs element_id, automation_id, name or control_type.' }
        $matches = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
        $queue = New-Object 'System.Collections.Generic.Queue[System.Windows.Automation.AutomationElement]'
        $queue.Enqueue($root)
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $visited = 0
        while ($queue.Count -gt 0) {
            if (++$visited -gt 10000) { Fail 'DESKTOP_TREE_TOO_LARGE' 'Window control tree exceeds 10000 elements; select a more specific window.' }
            $element = $queue.Dequeue()
            $c = $element.Current
            $matched = $true
            foreach ($field in $used) {
                $actual = switch ($field) { 'element_id' { $element.GetRuntimeId() -join '.' } 'automation_id' { $c.AutomationId } 'name' { $c.Name } 'control_type' { $c.ControlType.ProgrammaticName -replace '^ControlType\.', '' } }
                if ([string]$actual -cne [string]$selector.$field) { $matched=$false; break }
            }
            if ($matched) { $matches.Add($element); if ($matches.Count -gt 1) { Fail 'DESKTOP_SELECTOR_AMBIGUOUS' 'Several controls match; combine selector fields or use element_id.' } }
            $child = $walker.GetFirstChild($element)
            while ($null -ne $child) { $queue.Enqueue($child); $child=$walker.GetNextSibling($child) }
        }
        if ($matches.Count -eq 0) { Fail 'DESKTOP_CONTROL_NOT_FOUND' 'Control was not found; inspect the window again.' }
        return $matches[0]
    }
    function FocusWindow($handle) {
        if (-not [WeftDesktop]::Foreground($handle)) { Fail 'DESKTOP_FOCUS_FAILED' 'Windows did not activate the requested window; no keyboard or pointer input was sent.' }
    }
    function FocusElement($element) {
        $focused=[System.Windows.Automation.AutomationElement]::FocusedElement
        if ($null -eq $focused -or -not [System.Windows.Automation.Automation]::Compare($element,$focused)) { $element.SetFocus() }
    }
    function InvokeElement($element) {
        if (-not $element.Current.IsEnabled) { Fail 'DESKTOP_CONTROL_DISABLED' 'The selected control is disabled.' }
        $pattern=$null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { $pattern.Invoke(); return 'invoke' }
        if ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)) { $pattern.Toggle(); return 'toggle' }
        if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)) { $pattern.Select(); return 'select' }
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)) {
            if ($pattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) { $pattern.Collapse(); return 'collapse' }
            $pattern.Expand(); return 'expand'
        }
        Fail 'DESKTOP_INVOKE_UNSUPPORTED' 'This control exposes no supported invoke, toggle, select or expand pattern; use click with its current bounds.'
    }
    function KeyCommand([string]$key) {
        $parts = $key.ToUpperInvariant().Split('+')
        $modifiers=New-Object 'System.Collections.Generic.List[System.UInt16]'
        for ($index=0;$index -lt $parts.Length-1;$index++) {
            switch ($parts[$index]) { {$_ -in @('CTRL','CONTROL')} { $modifiers.Add(17) } 'ALT' { $modifiers.Add(18) } 'SHIFT' { $modifiers.Add(16) } {$_ -in @('WIN','WINDOWS','META')} { $modifiers.Add(91) } default { Fail 'DESKTOP_KEYS_INVALID' 'Supported modifiers are CTRL, ALT, SHIFT and WIN.' } }
        }
        $last=$parts[-1]
        $aliases=@{ ESC=27; ESCAPE=27; ENTER=13; RETURN=13; TAB=9; BACKSPACE=8; DELETE=46; DEL=46; UP=38; DOWN=40; LEFT=37; RIGHT=39; HOME=36; END=35; PAGEUP=33; PAGEDOWN=34; SPACE=32; INSERT=45; WIN=91 }
        $virtualKey=0
        if ($aliases.ContainsKey($last)) { $virtualKey=$aliases[$last] }
        elseif ($last -match '^F([1-9]|1[0-9]|2[0-4])$') { $virtualKey=111+[int]$Matches[1] }
        elseif ($last -match '^[A-Z0-9]$') { $virtualKey=[int][char]$last }
        else { Fail 'DESKTOP_KEYS_INVALID' 'Use key names such as CTRL+A, ENTER, TAB or ESC; type literal text with the type action.' }
        return @{key=[System.UInt16]$virtualKey;modifiers=$modifiers.ToArray()}
    }

    $result = switch ($request.action) {
        'windows' {
            $items = @()
            foreach ($id in [WeftDesktop]::Windows()) {
                $handle=[IntPtr]::new($id); $title=[WeftDesktop]::Title($handle)
                if (-not $title) { continue }
                $processId=[WeftDesktop]::ProcessId($handle)
                if ($null -ne $request.process_id -and $processId -ne [uint32]$request.process_id) { continue }
                if ($null -ne $request.title -and $title.IndexOf([string]$request.title, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
                $r=[WeftDesktop]::Bounds($handle)
                $items += @{ window_id=[string]$id; title=$title; process_id=$processId; bounds=@{x=$r.Left;y=$r.Top;width=$r.Right-$r.Left;height=$r.Bottom-$r.Top}; minimized=[WeftDesktop]::IsIconic($handle); foreground=([WeftDesktop]::GetForegroundWindow() -eq $handle) }
            }
            @{ ok=$true; windows=$items; coordinate_space='physical_screen_pixels' }
        }
        'inspect' {
            $handle=WindowHandle; $root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
            $maxDepth=if ($null -eq $request.max_depth) { 6 } else { [int]$request.max_depth }
            $maxNodes=if ($null -eq $request.max_nodes) { 300 } else { [int]$request.max_nodes }
            if ($maxDepth -lt 0 -or $maxDepth -gt 30 -or $maxNodes -lt 1 -or $maxNodes -gt 10000) { Fail 'DESKTOP_INSPECT_LIMIT_INVALID' 'max_depth must be 0..30 and max_nodes 1..10000.' }
            $queue=New-Object System.Collections.Queue; $queue.Enqueue(@{element=$root;depth=0})
            $controls=New-Object System.Collections.ArrayList; $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
            $truncated=$false
            while ($queue.Count -gt 0 -and $controls.Count -lt $maxNodes) {
                $entry=$queue.Dequeue(); [void]$controls.Add((ElementInfo $entry.element $entry.depth))
                $child=$walker.GetFirstChild($entry.element)
                if ($entry.depth -ge $maxDepth) { if ($null -ne $child) { $truncated=$true }; continue }
                while ($null -ne $child) { $queue.Enqueue(@{element=$child;depth=$entry.depth+1}); $child=$walker.GetNextSibling($child) }
            }
            @{ ok=$true; window_id=[string]$request.window_id; controls=@($controls.ToArray()); truncated=($truncated -or $queue.Count -gt 0); coordinate_space='physical_screen_pixels' }
        }
        'screenshot' {
            $bitmap=$null; $graphics=$null; $stream=$null
            try {
                if ($null -ne $request.window_id) {
                    $handle=WindowHandle
                    if ([WeftDesktop]::IsIconic($handle)) { Fail 'DESKTOP_WINDOW_MINIMIZED' 'The window is minimized; activate it before capturing.' }
                    $r=[WeftDesktop]::Bounds($handle); $width=$r.Right-$r.Left; $height=$r.Bottom-$r.Top; $x=$r.Left; $y=$r.Top
                } else { $r=[System.Windows.Forms.SystemInformation]::VirtualScreen; $width=$r.Width; $height=$r.Height; $x=$r.X; $y=$r.Y }
                if ($width -lt 1 -or $height -lt 1 -or [long]$width*$height -gt 64000000) { Fail 'DESKTOP_CAPTURE_SIZE_INVALID' 'Capture bounds are empty or exceed 64 million pixels.' }
                $bitmap=New-Object System.Drawing.Bitmap($width,$height); $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
                if ($null -ne $request.window_id) {
                    $dc=$graphics.GetHdc()
                    try { $captured=[WeftDesktop]::PrintWindow($handle,$dc,2) } finally { $graphics.ReleaseHdc($dc) }
                    if (-not $captured) { Fail 'DESKTOP_CAPTURE_UNSUPPORTED' 'This window did not support PrintWindow capture; use a full-screen screenshot after activating it.' }
                    $method='print_window'
                } else { $graphics.CopyFromScreen($x,$y,0,0,$bitmap.Size); $method='screen' }
                $stream=New-Object System.IO.MemoryStream; $bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
                @{ ok=$true; mime_type='image/png'; base64=[Convert]::ToBase64String($stream.ToArray()); width=$width; height=$height; x=$x; y=$y; capture_method=$method }
            } finally { if ($null -ne $graphics) {$graphics.Dispose()}; if ($null -ne $bitmap) {$bitmap.Dispose()}; if ($null -ne $stream) {$stream.Dispose()} }
        }
        { $_ -in @('click','invoke') } {
            $handle=WindowHandle
            if ($request.action -eq 'invoke') {
                if ($null -eq $request.selector) { Fail 'DESKTOP_SELECTOR_REQUIRED' 'invoke requires a control selector.' }
                $method=InvokeElement (FindElement $handle)
            } else {
                $button=if ($null -eq $request.button) {'left'} else {[string]$request.button}
                if ($button -notin @('left','right','middle')) { Fail 'DESKTOP_BUTTON_INVALID' 'button must be left, right or middle.' }
                $count=if ($request.double_click -eq $true) {2} else {1}
                if ($null -ne $request.selector) {
                    $element=FindElement $handle; $c=$element.Current
                    if ($c.IsOffscreen -or -not $c.IsEnabled) { Fail 'DESKTOP_CONTROL_UNAVAILABLE' 'Control must be visible and enabled for pointer input.' }
                    $r=$c.BoundingRectangle; $x=[int]($r.X+$r.Width/2); $y=[int]($r.Y+$r.Height/2)
                } elseif ($null -ne $request.x -and $null -ne $request.y) { $x=[int]$request.x; $y=[int]$request.y }
                else { Fail 'DESKTOP_COORDINATES_REQUIRED' 'click requires selector or x and y in physical screen pixels.' }
                $r=[WeftDesktop]::Bounds($handle)
                if ($x -lt $r.Left -or $x -ge $r.Right -or $y -lt $r.Top -or $y -ge $r.Bottom) { Fail 'DESKTOP_COORDINATES_OUTSIDE_WINDOW' 'Click coordinates are outside the selected window.' }
                FocusWindow $handle; [WeftDesktop]::Click($x,$y,$button,$count); $method='pointer'
            }
            @{ ok=$true; action=$request.action; window_id=[string]$request.window_id; method=$method }
        }
        'type' {
            if ($null -eq $request.text) { Fail 'DESKTOP_TEXT_REQUIRED' 'type requires text.' }
            $handle=WindowHandle; $text=[string]$request.text; $method='unicode_input'
            if ($null -ne $request.selector) {
                $element=FindElement $handle; $pattern=$null
                if (-not $element.Current.IsEnabled) { Fail 'DESKTOP_CONTROL_DISABLED' 'Control is disabled.' }
                if ($request.append -ne $true -and $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) {
                    if ($pattern.Current.IsReadOnly) { Fail 'DESKTOP_CONTROL_READ_ONLY' 'Control value is read-only.' }
                    $pattern.SetValue($text); $method='value_pattern'
                } else { FocusWindow $handle; FocusElement $element; [WeftDesktop]::Text($text) }
            } else { FocusWindow $handle; [WeftDesktop]::Text($text) }
            @{ ok=$true; action='type'; window_id=[string]$request.window_id; method=$method; characters=$text.Length }
        }
        'keys' {
            $handle=WindowHandle
            if ($null -eq $request.keys) { Fail 'DESKTOP_KEYS_REQUIRED' 'keys requires a key name or an array of key names.' }
            $commands=@(@($request.keys) | ForEach-Object { KeyCommand ([string]$_) })
            FocusWindow $handle
            if ($null -ne $request.selector) { FocusElement (FindElement $handle) }
            foreach ($command in $commands) { [WeftDesktop]::Key($command.key,$command.modifiers) }
            @{ ok=$true; action='keys'; window_id=[string]$request.window_id; sent=$commands.Count }
        }
        'scroll' {
            $handle=WindowHandle; $direction=if ($null -eq $request.direction) {'down'} else {[string]$request.direction}
            if ($direction -notin @('up','down','left','right')) { Fail 'DESKTOP_SCROLL_DIRECTION_INVALID' 'direction must be up, down, left or right.' }
            $amount=if ($null -eq $request.amount) {3} else {[int]$request.amount}
            if ($amount -lt 1 -or $amount -gt 100) { Fail 'DESKTOP_SCROLL_AMOUNT_INVALID' 'amount must be 1..100 wheel notches.' }
            $element=FindElement $handle; $pattern=$null; $horizontal=$direction -in @('left','right')
            if ($element.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern,[ref]$pattern)) {
                $increase=$direction -in @('down','right'); $scrollAmount=if ($increase) {[System.Windows.Automation.ScrollAmount]::SmallIncrement} else {[System.Windows.Automation.ScrollAmount]::SmallDecrement}
                for ($index=0;$index -lt $amount;$index++) { if ($horizontal) {$pattern.Scroll($scrollAmount,[System.Windows.Automation.ScrollAmount]::NoAmount)} else {$pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount,$scrollAmount)} }
                $method='scroll_pattern'
            } else {
                FocusWindow $handle; $r=$element.Current.BoundingRectangle
                if ($element.Current.IsOffscreen -or $r.IsEmpty) { Fail 'DESKTOP_CONTROL_UNAVAILABLE' 'Scroll target is not visible.' }
                [void][WeftDesktop]::SetCursorPos([int]($r.X+$r.Width/2),[int]($r.Y+$r.Height/2))
                $delta=120*$amount; if ($direction -in @('down','left')) { $delta=-$delta }
                [WeftDesktop]::Wheel($delta,$horizontal); $method='wheel'
            }
            @{ ok=$true; action='scroll'; window_id=[string]$request.window_id; method=$method }
        }
        'open' {
            if ([string]::IsNullOrWhiteSpace([string]$request.path)) { Fail 'DESKTOP_PATH_REQUIRED' 'open requires a file, application path or URI.' }
            $startInfo=New-Object System.Diagnostics.ProcessStartInfo
            $startInfo.FileName=[string]$request.path; $startInfo.UseShellExecute=$true
            if ($null -ne $request.arguments) {
                if ($request.arguments -isnot [System.Array]) { Fail 'DESKTOP_ARGUMENTS_INVALID' 'arguments must be an array of strings.' }
                $quoted=@($request.arguments | ForEach-Object { if ($_ -isnot [string]) { Fail 'DESKTOP_ARGUMENTS_INVALID' 'Every application argument must be a string.' }; [WeftDesktop]::QuoteArgument($_) })
                $startInfo.Arguments=$quoted -join ' '
            }
            if ($null -ne $request.working_directory) { $startInfo.WorkingDirectory=[string]$request.working_directory }
            $process=[System.Diagnostics.Process]::Start($startInfo)
            @{ ok=$true; action='open'; process_id=if ($null -ne $process) {$process.Id} else {$null}; path=[string]$request.path; verification='Launch accepted. The application may reuse another process. Find the resulting window by title/content; the returned process_id may only be a launcher.' }
        }
    }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 12 -Compress))
} catch {
    $code='DESKTOP_OPERATION_FAILED'
    $cursor=$_.Exception
    while ($null -ne $cursor) { if ($cursor.Data.Contains('desktop_code')) { $code=$cursor.Data['desktop_code']; break }; $cursor=$cursor.InnerException }
    [Console]::Out.WriteLine((@{ok=$false;error=@{code=$code;message=$_.Exception.Message}} | ConvertTo-Json -Depth 5 -Compress))
    exit 1
}
