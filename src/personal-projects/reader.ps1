param([string]$RequestJson)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class SafeProjectReader {
  const uint ReadAttributes = 0x80, GenericRead = 0x80000000;
  const uint ShareRead = 1, ShareWrite = 2, OpenExisting = 3;
  const uint ReparsePoint = 0x400, Directory = 0x10;
  const uint BackupSemantics = 0x02000000, OpenReparsePoint = 0x00200000;
  [StructLayout(LayoutKind.Sequential)]
  public struct Info {
    public uint Attributes;
    public uint CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    public long LastWriteTime { get { return ((long)WriteHigh << 32) | WriteLow; } }
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security,
    uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder buffer, uint capacity, uint flags);

  public sealed class RootInfo {
    public string FinalPath { get; set; }
    public string Identity { get; set; }
  }
  public sealed class FileRow {
    public string RelativePath { get; set; }
    public long Size { get; set; }
    public string Identity { get; set; }
    public string LastWriteTime { get; set; }
  }
  public sealed class ListResult {
    public List<FileRow> Files { get; set; }
    public int ScannedCount { get; set; }
    public bool Truncated { get; set; }
    public int SkippedCount { get; set; }
    public ListResult() { Files = new List<FileRow>(); }
  }
  public sealed class ReadResult {
    public string RelativePath { get; set; }
    public int LineStart { get; set; }
    public int LineEnd { get; set; }
    public int TotalLines { get; set; }
    public string FileSha256 { get; set; }
    public string Text { get; set; }
    public bool HasMore { get; set; }
    public long Size { get; set; }
    public string Identity { get; set; }
    public string LastWriteTime { get; set; }
  }
  sealed class CheckedHandle : IDisposable {
    public SafeFileHandle Handle;
    public Info Info;
    public string Final;
    public void Dispose() { Handle.Dispose(); }
  }
  static Exception Fail(string code) { return new InvalidOperationException(code); }
  static string Identity(Info info) {
    return info.Volume.ToString("X8") + ":" + info.IndexHigh.ToString("X8") + info.IndexLow.ToString("X8");
  }
  static long Size(Info info) { return ((long)info.SizeHigh << 32) | info.SizeLow; }
  static bool Inside(string final, string root) {
    return final.Equals(root, StringComparison.OrdinalIgnoreCase) ||
      final.StartsWith(root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);
  }
  static CheckedHandle OpenChecked(string name, bool directory) {
    var handle = CreateFileW(name, directory ? ReadAttributes : GenericRead,
      directory ? ShareRead | ShareWrite : ShareRead, IntPtr.Zero, OpenExisting,
      OpenReparsePoint | (directory ? BackupSemantics : 0), IntPtr.Zero);
    if (handle.IsInvalid) { handle.Dispose(); throw Fail("PROJECT_FILE_UNAVAILABLE"); }
    try {
      Info info;
      if (!GetFileInformationByHandle(handle, out info)) throw Fail("PROJECT_FILE_UNAVAILABLE");
      if (info.Volume == 0 || (info.IndexHigh == 0 && info.IndexLow == 0)) throw Fail("PROJECT_UNSAFE_PATH");
      if ((info.Attributes & ReparsePoint) != 0) throw Fail("PROJECT_UNSAFE_PATH");
      if (((info.Attributes & Directory) != 0) != directory) throw Fail("PROJECT_UNSAFE_PATH");
      if (!directory && info.Links != 1) throw Fail("PROJECT_UNSAFE_PATH");
      var buffer = new StringBuilder(4096);
      uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
      if (length == 0 || length >= buffer.Capacity) throw Fail("PROJECT_UNSAFE_PATH");
      return new CheckedHandle { Handle = handle, Info = info, Final = buffer.ToString() };
    } catch { handle.Dispose(); throw; }
  }
  static bool SafePart(string part) {
    if (String.IsNullOrWhiteSpace(part) || part == "." || part == ".." || part.EndsWith(" ") || part.EndsWith(".") ||
      part.IndexOfAny(new char[] {'/', '\\', ':', '\0'}) >= 0 || part.Any(c => Char.IsControl(c))) return false;
    string stem = part.Split('.')[0].ToUpperInvariant();
    return stem != "CON" && stem != "PRN" && stem != "AUX" && stem != "NUL" &&
      !System.Text.RegularExpressions.Regex.IsMatch(stem, "^(COM|LPT)[1-9]$");
  }
  static string[] RelativeParts(string relative) {
    if (relative == null || relative.Length > 1024 || relative.StartsWith("\\") || relative.StartsWith("/") ||
      relative.Contains("/")) throw Fail("PROJECT_UNSAFE_PATH");
    var parts = relative.Split('\\');
    if (parts.Length < 1 || parts.Length > 9 || parts.Any(p => !SafePart(p))) throw Fail("PROJECT_UNSAFE_PATH");
    return parts;
  }
  static List<CheckedHandle> OpenRootChain(string input) {
    if (input == null || input.Length > 240 || !System.Text.RegularExpressions.Regex.IsMatch(input, @"^[A-Za-z]:\\"))
      throw Fail("PROJECT_UNSAFE_PATH");
    string rawDrive = Path.GetPathRoot(input);
    if (String.IsNullOrEmpty(rawDrive) || input.Substring(rawDrive.Length).Split('\\').Any(p => p == "." || p == ".."))
      throw Fail("PROJECT_UNSAFE_PATH");
    string full = Path.GetFullPath(input).TrimEnd('\\');
    string drive = Path.GetPathRoot(full);
    if (String.IsNullOrEmpty(drive)) throw Fail("PROJECT_UNSAFE_PATH");
    var parts = full.Substring(drive.Length).Split(new char[] {'\\'}, StringSplitOptions.RemoveEmptyEntries);
    if (parts.Length > 24 || parts.Any(p => !SafePart(p))) throw Fail("PROJECT_UNSAFE_PATH");
    var handles = new List<CheckedHandle>();
    try {
      string current = drive;
      handles.Add(OpenChecked(current, true));
      foreach (var part in parts) {
        current = Path.Combine(current, part);
        var child = OpenChecked(current, true);
        if (!Inside(child.Final, handles[handles.Count - 1].Final)) {
          child.Dispose(); throw Fail("PROJECT_UNSAFE_PATH");
        }
        handles.Add(child);
      }
      return handles;
    } catch { foreach (var item in handles) item.Dispose(); throw; }
  }
  static void CheckRoot(CheckedHandle root, string expectedFinal, string expectedIdentity) {
    if (expectedFinal != null && (!root.Final.Equals(expectedFinal, StringComparison.OrdinalIgnoreCase) ||
        Identity(root.Info) != expectedIdentity)) throw Fail("PROJECT_ROOT_CHANGED");
  }
  public static RootInfo InspectRoot(string path) {
    var chain = OpenRootChain(path);
    try { var root = chain[chain.Count - 1]; return new RootInfo { FinalPath = root.Final, Identity = Identity(root.Info) }; }
    finally { foreach (var item in chain) item.Dispose(); }
  }
  public static ListResult List(string path, string expectedFinal, string expectedIdentity, string query) {
    var chain = OpenRootChain(path);
    try {
      var root = chain[chain.Count - 1]; CheckRoot(root, expectedFinal, expectedIdentity);
      var result = new ListResult(); var clock = Stopwatch.StartNew();
      Action<string,string,int,CheckedHandle> walk = null;
      walk = (directoryPath, relative, depth, parent) => {
        if (result.Truncated) return;
        IEnumerable<string> names;
        try { names = System.IO.Directory.EnumerateFileSystemEntries(directoryPath); }
        catch { result.SkippedCount++; return; }
        foreach (var childPath in names) {
          if (result.ScannedCount >= 2000 || result.Files.Count >= 100 || clock.ElapsedMilliseconds > 5000) {
            result.Truncated = true; return;
          }
          result.ScannedCount++;
          string name = Path.GetFileName(childPath);
          if (!SafePart(name)) { result.SkippedCount++; continue; }
          string childRelative = relative.Length == 0 ? name : relative + "\\" + name;
          bool isDirectory;
          try { isDirectory = (File.GetAttributes(childPath) & FileAttributes.Directory) != 0; }
          catch { result.SkippedCount++; continue; }
          if (isDirectory && depth >= 8) { result.Truncated = true; continue; }
          if (!isDirectory && !(name.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".txt", StringComparison.OrdinalIgnoreCase))) continue;
          try {
            using (var child = OpenChecked(childPath, isDirectory)) {
              if (!Inside(child.Final, root.Final) || !Inside(child.Final, parent.Final)) throw Fail("PROJECT_UNSAFE_PATH");
              if (isDirectory) walk(childPath, childRelative, depth + 1, child);
              else if (Size(child.Info) <= 8L * 1024 * 1024 &&
                (String.IsNullOrEmpty(query) || childRelative.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0))
                result.Files.Add(new FileRow { RelativePath = childRelative, Size = Size(child.Info),
                  Identity = Identity(child.Info), LastWriteTime = child.Info.LastWriteTime.ToString() });
              else if (Size(child.Info) > 8L * 1024 * 1024) result.SkippedCount++;
            }
          } catch { result.SkippedCount++; }
        }
      };
      walk(path, "", 0, root);
      return result;
    } finally { foreach (var item in chain) item.Dispose(); }
  }
  public static ReadResult Read(string path, string expectedFinal, string expectedIdentity, string relative,
    string fileIdentity, long expectedSize, string expectedWriteTime, int startLine) {
    var parts = RelativeParts(relative);
    if (!(relative.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ||
      relative.EndsWith(".txt", StringComparison.OrdinalIgnoreCase)) || startLine < 1) throw Fail("PROJECT_UNSAFE_PATH");
    var chain = OpenRootChain(path);
    try {
      var root = chain[chain.Count - 1]; CheckRoot(root, expectedFinal, expectedIdentity);
      string current = path;
      for (int i = 0; i < parts.Length - 1; i++) {
        current = Path.Combine(current, parts[i]);
        var child = OpenChecked(current, true);
        if (!Inside(child.Final, root.Final) || !Inside(child.Final, chain[chain.Count - 1].Final)) {
          child.Dispose(); throw Fail("PROJECT_UNSAFE_PATH");
        }
        chain.Add(child);
      }
      current = Path.Combine(current, parts[parts.Length - 1]);
      using (var file = OpenChecked(current, false)) {
        if (!Inside(file.Final, root.Final) || !Inside(file.Final, chain[chain.Count - 1].Final)) throw Fail("PROJECT_UNSAFE_PATH");
        long size = Size(file.Info);
        if (size > 8L * 1024 * 1024 || size != expectedSize || Identity(file.Info) != fileIdentity ||
            file.Info.LastWriteTime.ToString() != expectedWriteTime) throw Fail("PROJECT_FILE_CHANGED");
        byte[] bytes = new byte[(int)size]; int offset = 0;
        using (var stream = new FileStream(file.Handle, FileAccess.Read, 4096, false)) {
          while (offset < bytes.Length) { int read = stream.Read(bytes, offset, bytes.Length - offset);
            if (read <= 0) throw Fail("PROJECT_FILE_CHANGED"); offset += read; }
          Info after;
          if (!GetFileInformationByHandle(file.Handle, out after) || Size(after) != size ||
              after.LastWriteTime != file.Info.LastWriteTime || Identity(after) != fileIdentity) throw Fail("PROJECT_FILE_CHANGED");
        }
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes); }
        catch { throw Fail("PROJECT_INVALID_UTF8"); }
        if (text.IndexOf('\0') >= 0) throw Fail("PROJECT_INVALID_UTF8");
        var lines = text.Split('\n');
        if (startLine > lines.Length) throw Fail("PROJECT_LINE_OUT_OF_RANGE");
        var page = new StringBuilder(); int pageBytes = 0, end = startLine - 1;
        for (int i = startLine - 1; i < lines.Length; i++) {
          string line = lines[i] + (i < lines.Length - 1 ? "\n" : "");
          int bytesNeeded = Encoding.UTF8.GetByteCount(line);
          if (pageBytes + bytesNeeded > 32 * 1024) {
            if (end < startLine) throw Fail("PROJECT_LINE_TOO_LONG");
            break;
          }
          page.Append(line); pageBytes += bytesNeeded; end = i + 1;
        }
        string hash;
        using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        return new ReadResult { RelativePath = relative, LineStart = startLine, LineEnd = end,
          TotalLines = lines.Length, FileSha256 = hash, Text = page.ToString(), HasMore = end < lines.Length,
          Size = size, Identity = fileIdentity, LastWriteTime = expectedWriteTime };
      }
    } finally { foreach (var item in chain) item.Dispose(); }
  }
}
'@

try {
  $request = $(if ($RequestJson) { $RequestJson } else { [Console]::In.ReadToEnd() }) | ConvertFrom-Json
  switch ($request.action) {
    'inspect' { $result = [SafeProjectReader]::InspectRoot([string]$request.rootPath) }
    'list' { $result = [SafeProjectReader]::List([string]$request.rootPath, [string]$request.expectedFinal,
      [string]$request.expectedIdentity, [string]$request.query) }
    'read' { $result = [SafeProjectReader]::Read([string]$request.rootPath, [string]$request.expectedFinal,
      [string]$request.expectedIdentity, [string]$request.relativePath, [string]$request.fileIdentity,
      [long]$request.expectedSize, [string]$request.expectedWriteTime, [int]$request.startLine) }
    default { throw 'INVALID_COMMAND' }
  }
  @{ ok = $true; value = $result } | ConvertTo-Json -Depth 10 -Compress
} catch {
  $inner = $_.Exception
  $code = 'PROJECT_FILE_UNAVAILABLE'
  while ($inner) {
    if ($inner.Message -match '^PROJECT_[A-Z0-9_]+$') { $code = $inner.Message }
    $inner = $inner.InnerException
  }
  @{ ok = $false; code = $code } | ConvertTo-Json -Compress
}
