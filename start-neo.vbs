' SLIDE STUDIO NEO launcher without a window (the desktop shortcut runs this).
' Already running -> open the browser. Install/build needed -> show that window until it finishes.
' Then start the server hidden. It keeps running in the background until sign-out or shutdown.
Option Explicit
Dim sh, fso, dir, cmdFile, code, need
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
cmdFile = """" & dir & "\start-neo.cmd"""

If sh.Run("cmd /c node scripts\launcher.mjs running", 0, True) = 0 Then
  sh.Run "cmd /c node scripts\launcher.mjs open", 0, False
  WScript.Quit 0
End If

need = Not fso.FolderExists(dir & "\node_modules")
If Not need Then
  code = sh.Run("cmd /c node scripts\launcher.mjs needs-build", 0, True)
  ' 0 = ready. 1 = build needed. Anything else (e.g. node missing): show the window so the error is visible.
  need = (code <> 0)
End If
If need Then
  If sh.Run("cmd /c """ & cmdFile & " prepare""", 1, True) <> 0 Then WScript.Quit 1
End If

sh.Run "cmd /c """ & cmdFile & " serve""", 0, False
