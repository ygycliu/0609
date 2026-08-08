Option Explicit

If WScript.Arguments.Count = 0 Then
  WScript.Echo "Usage: cscript //nologo scripts\validate-docx.vbs <document.docx>"
  WScript.Quit 2
End If

Dim word, document, fileSystem, documentPath
Set fileSystem = CreateObject("Scripting.FileSystemObject")
documentPath = fileSystem.GetAbsolutePathName(WScript.Arguments(0))

On Error Resume Next
Set word = CreateObject("Word.Application")
If Err.Number <> 0 Then
  WScript.Echo "WORD_OPEN_OK=False"
  WScript.Echo "ERROR=" & Err.Description
  WScript.Quit 1
End If
On Error GoTo 0

word.Visible = False
word.DisplayAlerts = 0

On Error Resume Next
Set document = word.Documents.Open(documentPath, False, True)
If Err.Number <> 0 Then
  WScript.Echo "WORD_OPEN_OK=False"
  WScript.Echo "ERROR=" & Err.Description
  word.Quit
  WScript.Quit 1
End If
On Error GoTo 0

WScript.Echo "WORD_OPEN_OK=True"
WScript.Echo "PAGES=" & document.ComputeStatistics(2)
WScript.Echo "PARAGRAPHS=" & document.Paragraphs.Count
WScript.Echo "TABLES=" & document.Tables.Count
WScript.Echo "SECTIONS=" & document.Sections.Count

document.Close False
word.Quit
