' Medium Latens - inicia o loop do servidor sem janela visivel
Set shell = CreateObject("WScript.Shell")
shell.Run """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\run-server.cmd""", 0, False
