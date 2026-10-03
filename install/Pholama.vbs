' Starts Pholama with no black window and opens the chat page.
' Uses the Node.js on this PC, or the private copy in %USERPROFILE%\.pholama\node when there is none.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
nodeExe = "node"
priv = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.pholama\node\node.exe"
If fso.FileExists(priv) Then nodeExe = """" & priv & """"
sh.Run "cmd /c " & nodeExe & " server\cli.js web", 0, False
